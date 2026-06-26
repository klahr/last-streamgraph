/**
 * Orchestrates the data lifecycle: hydrate from IndexedDB, run a resumable sync
 * against Last.fm (forward-fill new plays + backfill older history), persist
 * pages and watermarks as they arrive, and expose the merged scrobble set plus
 * live sync progress to the UI.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getAllScrobbles,
  getSyncState,
  putScrobbles,
  putSyncState,
} from '../services/indexedDb';
import { streamScrobbles, LastFmError, type PageBatch } from '../services/lastfmApi';
import type { Credentials, Scrobble, SyncProgress, SyncState } from '../types';

/** Flush in-memory state to the chart every N pages during a long sync. */
const FLUSH_EVERY = 10;

const IDLE: SyncProgress = {
  phase: 'idle',
  page: 0,
  totalPages: 0,
  fetched: 0,
  message: '',
};

export interface ScrobbleData {
  scrobbles: Scrobble[];
  progress: SyncProgress;
  /** Incremental sync: fetch only plays newer than the cache watermark. */
  sync: () => void;
}

export function useScrobbleData(creds: Credentials | null): ScrobbleData {
  const [scrobbles, setScrobbles] = useState<Scrobble[]>([]);
  const [progress, setProgress] = useState<SyncProgress>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const valid = !!creds && !!creds.apiKey.trim() && !!creds.username.trim();
  const user = valid ? creds!.username.trim().toLowerCase() : '';

  const runSync = useCallback(
    async () => {
      if (!valid || !creds) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        // Mark syncing immediately so first-open (auto-hydrate) never sits on
        // an idle-looking chart while the cache load is still in flight.
        setProgress({
          phase: 'syncing',
          page: 0,
          totalPages: 0,
          fetched: 0,
          message: 'Loading…',
        });

        // Hydrate from cache first so the chart paints immediately (and so a
        // resumed sync already shows whatever was fetched before the abort).
        const cached = await getAllScrobbles(user);
        setScrobbles(cached);

        const state: SyncState = await getSyncState(user);
        // Track ids we already hold so inclusive boundaries can't double-count.
        const seen = new Set(cached.map((s) => s.id));
        const buffer: Scrobble[] = [];
        let sinceFlush = 0;
        let fetched = 0;
        // Rolling page-arrival timestamps (ms) for ETA; capped to a small
        // window so the rate tracks recent network conditions, not the whole run.
        const pageTimes: number[] = [];
        const PAGE_RATE_WINDOW = 5;

        const flush = () => {
          if (buffer.length === 0) return;
          const batch = buffer.splice(0);
          setScrobbles((prev) => prev.concat(batch));
        };

        // Persist a page, fold fresh scrobbles into state, advance watermarks.
        const ingest = async (batch: PageBatch, label: string) => {
          if (batch.scrobbles.length > 0) {
            await putScrobbles(batch.scrobbles); // idempotent on composite id
            for (const s of batch.scrobbles) {
              if (state.newestUts == null || s.uts > state.newestUts) state.newestUts = s.uts;
              if (state.oldestUts == null || s.uts < state.oldestUts) state.oldestUts = s.uts;
              if (!seen.has(s.id)) {
                seen.add(s.id);
                buffer.push(s);
                fetched += 1;
              }
            }
            // Save watermarks per page so an abort mid-sync is resumable.
            await putSyncState(state);
          }
          if (++sinceFlush >= FLUSH_EVERY) {
            flush();
            sinceFlush = 0;
          }
          // ETA from the rolling page rate, only once enough samples exist
          // and Last.fm has reported a real total. Phase A often has 0 total
          // pages (nothing new) → no estimate.
          let etaMs: number | undefined;
          pageTimes.push(Date.now());
          if (pageTimes.length > PAGE_RATE_WINDOW) pageTimes.shift();
          if (pageTimes.length >= 3 && batch.totalPages > 0 && batch.totalPages > batch.page) {
            const span = pageTimes[pageTimes.length - 1]! - pageTimes[0]!;
            const intervals = pageTimes.length - 1;
            const msPerPage = span / intervals;
            const remaining = batch.totalPages - batch.page;
            etaMs = Math.max(0, Math.round(msPerPage * remaining));
          }
          setProgress({
            phase: 'syncing',
            page: batch.page,
            totalPages: batch.totalPages,
            fetched,
            message: `${label} page ${batch.page} of ${batch.totalPages}…`,
            etaMs,
          });
        };

        // Phase A — forward fill: plays at/after the newest cached (inclusive
        // boundary; dedupe handles the overlap). Skipped on a fresh cache.
        if (state.newestUts != null) {
          setProgress({ phase: 'syncing', page: 0, totalPages: 0, fetched, message: 'Checking for new scrobbles…' });
          for await (const batch of streamScrobbles(creds, {
            from: state.newestUts,
            signal: ac.signal,
          })) {
            await ingest(batch, 'New plays');
          }
        }

        // Phase B — backfill: walk older history until exhausted. Resumes from
        // the stored oldest watermark; reaching the natural end of the stream
        // (loop completes without an abort) marks the backfill complete.
        if (!state.backfillComplete) {
          const resuming = state.oldestUts != null;
          setProgress({ phase: 'syncing', page: 0, totalPages: 0, fetched, message: resuming ? 'Resuming history backfill…' : 'Fetching history…' });
          for await (const batch of streamScrobbles(creds, {
            to: state.oldestUts, // null on first run = from now, backwards
            signal: ac.signal,
          })) {
            await ingest(batch, resuming ? 'Backfilling' : 'History');
          }
          state.backfillComplete = true;
          await putSyncState(state);
        }

        flush();
        setProgress({
          phase: 'done',
          page: 0,
          totalPages: 0,
          fetched,
          message:
            fetched > 0
              ? `Synced ${fetched.toLocaleString()} scrobble${fetched === 1 ? '' : 's'}.`
              : 'Up to date.',
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // An abort (credential change / unmount) must not leave the progress
          // stuck on 'syncing' — that would pin the busy indicator on after
          // work has actually stopped. But only reset to idle when this run
          // is still the active one: a newer run that superseded us has already
          // set 'syncing' itself, and our AbortError catch fires on a later
          // microtask — blindly resetting to IDLE here would clobber that.
          if (abortRef.current === ac) setProgress(IDLE);
          return;
        }
        const message =
          err instanceof LastFmError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Sync failed.';
        setProgress({
          phase: 'error',
          page: 0,
          totalPages: 0,
          fetched: 0,
          message,
          error: message,
        });
      }
    },
    [valid, creds, user],
  );

  // Auto-hydrate + incremental sync whenever valid credentials change.
  useEffect(() => {
    if (!valid) {
      setScrobbles([]);
      setProgress(IDLE);
      return;
    }
    // A username change between two valid users (A → B) leaves A's scrobbles
    // in state until B's cache hydrates; clear immediately so B never briefly
    // renders A's chart.
    setScrobbles([]);
    void runSync();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, valid]);

  const sync = useCallback(() => void runSync(), [runSync]);

  return { scrobbles, progress, sync };
}

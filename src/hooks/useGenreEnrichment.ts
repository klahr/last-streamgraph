// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Enriches artists with a genre (from Last.fm top tags) for genre-grouped views.
 *
 * Genres aren't in the scrobble data, so we fetch each artist's top tags once,
 * clean them to a single genre, and cache the result in IndexedDB (global, not
 * per-user). Enrichment runs in descending play-count order so the most-played
 * artists — which dominate the chart — get tagged first; the view updates
 * incrementally and uncovered plays show as "Unknown" until reached. It's
 * rate-limited, resumable (skips cached artists), and abortable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAllArtistGenres, putArtistGenres } from '../services/indexedDb';
import { fetchArtistTopTags } from '../services/lastfmApi';
import { pickGenre } from '../utils/genres';
import type {
  ArtistGenre,
  Credentials,
  GenreProgress,
  Scrobble,
} from '../types';

const RATE_LIMIT_MS = 250;
const FLUSH_EVERY = 15;

const IDLE: GenreProgress = { running: false, done: 0, total: 0, message: '' };

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

export interface GenreData {
  /** Lowercased artist name → genre. */
  genreMap: Record<string, string>;
  progress: GenreProgress;
  /** Distinct artists still lacking a cached genre. */
  missingCount: number;
  /** Manually (re)start enrichment. */
  enrich: () => void;
}

export function useGenreEnrichment(
  creds: Credentials | null,
  scrobbles: Scrobble[],
  active: boolean,
): GenreData {
  const [genreMap, setGenreMap] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<GenreProgress>(IDLE);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  // Distinct artists with a representative (original-case) name, by play count.
  const artists = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const s of scrobbles) {
      const key = s.artist.toLowerCase();
      const e = counts.get(key);
      if (e) e.count += 1;
      else counts.set(key, { name: s.artist, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [scrobbles]);

  // A live handle on the latest artist list so an in-flight enrichment can pick
  // up artists that arrive from an ongoing sync — without `artists` being an
  // `enrich` dependency, which would otherwise abort and restart on every sync
  // batch (new scrobbles → new `artists` array → new `enrich` → effect re-run).
  const artistsRef = useRef(artists);
  artistsRef.current = artists;

  // Hydrate cached genres once.
  useEffect(() => {
    let cancelled = false;
    void getAllArtistGenres().then((m) => {
      if (!cancelled) setGenreMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const missingCount = useMemo(
    () => artists.reduce((n, a) => n + (a.name.toLowerCase() in genreMap ? 0 : 1), 0),
    [artists, genreMap],
  );

  const enrich = useCallback(async () => {
    // A run is already in progress and absorbs new artists itself; don't abort
    // and restart it (that would reset progress on every sync batch).
    if (!creds || runningRef.current) return;
    runningRef.current = true;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    let buffer: ArtistGenre[] = [];
    let done = 0;
    // Rolling per-artist completion timestamps (ms) for ETA; the per-artist
    // cost is dominated by the RATE_LIMIT_MS throttle plus one network call,
    // so a small recent sample tracks real latency on top of the throttle.
    const artistTimes: number[] = [];
    const ARTIST_RATE_WINDOW = 20;

    const flush = async () => {
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      await putArtistGenres(batch);
      setGenreMap((prev) => {
        const next = { ...prev };
        for (const r of batch) next[r.artist] = r.genre;
        return next;
      });
    };

    try {
      const cached = await getAllArtistGenres();
      setGenreMap(cached);
      const have = new Set(Object.keys(cached));

      // Loop so artists that stream in from an in-progress sync get tagged in
      // the same run, rather than triggering an abort/restart.
      for (;;) {
        const todo = artistsRef.current.filter(
          (a) => !have.has(a.name.toLowerCase()),
        );
        if (todo.length === 0) break;
        const total = done + todo.length;
        setProgress({ running: true, done, total, message: `Tagging artists ${done} of ${total}…` });
        for (const a of todo) {
          const key = a.name.toLowerCase();
          if (have.has(key)) continue; // raced in via an earlier batch
          const tags = await fetchArtistTopTags(creds, a.name, ac.signal);
          buffer.push({ artist: key, genre: pickGenre(tags) });
          have.add(key);
          done += 1;
          if (buffer.length >= FLUSH_EVERY) await flush();
          // ETA from the rolling per-artist rate; only once enough samples exist
          // and there's actual remaining work. `total` may keep growing as sync
          // streams artists in, so this is a snapshot estimate that self-corrects.
          artistTimes.push(Date.now());
          if (artistTimes.length > ARTIST_RATE_WINDOW) artistTimes.shift();
          let etaMs: number | undefined;
          if (
            artistTimes.length >= 5 &&
            total > done &&
            artistTimes[artistTimes.length - 1]! - artistTimes[0]! > 0
          ) {
            const span = artistTimes[artistTimes.length - 1]! - artistTimes[0]!;
            const intervals = artistTimes.length - 1;
            const msPerArtist = span / intervals;
            etaMs = Math.max(0, Math.round(msPerArtist * (total - done)));
          }
          setProgress({ running: true, done, total, message: `Tagging artists ${done} of ${total}…`, etaMs });
          await sleep(RATE_LIMIT_MS, ac.signal);
        }
        await flush();
      }
      await flush();
      setProgress({ running: false, done, total: done, message: done > 0 ? `Tagged ${done} artist${done === 1 ? '' : 's'}.` : 'Genres up to date.' });
    } catch (err) {
      await flush(); // keep what we fetched before the abort/error
      if (err instanceof DOMException && err.name === 'AbortError') {
        // An abort (active toggled off / creds change) must not leave
        // `progress.running` stuck on — that would pin the busy indicator.
        // Preserve the done count so a resumed run reports honestly.
        setProgress({ running: false, done, total: done, message: 'Tagging stopped.' });
        return;
      }
      setProgress({ running: false, done, total: done, message: err instanceof Error ? err.message : 'Genre fetch failed.' });
    } finally {
      runningRef.current = false;
    }
  }, [creds]);

  // Start enrichment when genre mode turns on (and stop it when switched off or
  // unmounted). Only `active`/`creds` own the abort, so sync churn can't restart
  // a run mid-flight.
  useEffect(() => {
    if (active && creds) void enrich();
    return () => abortRef.current?.abort();
  }, [active, creds, enrich]);

  // Resume for artists that arrived after a run finished (e.g. a sync batch that
  // landed once tagging was already idle). No cleanup here: this must not abort.
  useEffect(() => {
    if (active && creds && artists.length > 0 && !runningRef.current) void enrich();
  }, [active, creds, artists, enrich]);

  return { genreMap, progress, missingCount, enrich };
}

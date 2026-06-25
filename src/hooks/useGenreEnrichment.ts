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
    if (!creds) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const cached = await getAllArtistGenres();
    setGenreMap(cached);
    const todo = artists.filter((a) => !(a.name.toLowerCase() in cached));
    if (todo.length === 0) {
      setProgress({ running: false, done: 0, total: 0, message: 'Genres up to date.' });
      return;
    }

    setProgress({ running: true, done: 0, total: todo.length, message: `Tagging artists 0 of ${todo.length}…` });
    let buffer: ArtistGenre[] = [];
    let done = 0;

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
      for (const a of todo) {
        const tags = await fetchArtistTopTags(creds, a.name, ac.signal);
        buffer.push({ artist: a.name.toLowerCase(), genre: pickGenre(tags) });
        done += 1;
        if (buffer.length >= FLUSH_EVERY) await flush();
        setProgress({ running: true, done, total: todo.length, message: `Tagging artists ${done} of ${todo.length}…` });
        await sleep(RATE_LIMIT_MS, ac.signal);
      }
      await flush();
      setProgress({ running: false, done, total: todo.length, message: `Tagged ${done} artist${done === 1 ? '' : 's'}.` });
    } catch (err) {
      await flush(); // keep what we fetched before the abort/error
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setProgress({ running: false, done, total: todo.length, message: err instanceof Error ? err.message : 'Genre fetch failed.' });
    }
  }, [creds, artists]);

  // Auto-run while genre mode is active; abort when it's switched off / unmounts.
  useEffect(() => {
    if (active && creds && artists.length > 0) void enrich();
    return () => abortRef.current?.abort();
  }, [active, creds, artists, enrich]);

  return { genreMap, progress, missingCount, enrich };
}

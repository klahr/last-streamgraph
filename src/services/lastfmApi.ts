// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Last.fm API client: rate-limited, paginated fetching of `user.getRecentTracks`.
 *
 * Exposes an async generator that yields one page-batch of normalized
 * {@link Scrobble}s at a time, so callers can persist incrementally and surface
 * progress without buffering an entire multi-year history in memory.
 */
import { scrobbleId } from './indexedDb';
import type { Credentials, Scrobble } from '../types';

const API_ROOT = 'https://ws.audioscrobbler.com/2.0/';
const PAGE_SIZE = 1000; // Undocumented but accepted; ~5× fewer requests than 200.
const RATE_LIMIT_MS = 250; // ~4 req/s, comfortably under the 5 req/s guideline.
const MAX_RETRIES = 3;

/** Raw shapes returned by the Last.fm JSON API (only the fields we read). */
interface RawArtistOrAlbum {
  '#text'?: string;
}
interface RawTrack {
  artist?: RawArtistOrAlbum;
  album?: RawArtistOrAlbum;
  name?: string;
  date?: { uts?: string };
  '@attr'?: { nowplaying?: string };
}
interface RawTag {
  name?: string;
  count?: number;
}
interface RawResponse {
  recenttracks?: {
    track?: RawTrack | RawTrack[];
    '@attr'?: { totalPages?: string; page?: string; total?: string };
  };
  toptags?: {
    tag?: RawTag | RawTag[];
  };
  error?: number;
  message?: string;
}

export interface PageBatch {
  scrobbles: Scrobble[];
  page: number;
  totalPages: number;
  total: number;
}

export class LastFmError extends Error {
  readonly code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = 'LastFmError';
    this.code = code;
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

function buildUrl(
  creds: Credentials,
  page: number,
  window: { from?: number | null; to?: number | null },
): string {
  const params = new URLSearchParams({
    method: 'user.getrecenttracks',
    user: creds.username,
    api_key: creds.apiKey,
    format: 'json',
    limit: String(PAGE_SIZE),
    page: String(page),
  });
  if (window.from && window.from > 0) params.set('from', String(window.from));
  if (window.to && window.to > 0) params.set('to', String(window.to));
  return `${API_ROOT}?${params.toString()}`;
}

/** Fetch one page, retrying transient network/5xx failures with backoff. */
async function fetchPage(
  url: string,
  signal?: AbortSignal,
): Promise<RawResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal });
      if (res.status === 429 || res.status >= 500) {
        throw new LastFmError(`HTTP ${res.status}`, res.status);
      }
      const data = (await res.json()) as RawResponse;
      if (data.error) {
        // API-level errors (bad key, unknown user, …) are not retryable.
        throw new LastFmError(data.message ?? 'Last.fm API error', data.error);
      }
      return data;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      // Non-retryable API errors bubble out immediately.
      if (err instanceof LastFmError && err.code !== undefined && err.code < 500 && err.code !== 429) {
        throw err;
      }
      lastErr = err;
      await sleep(RATE_LIMIT_MS * (attempt + 1) * 4, signal);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new LastFmError('Failed to fetch page');
}

function normalize(raw: RawTrack, user: string): Scrobble | null {
  // Skip the "now playing" track — it has no timestamp and isn't a scrobble yet.
  if (raw['@attr']?.nowplaying === 'true' || !raw.date?.uts) return null;
  const uts = Number(raw.date.uts);
  if (!Number.isFinite(uts)) return null;
  // Use `||` (not `??`): Last.fm sometimes returns an empty string, which is
  // not nullish and would otherwise slip through as an empty artist/track —
  // colliding the composite id for every empty-artist scrobble in the same second.
  const artist = raw.artist?.['#text'] || 'Unknown Artist';
  const track = raw.name || 'Unknown Track';
  const album = raw.album?.['#text'] || '';
  return { id: scrobbleId(user, uts, artist, track), user, artist, album, track, uts };
}

/**
 * Stream a user's scrobbles page by page (newest first), normalized and ready
 * to persist. Pass `from` (epoch **seconds**) to fetch only plays at/after a
 * watermark (forward/incremental sync), or `to` to fetch only plays at/before a
 * watermark (backfill of older history). Boundaries are inclusive; callers
 * dedupe by id.
 */
export async function* streamScrobbles(
  creds: Credentials,
  opts: { from?: number | null; to?: number | null; signal?: AbortSignal } = {},
): AsyncGenerator<PageBatch> {
  const user = creds.username.toLowerCase();
  let page = 1;
  let totalPages = 1;

  do {
    const url = buildUrl(creds, page, { from: opts.from, to: opts.to });
    const data = await fetchPage(url, opts.signal);
    const rt = data.recenttracks;
    const attr = rt?.['@attr'];
    totalPages = Math.max(1, Number(attr?.totalPages ?? '1'));
    const total = Number(attr?.total ?? '0');

    const rawTracks = rt?.track;
    const list: RawTrack[] = Array.isArray(rawTracks)
      ? rawTracks
      : rawTracks
        ? [rawTracks]
        : [];

    const scrobbles = list
      .map((t) => normalize(t, user))
      .filter((s): s is Scrobble => s !== null);

    yield { scrobbles, page, totalPages, total };

    page += 1;
    if (page <= totalPages) await sleep(RATE_LIMIT_MS, opts.signal);
  } while (page <= totalPages);
}

function tagsUrl(creds: Credentials, artist: string): string {
  const params = new URLSearchParams({
    method: 'artist.gettoptags',
    artist,
    api_key: creds.apiKey,
    format: 'json',
    autocorrect: '1',
  });
  return `${API_ROOT}?${params.toString()}`;
}

/**
 * Fetch an artist's top tags (most-voted first). Returns an empty list for
 * unknown artists or tagless artists rather than throwing, so enrichment can
 * keep going. Rate-limit between calls is the caller's responsibility.
 */
export async function fetchArtistTopTags(
  creds: Credentials,
  artist: string,
  signal?: AbortSignal,
): Promise<string[]> {
  let data: RawResponse;
  try {
    data = await fetchPage(tagsUrl(creds, artist), signal);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // Unknown artist (error 6), transient network failures after retries, … —
    // any non-abort is "no tags for this artist". Returning [] keeps the
    // enrichment run going instead of aborting everyone on one flaky artist.
    return [];
  }
  const raw = data.toptags?.tag;
  const list: RawTag[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .map((t) => t.name?.trim())
    .filter((n): n is string => !!n);
}

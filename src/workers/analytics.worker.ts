// SPDX-License-Identifier: GPL-3.0-or-later
/// <reference lib="webworker" />
/**
 * Web Worker that runs the auxiliary-view aggregations off the main thread.
 *
 * The trimmed dataset ({artist, uts, album}) and artist→genre map are uploaded
 * once and reused across views and filter changes, so toggling a view or
 * dragging the date range re-runs only the cheap per-view reduction, not a
 * full re-scan of all N scrobbles. The expensive O(N) reduction per view is
 * memoized by (view, from, to); range changes only invalidate when the bucket
 * window actually moves.
 */
import {
  punchcard,
  dailyCounts,
  seasonal,
  discovery,
  rankOverTime,
  breakdownHierarchy,
  networkGraph,
  forecast,
  obsessions,
  novelty,
  firstPlayMap,
  tenure,
  genreHours,
  albumDepth,
  sessions,
  yearOverYear,
  retention,
} from '../utils/analytics';
import { bucketFor } from '../utils/dataProcessor';
import { UNKNOWN_GENRE } from '../utils/genres';
import type { CountableScrobble } from '../utils/dataProcessor';
import type {
  GroupBy,
  Resolution,
  View,
} from '../types';

/** Per-view request payload (filters only; dataset lives in the worker). */
export interface AnalyticsRequest {
  view: View;
  resolution: Resolution;
  topN: number;
  groupBy: GroupBy;
  /** Regex filter for the forecast view (empty → top-N by play count). */
  forecastFilter: string;
  /** Silence (minutes) that ends a listening session, for the sessions view. */
  sessionGapMin: number;
  /** Inclusive bucket-level date window (epoch ms). Omit for all-time. */
  from?: number;
  to?: number;
}

export type WorkerRequest =
  | { type: 'data'; scrobbles: CountableScrobble[] }
  | { type: 'genres'; map: Record<string, string> }
  | { type: 'compute'; id: number; request: AnalyticsRequest };

export interface WorkerResponse {
  id: number;
  data?: { view: View; payload: unknown };
  error?: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** Forecast projection horizon (months). Shared with the Forecast view. */
export const FORECAST_HORIZON = 6;

let dataset: CountableScrobble[] = [];
let genreMap: Record<string, string> = {};

/**
 * artist → first-ever play, over the **whole** dataset rather than the ranged
 * slice, because "new to me" is a fact about all of history: computed from a
 * slice, every artist in the window would read as a fresh discovery. Cached
 * because it's an O(N) scan that only the dataset can invalidate.
 */
let firstPlayCache: Map<string, number> | null = null;

/**
 * Cohort retention reads all history by design (a ranged slice would bias every
 * half-life short), so its result depends on nothing but the dataset — cache it
 * outright rather than recomputing on every slider tick.
 */
let retentionCache: ReturnType<typeof retention> | null = null;

// Memoize range-filtered slices to avoid re-scanning on every slider tick. The
// ranged slice is identical for all views for a given (resolution, from, to),
// so sharing it across views is safe.
let sliceCache: {
  resolution: Resolution;
  from?: number;
  to?: number;
  slice: CountableScrobble[];
} | null = null;

function rangedSlice(
  resolution: Resolution,
  from?: number,
  to?: number,
): CountableScrobble[] {
  if (from == null && to == null) return dataset;
  if (
    sliceCache &&
    sliceCache.resolution === resolution &&
    sliceCache.from === from &&
    sliceCache.to === to
  )
    return sliceCache.slice;
  const lo = from ?? -Infinity;
  const hi = to ?? Infinity;
  const slice = dataset.filter((s) => {
    const start = bucketFor(s.uts, resolution).start;
    return start >= lo && start <= hi;
  });
  sliceCache = { resolution, from, to, slice };
  return slice;
}

const genreOf = (s: CountableScrobble) =>
  genreMap[s.artist.toLowerCase()] ?? UNKNOWN_GENRE;
const artistKey = (s: CountableScrobble) => s.artist;
const albumKey = (s: CountableScrobble) => s.album || 'Unknown Album';
const trackKey = (s: CountableScrobble) => s.track || 'Unknown Track';

/**
 * What Group-by names a series: a genre, an artist or an album. Genre keys off
 * {@link genreOf} unconditionally — before the tag fetch lands every artist is
 * "Unknown", which the genre-capable views detect and explain rather than
 * quietly drawing.
 */
function seriesKey(groupBy: GroupBy): (s: CountableScrobble) => string {
  switch (groupBy) {
    case 'genre':
      return genreOf;
    case 'album':
      return albumKey;
    default:
      return artistKey;
  }
}

/**
 * The sunburst's two rings, one level apart: genres break into their artists,
 * artists into their albums, albums into their tracks — so the inner ring is
 * whatever Group-by names, and the outer is one level below it.
 */
function breakdownKeys(
  groupBy: GroupBy,
): [(s: CountableScrobble) => string, (s: CountableScrobble) => string] {
  const outer =
    groupBy === 'genre' ? artistKey : groupBy === 'album' ? trackKey : albumKey;
  return [seriesKey(groupBy), outer];
}

/** Safety bound: a `.*`-ish filter shouldn't render hundreds of cards. */
const FORECAST_MAX_KEYS = 100;
/** Fallback count when the filter is empty (sane default instead of “all”). */
const FORECAST_DEFAULT_KEYS = 12;

/**
 * Select which series keys to forecast, given a (possibly empty/invalid) regex.
 *
 * - Empty/whitespace filter → top {@link FORECAST_DEFAULT_KEYS} keys by total.
 * - Valid regex → every matching key by total, capped at {@link
 *   FORECAST_MAX_KEYS} (highest totals win).
 * - Invalid regex → treat as no filter (same as empty) so a typo never blanks
 *   the view.
 */
function forecastKeys(
  slice: readonly CountableScrobble[],
  keyFn: (s: CountableScrobble) => string,
  filter: string,
  _topN: number,
): string[] {
  const totals = new Map<string, number>();
  for (const s of slice) {
    const k = keyFn(s);
    totals.set(k, (totals.get(k) ?? 0) + 1);
  }
  const ranked = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k]) => k);

  const trimmed = filter.trim();
  if (!trimmed) return ranked.slice(0, FORECAST_DEFAULT_KEYS);

  let re: RegExp;
  try {
    re = new RegExp(trimmed, 'i');
  } catch {
    return ranked.slice(0, FORECAST_DEFAULT_KEYS);
  }
  return ranked.filter((k) => re.test(k)).slice(0, FORECAST_MAX_KEYS);
}

function compute(request: AnalyticsRequest): unknown {
  const { view, resolution, topN, groupBy, forecastFilter, sessionGapMin, from, to } =
    request;
  const slice = rangedSlice(resolution, from, to);

  switch (view) {
    case 'punchcard':
      return punchcard(slice);
    case 'calendar':
      return dailyCounts(slice);
    case 'seasonal':
      // Ranked by whatever Group-by names, so the same view answers "which
      // artists are my winter" or "which genres are my summer".
      return seasonal(slice, seriesKey(groupBy), {
        minPlays: 12,
        limit: 100,
        otherLimit: 1500,
      });
    case 'discovery':
      return discovery(slice, { minPlays: 5 });
    case 'rankbump':
      return rankOverTime(slice, resolution, Math.min(topN, 15), (s) => s.artist);
    case 'sunburst': {
      const [innerOf, outerOf] = breakdownKeys(groupBy);
      return breakdownHierarchy(slice, innerOf, outerOf, {
        topInner: 12,
        topOuterPerInner: 12,
      });
    }
    case 'network':
      return networkGraph(slice, genreMap, {
        topN,
        maxNodes: 60,
        minSharedDays: 3,
        maxEdges: 400,
      });
    case 'obsessions':
      // Weekly sparkline grid + burst ranking. 8 plays is the floor for a
      // track to count as an obsession at all; below that a single afternoon
      // of curiosity would score as one.
      return obsessions(slice, { limit: 24, minPlays: 8, windowDays: 7 });
    case 'novelty':
      firstPlayCache ??= firstPlayMap(dataset);
      return novelty(slice, resolution, firstPlayCache);
    case 'tenure':
      return tenure(slice, { topN: Math.min(topN, 60) });
    case 'genrehours':
      return genreHours(slice, genreMap, { topGenres: 16 });
    case 'albumdepth':
      return albumDepth(slice, { limit: 150, minPlays: 3 });
    case 'sessions':
      return sessions(slice, { gapMinutes: sessionGapMin });
    case 'yoy':
      return yearOverYear(slice);
    case 'retention':
      // Deliberately `dataset`, not `slice` — see the retention() docs.
      firstPlayCache ??= firstPlayMap(dataset);
      retentionCache ??= retention(dataset, firstPlayCache, { maxMonths: 120 });
      return retentionCache;
    case 'forecast': {
      // Key by genre only when genres are loaded AND the user asked for genre
      // grouping; by album when grouping by album; otherwise per artist so the
      // view is useful immediately, before the rate-limited genre fetch
      // (250ms/artist) lands.
      const keyFn =
        groupBy === 'genre' && Object.keys(genreMap).length > 0
          ? genreOf
          : groupBy === 'album'
            ? albumKey
            : artistKey;
      // Regex filter (empty → top-12 by play count fallback; capped at 100 so
      // a `.*`-ish pattern can’t render hundreds of cards). An invalid regex
      // is treated as “no filter”. Keys are selected by total play count over
      // the slice, then the forecast runs for exactly that set.
      const keys = forecastKeys(slice, keyFn, forecastFilter, topN);
      return forecast(slice, keyFn, {
        topN,
        horizon: FORECAST_HORIZON,
        smaWindow: 6,
        regWindow: 24,
        keys,
      });
    }
    default:
      return null;
  }
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  if (msg.type === 'data') {
    dataset = msg.scrobbles;
    sliceCache = null;
    firstPlayCache = null;
    retentionCache = null;
    return;
  }
  if (msg.type === 'genres') {
    genreMap = msg.map;
    return;
  }

  // type === 'compute'
  try {
    const payload = compute(msg.request);
    ctx.postMessage({ id: msg.id, data: { view: msg.request.view, payload } } satisfies WorkerResponse);
  } catch (err) {
    ctx.postMessage({
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};

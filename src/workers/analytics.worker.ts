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
  genreHierarchy,
  networkGraph,
  forecast,
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

function compute(request: AnalyticsRequest): unknown {
  const { view, resolution, topN, groupBy, from, to } = request;
  const slice = rangedSlice(resolution, from, to);

  switch (view) {
    case 'punchcard':
      return punchcard(slice);
    case 'calendar':
      return dailyCounts(slice);
    case 'seasonal':
      return seasonal(slice);
    case 'discovery':
      return discovery(slice);
    case 'rankbump':
      return rankOverTime(slice, resolution, Math.min(topN, 15), (s) => s.artist);
    case 'sunburst':
      return genreHierarchy(slice, genreMap, { topGenres: 12, topArtistsPerGenre: 12 });
    case 'network':
      return networkGraph(slice, genreMap, {
        topN,
        maxNodes: 60,
        minSharedDays: 3,
        maxEdges: 400,
      });
    case 'forecast':
      // Key by genre only when genres are loaded AND the user asked for genre
      // grouping; otherwise forecast per artist so the view is useful
      // immediately, before the rate-limited genre fetch (250ms/artist) lands.
      return forecast(slice, groupBy === 'genre' && Object.keys(genreMap).length > 0 ? genreOf : artistKey, {
        topN,
        horizon: FORECAST_HORIZON,
        smaWindow: 6,
        regWindow: 24,
      });
    default:
      return null;
  }
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  if (msg.type === 'data') {
    dataset = msg.scrobbles;
    sliceCache = null;
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

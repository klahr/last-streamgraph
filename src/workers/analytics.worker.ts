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
  Resolution,
  View,
} from '../types';

/** Per-view request payload (filters only; dataset lives in the worker). */
export interface AnalyticsRequest {
  view: View;
  resolution: Resolution;
  topN: number;
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

let dataset: CountableScrobble[] = [];
let genreMap: Record<string, string> = {};

// Memoize range-filtered slices to avoid re-scanning on every slider tick. The
// ranged slice is identical for all views for a given (from, to), so sharing it
// across views is safe.
let sliceCache: { from?: number; to?: number; slice: CountableScrobble[] } | null = null;

function rangedSlice(from?: number, to?: number): CountableScrobble[] {
  if (from == null && to == null) return dataset;
  if (sliceCache && sliceCache.from === from && sliceCache.to === to) return sliceCache.slice;
  const lo = from ?? -Infinity;
  const hi = to ?? Infinity;
  const slice = dataset.filter((s) => {
    const start = bucketFor(s.uts, 'monthly').start;
    return start >= lo && start <= hi;
  });
  sliceCache = { from, to, slice };
  return slice;
}

// Per-view memo: invalidated whenever the dataset, genre map, or filter window
// changes. Cheap views (punchcard/seasonal) recompute trivially anyway; this
// mainly protects the heavier ones (network, forecast) from re-running on a
// view switch back to a recently-seen view with the same filters.
let memo: { view: View; from?: number; to?: number; payload: unknown } | null = null;

const genreOf = (s: CountableScrobble) =>
  genreMap[s.artist.toLowerCase()] ?? UNKNOWN_GENRE;
const byGenreKey = (s: CountableScrobble) => genreOf(s);

function compute(request: AnalyticsRequest): unknown {
  const { view, resolution, topN, from, to } = request;
  if (memo && memo.view === view && memo.from === from && memo.to === to) return memo.payload;

  const slice = rangedSlice(from, to);

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
      return forecast(slice, byGenreKey, {
        topN: Math.min(topN, 9),
        horizon: 6,
        smaWindow: 3,
        regWindow: 12,
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
    memo = null;
    return;
  }
  if (msg.type === 'genres') {
    genreMap = msg.map;
    memo = null;
    return;
  }

  // type === 'compute'
  try {
    const payload = compute(msg.request);
    memo = { view: msg.request.view, from: msg.request.from, to: msg.request.to, payload };
    ctx.postMessage({ id: msg.id, data: { view: msg.request.view, payload } } satisfies WorkerResponse);
  } catch (err) {
    ctx.postMessage({
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};

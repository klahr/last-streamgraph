// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pure data-processing pipeline: raw scrobbles -> a dense, stack-ready matrix.
 *
 * Everything here is side-effect free and synchronous so it can run inside a
 * Web Worker and be unit-tested directly. Times are handled in UTC throughout
 * to keep bucket boundaries deterministic regardless of the viewer's timezone.
 */
import type {
  OthersMode,
  ProcessedData,
  ProcessRequest,
  Resolution,
  Scrobble,
  StackDatum,
} from '../types';

export const OTHERS_KEY = 'Others';
const DAY_MS = 86_400_000;

export interface Bucket {
  /** Bucket start, epoch ms (UTC). Stable identity for the bucket. */
  start: number;
  /** Display label (e.g. "2025-01" or "2025-W03"). */
  label: string;
}

/** Monday 00:00 UTC of the ISO week containing `d`. */
function isoWeekStart(d: Date): Date {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7; // Sunday (0) -> 7
  date.setUTCDate(date.getUTCDate() - (day - 1));
  return date;
}

/** ISO-8601 week number and week-year for `d`. */
function isoWeekParts(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day); // shift to the week's Thursday
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Map a scrobble timestamp (epoch seconds) to its bucket for a resolution. */
export function bucketFor(uts: number, resolution: Resolution): Bucket {
  const d = new Date(uts * 1000);
  if (resolution === 'yearly') {
    return { start: Date.UTC(d.getUTCFullYear(), 0, 1), label: `${d.getUTCFullYear()}` };
  }
  if (resolution === 'monthly') {
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    return { start, label: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}` };
  }
  const monday = isoWeekStart(d);
  const { year, week } = isoWeekParts(d);
  return { start: monday.getTime(), label: `${year}-W${pad2(week)}` };
}

/** Advance a bucket-start (epoch ms, UTC) by one step of the resolution. */
export function nextBucketStart(start: number, resolution: Resolution): number {
  if (resolution === 'weekly') return start + 7 * DAY_MS;
  const d = new Date(start);
  if (resolution === 'yearly') return Date.UTC(d.getUTCFullYear() + 1, 0, 1);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export function labelForStart(start: number, resolution: Resolution): string {
  // Derive a label from the bucket start (mid-bucket sample for weekly avoids
  // boundary ambiguity). Reuse bucketFor by sampling a second into the bucket.
  return bucketFor(Math.floor(start / 1000) + 1, resolution).label;
}

/** Minimal scrobble shape the pipeline actually reads. */
export interface CountableScrobble {
  artist: string;
  uts: number;
  /** Present when album grouping is needed. */
  album?: string;
  /** Present for the track-level views (obsessions, album depth). */
  track?: string;
}

/**
 * The expensive, config-independent part: scan every scrobble once into a
 * per-bucket / per-artist count map. This is the only step that touches all N
 * scrobbles, so callers cache it per resolution and reuse it across cheap
 * config changes (top-N, mode, palette).
 */
export interface Aggregation {
  resolution: Resolution;
  bucketMap: Map<number, Map<string, number>>;
  artistTotals: Map<string, number>;
  minStart: number;
  maxStart: number;
}

/**
 * Build an {@link Aggregation} from raw scrobbles. Range filtering is applied
 * later in {@link buildFromAggregation} (at bucket granularity) so the full
 * aggregation can be cached and reused while a date slider is dragged.
 *
 * `keyOf` maps a scrobble to the series key it counts toward — the artist for
 * artist-grouped views, an artist→genre lookup for genre views, or the album.
 * The rest of the pipeline is agnostic to what the key means.
 */
export function aggregate(
  scrobbles: readonly CountableScrobble[],
  resolution: Resolution,
  keyOf?: (s: CountableScrobble) => string,
): Aggregation {
  const bucketMap = new Map<number, Map<string, number>>();
  const artistTotals = new Map<string, number>();
  let minStart = Infinity;
  let maxStart = -Infinity;

  for (const s of scrobbles) {
    const key = keyOf ? keyOf(s) : s.artist;
    const { start } = bucketFor(s.uts, resolution);
    if (start < minStart) minStart = start;
    if (start > maxStart) maxStart = start;
    let row = bucketMap.get(start);
    if (!row) {
      row = new Map();
      bucketMap.set(start, row);
    }
    row.set(key, (row.get(key) ?? 0) + 1);
    artistTotals.set(key, (artistTotals.get(key) ?? 0) + 1);
  }

  return { resolution, bucketMap, artistTotals, minStart, maxStart };
}

/**
 * The cheap part: from a precomputed {@link Aggregation}, select the
 * **union of per-interval top-`topN`** artists, fold the rest into "Others"
 * (or discard), and emit a dense, zero-filled matrix. Touches buckets/artists,
 * not the full scrobble list — fast enough to re-run on every slider tick.
 *
 * The union can explode (top-100 per month over ~17 years ≈ 5,000 artists),
 * which is both unrenderable and visually meaningless. So we keep only the
 * top `maxStreams` of the union by overall total; the long tail folds into
 * "Others" (or is discarded). This bounds the path count the renderer sees.
 */
export const DEFAULT_MAX_STREAMS = 150;

export function buildFromAggregation(
  agg: Aggregation,
  opts: {
    topN: number;
    othersMode: OthersMode;
    maxStreams?: number;
    /** Inclusive bucket-level date window (epoch ms). Omit for all-time. */
    from?: number;
    to?: number;
  },
): ProcessedData {
  const { resolution, bucketMap, minStart, maxStart } = agg;
  const { topN, othersMode } = opts;
  const maxStreams = opts.maxStreams ?? DEFAULT_MAX_STREAMS;
  const from = opts.from ?? -Infinity;
  const to = opts.to ?? Infinity;
  const ranged = opts.from != null || opts.to != null;
  const inRange = (start: number) => start >= from && start <= to;

  if (bucketMap.size === 0) {
    return { keys: [], matrix: [], totals: {}, grandTotal: 0 };
  }

  // Selection: union of each in-range bucket's top-`topN` (ties broken by name).
  // When ranged we also recompute per-artist totals over the window (the
  // cached agg.artistTotals is all-time); otherwise reuse the cached totals.
  const selected = new Set<string>();
  const artistTotals = ranged ? new Map<string, number>() : agg.artistTotals;
  for (const [start, row] of bucketMap) {
    if (!inRange(start)) continue;
    const top = [...row.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, topN);
    for (const [artist] of top) selected.add(artist);
    if (ranged) {
      for (const [a, c] of row) artistTotals.set(a, (artistTotals.get(a) ?? 0) + c);
    }
  }

  if (selected.size === 0) {
    return { keys: [], matrix: [], totals: {}, grandTotal: 0 };
  }

  // Rank the union by overall total and cap to `maxStreams` renderable streams.
  const ranked = [...selected].sort(
    (a, b) =>
      (artistTotals.get(b) ?? 0) - (artistTotals.get(a) ?? 0) ||
      (a < b ? -1 : 1),
  );
  const keptList = ranked.slice(0, maxStreams);
  const kept = new Set(keptList);

  // "Others" absorbs everything not kept: artists outside the union AND the
  // capped tail of the union.
  const hasOthers =
    othersMode === 'group' &&
    [...artistTotals.keys()].some((a) => !kept.has(a));

  const keys = [...keptList];
  if (hasOthers) keys.push(OTHERS_KEY);

  const totals: Record<string, number> = {};
  for (const k of kept) totals[k] = artistTotals.get(k) ?? 0;
  if (hasOthers) {
    let others = 0;
    for (const [a, c] of artistTotals) if (!kept.has(a)) others += c;
    totals[OTHERS_KEY] = others;
  }
  // grandTotal is the TRUE in-range play count (all artists, kept or not):
  // in `discard` mode `keys` omits the capped tail, so summing `keys` would
  // undercount — and the App header reports this number as "plays across N
  // months", which must reflect everything in the window.
  let grandTotal = 0;
  for (const c of artistTotals.values()) grandTotal += c;

  const matrix: StackDatum[] = [];
  for (
    let start = minStart;
    start <= maxStart;
    start = nextBucketStart(start, resolution)
  ) {
    if (!inRange(start)) continue;
    const row = bucketMap.get(start);
    const datum: StackDatum = { date: start, label: labelForStart(start, resolution) };
    for (const k of kept) datum[k] = row?.get(k) ?? 0;
    if (hasOthers) {
      let others = 0;
      if (row) for (const [a, c] of row) if (!kept.has(a)) others += c;
      datum[OTHERS_KEY] = others;
    }
    matrix.push(datum);
  }

  return { keys, matrix, totals, grandTotal };
}

/**
 * Transform raw scrobbles into a dense per-bucket count matrix — the union of
 * per-interval top-`topN` artists over a continuous, zero-filled time axis.
 * Equivalent to `buildFromAggregation(aggregate(...), ...)`; kept as a
 * one-shot entry point for tests and callers without a cache.
 */
export function processScrobbles(req: ProcessRequest): ProcessedData {
  const agg = aggregate(req.scrobbles, req.resolution);
  return buildFromAggregation(agg, {
    topN: req.topN,
    othersMode: req.othersMode,
    from: req.from,
    to: req.to,
  });
}

/** Convenience wrapper used by tests / callers that already hold an array. */
export function process(
  scrobbles: Scrobble[],
  resolution: Resolution,
  topN: number,
  othersMode: OthersMode,
  range?: { from?: number; to?: number },
): ProcessedData {
  return processScrobbles({ scrobbles, resolution, topN, othersMode, ...range });
}

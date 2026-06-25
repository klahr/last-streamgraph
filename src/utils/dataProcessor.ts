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
function nextBucketStart(start: number, resolution: Resolution): number {
  if (resolution === 'weekly') return start + 7 * DAY_MS;
  const d = new Date(start);
  if (resolution === 'yearly') return Date.UTC(d.getUTCFullYear() + 1, 0, 1);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

function labelForStart(start: number, resolution: Resolution): string {
  // Derive a label from the bucket start (mid-bucket sample for weekly avoids
  // boundary ambiguity). Reuse bucketFor by sampling a second into the bucket.
  return bucketFor(Math.floor(start / 1000) + 1, resolution).label;
}

/**
 * Transform raw scrobbles into a dense per-bucket count matrix.
 *
 * - Filters to an optional [from, to] range (epoch ms).
 * - Selects artists by the **union of per-interval top-`topN`**: an artist
 *   becomes a stream if it ranked in the top `topN` of *any* single bucket.
 *   This surfaces artists who dominated one period even if their all-time
 *   total is modest. Non-selected plays fold into "Others" or are discarded.
 * - Emits every bucket between the first and last play (zero-filled) so the
 *   stream flows continuously with no gaps on the time axis.
 */
export function processScrobbles(req: ProcessRequest): ProcessedData {
  const { resolution, topN, othersMode } = req;
  const from = req.from ?? -Infinity;
  const to = req.to ?? Infinity;

  const scrobbles = req.scrobbles.filter((s) => {
    const ms = s.uts * 1000;
    return ms >= from && ms <= to;
  });

  if (scrobbles.length === 0) {
    return { keys: [], matrix: [], totals: {}, grandTotal: 0 };
  }

  // 1. Accumulate full per-artist counts per bucket + overall totals.
  const bucketMap = new Map<number, Map<string, number>>();
  const artistTotals = new Map<string, number>();
  let minStart = Infinity;
  let maxStart = -Infinity;

  for (const s of scrobbles) {
    const { start } = bucketFor(s.uts, resolution);
    if (start < minStart) minStart = start;
    if (start > maxStart) maxStart = start;
    let row = bucketMap.get(start);
    if (!row) {
      row = new Map();
      bucketMap.set(start, row);
    }
    row.set(s.artist, (row.get(s.artist) ?? 0) + 1);
    artistTotals.set(s.artist, (artistTotals.get(s.artist) ?? 0) + 1);
  }

  // 2. Selection: union of each bucket's top-`topN` artists. Ties broken by
  //    name so the result is deterministic.
  const selected = new Set<string>();
  for (const row of bucketMap.values()) {
    const top = [...row.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, topN);
    for (const [artist] of top) selected.add(artist);
  }

  const hasOthers =
    othersMode === 'group' &&
    [...artistTotals.keys()].some((a) => !selected.has(a));

  // 3. Ordered keys: selected artists by overall total desc, "Others" last.
  const keys = [...selected].sort(
    (a, b) =>
      (artistTotals.get(b) ?? 0) - (artistTotals.get(a) ?? 0) ||
      (a < b ? -1 : 1),
  );
  if (hasOthers) keys.push(OTHERS_KEY);

  // 4. Per-key full-range totals (Others = sum of all non-selected plays).
  const totals: Record<string, number> = {};
  for (const k of selected) totals[k] = artistTotals.get(k) ?? 0;
  if (hasOthers) {
    let others = 0;
    for (const [a, c] of artistTotals) if (!selected.has(a)) others += c;
    totals[OTHERS_KEY] = others;
  }
  const grandTotal = keys.reduce((sum, k) => sum + (totals[k] ?? 0), 0);

  // 5. Dense matrix across the full span (zero-filled); non-selected plays
  //    fold into Others per bucket when grouping.
  const matrix: StackDatum[] = [];
  for (
    let start = minStart;
    start <= maxStart;
    start = nextBucketStart(start, resolution)
  ) {
    const row = bucketMap.get(start);
    const datum: StackDatum = { date: start, label: labelForStart(start, resolution) };
    for (const k of selected) datum[k] = row?.get(k) ?? 0;
    if (hasOthers) {
      let others = 0;
      if (row) for (const [a, c] of row) if (!selected.has(a)) others += c;
      datum[OTHERS_KEY] = others;
    }
    matrix.push(datum);
  }

  return { keys, matrix, totals, grandTotal };
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

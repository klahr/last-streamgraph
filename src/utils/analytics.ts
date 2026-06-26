/**
 * Pure aggregations powering the auxiliary visualizations. Each takes the raw
 * scrobble list and reduces it to a small, view-ready shape (a 7×24 grid, a
 * per-day map, ranked series, a forecast, …), so views stay dumb and these stay
 * unit-testable.
 *
 * Time-of-day / day-of-week / calendar views use the **viewer's local time**
 * (that's "your clock" — when you actually listened). Bucketed series reuse the
 * UTC bucketing from {@link bucketFor} to match the streamgraph.
 */
import { bucketFor } from './dataProcessor';
import type { CountableScrobble } from './dataProcessor';

const pad2 = (n: number) => String(n).padStart(2, '0');

/* ------------------------------- Punchcard ------------------------------- */

export interface Punchcard {
  /** counts[day 0=Sun..6][hour 0..23] */
  counts: number[][];
  max: number;
  total: number;
}

export function punchcard(scrobbles: readonly CountableScrobble[]): Punchcard {
  const counts = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let max = 0;
  for (const s of scrobbles) {
    const d = new Date(s.uts * 1000);
    const v = (counts[d.getDay()]![d.getHours()] += 1);
    if (v > max) max = v;
  }
  return { counts, max, total: scrobbles.length };
}

/* --------------------------- Daily calendar ------------------------------ */

export interface DailyCounts {
  /** local "YYYY-MM-DD" -> count */
  byDay: Map<string, number>;
  max: number;
  /** local midnight epoch ms of the first/last day with plays */
  firstMs: number;
  lastMs: number;
}

export function dailyCounts(scrobbles: readonly CountableScrobble[]): DailyCounts {
  const byDay = new Map<string, number>();
  let max = 0;
  let firstMs = Infinity;
  let lastMs = -Infinity;
  for (const s of scrobbles) {
    const d = new Date(s.uts * 1000);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const v = (byDay.get(key) ?? 0) + 1;
    byDay.set(key, v);
    if (v > max) max = v;
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (dayStart < firstMs) firstMs = dayStart;
    if (dayStart > lastMs) lastMs = dayStart;
  }
  return { byDay, max, firstMs, lastMs };
}

/* ----------------------------- Seasonal ---------------------------------- */

/** Total plays per month-of-year (index 0 = January), summed across all years. */
export function seasonal(scrobbles: readonly CountableScrobble[]): number[] {
  const months = new Array<number>(12).fill(0);
  for (const s of scrobbles) months[new Date(s.uts * 1000).getMonth()] += 1;
  return months;
}

/* ----------------------------- Discovery --------------------------------- */

export interface Discovery {
  artist: string;
  firstMs: number;
  count: number;
}

/** First-play time and total count per artist, ordered by first play (asc). */
export function discovery(scrobbles: readonly CountableScrobble[]): Discovery[] {
  const map = new Map<string, { firstMs: number; count: number }>();
  for (const s of scrobbles) {
    const ms = s.uts * 1000;
    const e = map.get(s.artist);
    if (e) {
      e.count += 1;
      if (ms < e.firstMs) e.firstMs = ms;
    } else {
      map.set(s.artist, { firstMs: ms, count: 1 });
    }
  }
  return [...map.entries()]
    .map(([artist, v]) => ({ artist, ...v }))
    .sort((a, b) => a.firstMs - b.firstMs);
}

/* --------------------------- Rank over time ------------------------------ */

export interface RankSeries {
  key: string;
  total: number;
  /** Rank (1 = top) per bucket, or null when the key has no plays that bucket. */
  ranks: (number | null)[];
}
export interface RankData {
  buckets: { ms: number; label: string }[];
  series: RankSeries[];
}

/**
 * Rank position of the top-`topN` keys (by overall total) across monthly-ish
 * buckets. `keyOf` maps a scrobble to its series key (artist / genre / …).
 */
export function rankOverTime(
  scrobbles: readonly CountableScrobble[],
  resolution: 'weekly' | 'monthly' | 'yearly',
  topN: number,
  keyOf: (s: CountableScrobble) => string,
): RankData {
  const bucketRows = new Map<number, { label: string; counts: Map<string, number> }>();
  const totals = new Map<string, number>();
  for (const s of scrobbles) {
    const { start, label } = bucketFor(s.uts, resolution);
    const key = keyOf(s);
    let row = bucketRows.get(start);
    if (!row) {
      row = { label, counts: new Map() };
      bucketRows.set(start, row);
    }
    row.counts.set(key, (row.counts.get(key) ?? 0) + 1);
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }

  const buckets = [...bucketRows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, r]) => ({ ms, label: r.label }));

  const topKeys = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, topN)
    .map(([k]) => k);
  const topSet = new Set(topKeys);

  const series: RankSeries[] = topKeys.map((k) => ({
    key: k,
    total: totals.get(k) ?? 0,
    ranks: [],
  }));

  for (const { ms } of buckets) {
    const row = bucketRows.get(ms)!;
    // Rank only the tracked keys present this bucket.
    const present = [...row.counts.entries()]
      .filter(([k]) => topSet.has(k))
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const rankOf = new Map<string, number>();
    present.forEach(([k], i) => rankOf.set(k, i + 1));
    for (const s of series) s.ranks.push(rankOf.get(s.key) ?? null);
  }

  return { buckets, series };
}

/* ------------------------- Sunburst hierarchy ---------------------------- */

export interface HierNode {
  name: string;
  value?: number;
  children?: HierNode[];
}

/** genre → artist hierarchy for a sunburst/treemap (top genres, top artists each). */
export function genreHierarchy(
  scrobbles: readonly CountableScrobble[],
  genreMap: Record<string, string>,
  opts: { topGenres: number; topArtistsPerGenre: number },
): HierNode {
  const byGenre = new Map<string, Map<string, number>>();
  for (const s of scrobbles) {
    const genre = genreMap[s.artist.toLowerCase()] ?? 'Unknown';
    let artists = byGenre.get(genre);
    if (!artists) {
      artists = new Map();
      byGenre.set(genre, artists);
    }
    artists.set(s.artist, (artists.get(s.artist) ?? 0) + 1);
  }
  const genreTotal = (m: Map<string, number>) =>
    [...m.values()].reduce((a, b) => a + b, 0);
  const genres = [...byGenre.entries()]
    .sort((a, b) => genreTotal(b[1]) - genreTotal(a[1]))
    .slice(0, opts.topGenres);
  return {
    name: 'All',
    children: genres.map(([genre, artists]) => ({
      name: genre,
      children: [...artists.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, opts.topArtistsPerGenre)
        .map(([name, value]) => ({ name, value })),
    })),
  };
}

/* ------------------------- Artist co-play graph ------------------------- */

export interface NetworkNode {
  artist: string;
  count: number;
  genre: string | null;
}
export interface NetworkLink {
  source: string;
  target: string;
  weight: number;
}
export interface NetworkData {
  nodes: NetworkNode[];
  links: NetworkLink[];
}

/** Top-N artist nodes and their co-play edges (shared local-day weight). */
export function networkGraph(
  scrobbles: readonly CountableScrobble[],
  genreMap: Record<string, string>,
  opts: { topN: number; maxNodes: number; minSharedDays: number; maxEdges: number },
): NetworkData {
  if (!scrobbles.length) return { nodes: [], links: [] };

  // Top-N artists by play count.
  const counts = new Map<string, number>();
  for (const s of scrobbles) counts.set(s.artist, (counts.get(s.artist) ?? 0) + 1);

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.min(opts.topN, opts.maxNodes));
  const topSet = new Set(top.map(([artist]) => artist));

  const nodes: NetworkNode[] = top.map(([artist, count]) => ({
    artist,
    count,
    genre: genreMap[artist.toLowerCase()] ?? null,
  }));

  // Co-play on the same local day: artists present per day, then pair weights.
  const dayArtists = new Map<string, Set<string>>();
  for (const s of scrobbles) {
    if (!topSet.has(s.artist)) continue;
    const d = new Date(s.uts * 1000);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let set = dayArtists.get(key);
    if (!set) {
      set = new Set();
      dayArtists.set(key, set);
    }
    set.add(s.artist);
  }

  const pairWeights = new Map<string, { source: string; target: string; weight: number }>();
  for (const set of dayArtists.values()) {
    const present = [...set].sort();
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        // Key on a control character artist names can't contain so multi-word
        // names ("Fleetwood Mac") don't corrupt the pair when decoded.
        const k = `${present[i]}\u0000${present[j]}`;
        const e = pairWeights.get(k);
        if (e) e.weight += 1;
        else pairWeights.set(k, { source: present[i]!, target: present[j]!, weight: 1 });
      }
    }
  }

  const links: NetworkLink[] = [...pairWeights.values()]
    .filter((e) => e.weight >= opts.minSharedDays)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, opts.maxEdges)
    .map(({ source, target, weight }) => ({ source, target, weight }));

  return { nodes, links };
}

/* ------------------------------ Forecast --------------------------------- */

export interface ForecastSeries {
  key: string;
  total: number;
  history: { ms: number; value: number }[];
  /** Simple moving average aligned to `history` (null until the window fills). */
  sma: (number | null)[];
  /** Projected future months with a ±band. */
  projection: { ms: number; value: number; lo: number; hi: number }[];
  slope: number;
  trend: 'rising' | 'falling' | 'flat';
}

/** Step one calendar month forward from a UTC month-start. */
function nextMonth(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/**
 * TA-style projection: monthly plays per top-`topN` series → SMA + a
 * least-squares trend over the recent window, extrapolated `horizon` months
 * ahead with a residual-based uncertainty band. Naive by design.
 */
export function forecast(
  scrobbles: readonly CountableScrobble[],
  keyOf: (s: CountableScrobble) => string,
  opts: { topN: number; horizon: number; smaWindow: number; regWindow: number },
): ForecastSeries[] {
  const { topN, horizon, smaWindow, regWindow } = opts;
  const byKey = new Map<number, Map<string, number>>();
  const totals = new Map<string, number>();
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const s of scrobbles) {
    const { start } = bucketFor(s.uts, 'monthly');
    if (start < minMs) minMs = start;
    if (start > maxMs) maxMs = start;
    let row = byKey.get(start);
    if (!row) {
      row = new Map();
      byKey.set(start, row);
    }
    const k = keyOf(s);
    row.set(k, (row.get(k) ?? 0) + 1);
    totals.set(k, (totals.get(k) ?? 0) + 1);
  }
  if (!Number.isFinite(minMs)) return [];

  const monthStarts: number[] = [];
  for (let m = minMs; m <= maxMs; m = nextMonth(m)) monthStarts.push(m);

  const topKeys = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, topN)
    .map(([k]) => k);

  return topKeys.map((key) => {
    const history = monthStarts.map((ms) => ({
      ms,
      value: byKey.get(ms)?.get(key) ?? 0,
    }));

    const sma = history.map((_, i) => {
      if (i < smaWindow - 1) return null;
      let sum = 0;
      for (let j = i - smaWindow + 1; j <= i; j++) sum += history[j]!.value;
      return sum / smaWindow;
    });

    // Least-squares fit over the last regWindow points.
    const win = history.slice(-regWindow);
    const n = win.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    win.forEach((p, x) => {
      sx += x; sy += p.value; sxx += x * x; sxy += x * p.value;
    });
    const denom = n * sxx - sx * sx;
    const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
    const intercept = (sy - slope * sx) / n;
    // Residual stddev for the band.
    let ss = 0;
    win.forEach((p, x) => {
      const fit = intercept + slope * x;
      ss += (p.value - fit) ** 2;
    });
    const resStd = n > 2 ? Math.sqrt(ss / (n - 2)) : 0;
    const band = 1.96 * resStd;

    const projection: ForecastSeries['projection'] = [];
    let ms = maxMs;
    for (let h = 1; h <= horizon; h++) {
      ms = nextMonth(ms);
      const value = Math.max(0, intercept + slope * (n - 1 + h));
      projection.push({
        ms,
        value,
        lo: Math.max(0, value - band),
        hi: value + band,
      });
    }

    const monthlyAvg = (totals.get(key) ?? 0) / Math.max(1, history.length);
    const flatThreshold = 0.05 * monthlyAvg;
    const trend =
      slope > flatThreshold ? 'rising' : slope < -flatThreshold ? 'falling' : 'flat';

    return { key, total: totals.get(key) ?? 0, history, sma, projection, slope, trend };
  });
}

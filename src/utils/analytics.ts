// SPDX-License-Identifier: GPL-3.0-or-later
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
import { bucketFor, labelForStart, nextBucketStart } from './dataProcessor';
import type { CountableScrobble } from './dataProcessor';
import type { Resolution } from '../types';

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

/**
 * When each artist was *genuinely* discovered — defined as the timestamp of
 * the scrobble at which the artist crosses `minPlays` cumulative plays, not
 * their earliest scrobble.
 *
 * The first-scrobble definition produced a false-positive wall at the start
 * of the timeline: a Last.fm signup or back-catalog import stamps thousands
 * of artists with an early “first play” that was really just a data import, not
 * real discovery. Requiring repeated listening before an artist counts spreads
 * the distribution across the period you actually engaged with them. Artists
 * who never reach the threshold (drive-by single plays, import-only entries)
 * are dropped entirely.
 */
export function discovery(
  scrobbles: readonly CountableScrobble[],
  opts: { minPlays?: number } = {},
): Discovery[] {
  const minPlays = Math.max(1, opts.minPlays ?? 5);
  // Bucket one timestamp per play, per artist. A single pass; the per-artist
  // arrays are small even for big libraries.
  const byArtist = new Map<string, number[]>();
  for (const s of scrobbles) {
    let arr = byArtist.get(s.artist);
    if (!arr) {
      arr = [];
      byArtist.set(s.artist, arr);
    }
    arr.push(s.uts * 1000);
  }

  const out: Discovery[] = [];
  for (const [artist, times] of byArtist) {
    if (times.length < minPlays) continue; // never reached the threshold
    // The discovery date is the timestamp of the play that crossed the
    // threshold (the Nth-earliest), so order matters, not just the min/max.
    times.sort((a, b) => a - b);
    out.push({ artist, firstMs: times[minPlays - 1]!, count: times.length });
  }
  return out.sort((a, b) => a.firstMs - b.firstMs);
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
 * least-squares trend over a recent window, extrapolated `horizon` months
 * ahead with a residual-based uncertainty band. Naive by design.
 *
 * The trend widens with the selected range: a short interval fits a reactive
 * recent trend, a large interval fits a longer (but still recent-anchored)
 * trend, so the range selection actually drives the horizon of the fit.
 *
 * When `opts.keys` is provided, forecast exactly those keys (ignoring
 * `topN`); otherwise take the top-`topN` keys by total play count.
 */
export function forecast(
  scrobbles: readonly CountableScrobble[],
  keyOf: (s: CountableScrobble) => string,
  opts: {
    topN: number;
    horizon: number;
    smaWindow: number;
    regWindow: number;
    /** Optional explicit key set; overrides the top-N selection. */
    keys?: string[];
  },
): ForecastSeries[] {
  const { topN, horizon } = opts;
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

  // Scale the trend window to the selected range so the interval drives the
  // fit horizon: short ranges fit a reactive recent trend, large ranges fit a
  // longer trend — but cap it so a decade of history doesn't extrapolate stale
  // 2009 drift. `opts.regWindow`/`opts.smaWindow` are the caps; the actual span
  // grows up to them via `monthStarts.length`.
  const spanMonths = monthStarts.length;
  const regWindow = Math.min(opts.regWindow, Math.max(6, spanMonths));
  const smaWindow = Math.min(opts.smaWindow, Math.max(2, Math.round(spanMonths / 6)));

  const topKeys = opts.keys
    ? opts.keys
    : [...totals.entries()]
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

/* ------------------------------ Obsessions ------------------------------- */

/**
 * Composite-key separator. Artist/track/album names can't contain a control
 * character, so joining on one keeps names with separators intact when the key
 * is split back apart (same reason as {@link networkGraph}'s pair key).
 */
const SEP = '\u0000';

/** One track and the shape of its most intense listening burst. */
export interface Obsession {
  track: string;
  artist: string;
  /** Plays in range. */
  total: number;
  /** Most plays falling inside any `windowDays`-wide sliding window. */
  peak: number;
  /** Start of that peak window (epoch ms). */
  peakMs: number;
  /** peak / total. 1.0 = every play happened inside one window. */
  concentration: number;
  /** peak × concentration. Ranks bursts that are both big *and* tight. */
  score: number;
  /** Plays per week, aligned index-for-index to {@link ObsessionData.weeks}. */
  series: number[];
}

export interface ObsessionData {
  /** Shared weekly grid, so every sparkline reads against one timeline. */
  weeks: number[];
  tracks: Obsession[];
}

/**
 * The tracks you played into the ground: ranked not by total plays (that just
 * lists your favourites again) but by *burst* — how much of a track's listening
 * piled into a single window.
 *
 * Ranking on concentration alone would crown every track that happens to have
 * all `minPlays` of its plays on one afternoon, so the score multiplies
 * concentration by the peak count: a 40-plays-in-a-week binge outranks an
 * 8-plays-in-a-week one, and both outrank 200 plays spread evenly over a decade.
 */
export function obsessions(
  scrobbles: readonly CountableScrobble[],
  opts: { limit?: number; minPlays?: number; windowDays?: number } = {},
): ObsessionData {
  const limit = Math.max(1, opts.limit ?? 24);
  const minPlays = Math.max(2, opts.minPlays ?? 8);
  const windowMs = (opts.windowDays ?? 7) * 86_400_000;

  const byTrack = new Map<string, number[]>();
  let minUts = Infinity;
  let maxUts = -Infinity;
  for (const s of scrobbles) {
    if (s.uts < minUts) minUts = s.uts;
    if (s.uts > maxUts) maxUts = s.uts;
    if (!s.track) continue; // untitled, or a dataset uploaded without tracks
    const k = `${s.artist}${SEP}${s.track}`;
    let arr = byTrack.get(k);
    if (!arr) {
      arr = [];
      byTrack.set(k, arr);
    }
    arr.push(s.uts * 1000);
  }
  if (!byTrack.size || !Number.isFinite(minUts)) return { weeks: [], tracks: [] };

  const ranked: (Omit<Obsession, 'series'> & { key: string })[] = [];
  for (const [k, times] of byTrack) {
    const total = times.length;
    if (total < minPlays) continue;
    times.sort((a, b) => a - b);
    // Two-pointer sweep: for each play, how many plays fall within windowMs of
    // it. Exact timestamps, not bucket-aligned, so "40 plays in one week" means
    // a real seven-day stretch rather than a calendar week that happens to
    // straddle the binge.
    let peak = 0;
    let peakMs = times[0]!;
    let lo = 0;
    for (let hi = 0; hi < total; hi++) {
      while (times[hi]! - times[lo]! > windowMs) lo++;
      const n = hi - lo + 1;
      if (n > peak) {
        peak = n;
        peakMs = times[lo]!;
      }
    }
    const sep = k.indexOf(SEP);
    const concentration = peak / total;
    ranked.push({
      key: k,
      artist: k.slice(0, sep),
      track: k.slice(sep + 1),
      total,
      peak,
      peakMs,
      concentration,
      score: peak * concentration,
    });
  }
  if (!ranked.length) return { weeks: [], tracks: [] };

  ranked.sort((a, b) => b.score - a.score || b.total - a.total);
  const top = ranked.slice(0, limit);

  // Weekly grid spanning the whole slice. ISO week starts are exactly 7 days
  // apart in UTC, so plain addition stays aligned (no DST to straddle).
  const WEEK_MS = 7 * 86_400_000;
  const gridStart = bucketFor(minUts, 'weekly').start;
  const gridEnd = bucketFor(maxUts, 'weekly').start;
  const weeks: number[] = [];
  for (let w = gridStart; w <= gridEnd; w += WEEK_MS) weeks.push(w);
  const indexOfWeek = new Map(weeks.map((w, i) => [w, i]));

  const tracks: Obsession[] = top.map(({ key, ...t }) => {
    const series = new Array<number>(weeks.length).fill(0);
    for (const ms of byTrack.get(key)!) {
      const i = indexOfWeek.get(bucketFor(Math.floor(ms / 1000), 'weekly').start);
      if (i != null) series[i] += 1;
    }
    return { ...t, series };
  });

  return { weeks, tracks };
}

/* ---------------------- Novelty (new vs. familiar) ----------------------- */

export interface NoveltyBucket {
  ms: number;
  label: string;
  /** Plays by artists making their first-ever appearance in this bucket. */
  fresh: number;
  /** Plays by artists already heard before this bucket. */
  familiar: number;
  /** Distinct artists debuting in this bucket. */
  debuts: number;
}

export interface NoveltyData {
  buckets: NoveltyBucket[];
  totals: { fresh: number; familiar: number };
}

/**
 * artist → first-ever play (epoch ms).
 *
 * Always build this from the **full** history, never from a filtered slice:
 * scoped to a window, every artist in it looks like a fresh discovery and the
 * novelty split degenerates towards 100% new whenever the date filter moves.
 */
export function firstPlayMap(
  scrobbles: readonly CountableScrobble[],
): Map<string, number> {
  const first = new Map<string, number>();
  for (const s of scrobbles) {
    const ms = s.uts * 1000;
    const prev = first.get(s.artist);
    if (prev == null || ms < prev) first.set(s.artist, ms);
  }
  return first;
}

/**
 * Exploring, or comforting yourself? Splits each bucket's plays into artists
 * debuting *in that bucket* versus artists you already knew, so the ratio reads
 * as an openness index over time.
 */
export function novelty(
  scrobbles: readonly CountableScrobble[],
  resolution: Resolution,
  firstPlay: ReadonlyMap<string, number>,
): NoveltyData {
  const rows = new Map<
    number,
    { fresh: number; familiar: number; debuts: Set<string> }
  >();
  // artist -> the bucket their first-ever play lands in. Memoized because
  // bucketFor would otherwise run per scrobble and artists repeat heavily.
  const debutBucket = new Map<string, number>();
  let minStart = Infinity;
  let maxStart = -Infinity;

  for (const s of scrobbles) {
    const { start } = bucketFor(s.uts, resolution);
    if (start < minStart) minStart = start;
    if (start > maxStart) maxStart = start;
    let debut = debutBucket.get(s.artist);
    if (debut == null) {
      const firstMs = firstPlay.get(s.artist) ?? s.uts * 1000;
      debut = bucketFor(Math.floor(firstMs / 1000), resolution).start;
      debutBucket.set(s.artist, debut);
    }
    let row = rows.get(start);
    if (!row) {
      row = { fresh: 0, familiar: 0, debuts: new Set() };
      rows.set(start, row);
    }
    if (debut === start) {
      row.fresh += 1;
      row.debuts.add(s.artist);
    } else {
      row.familiar += 1;
    }
  }
  if (!Number.isFinite(minStart)) {
    return { buckets: [], totals: { fresh: 0, familiar: 0 } };
  }

  // Densify: an area chart must not interpolate a straight line across a silent
  // year, so empty buckets are emitted as explicit zeroes.
  const buckets: NoveltyBucket[] = [];
  const totals = { fresh: 0, familiar: 0 };
  for (let ms = minStart; ms <= maxStart; ms = nextBucketStart(ms, resolution)) {
    const row = rows.get(ms);
    const fresh = row?.fresh ?? 0;
    const familiar = row?.familiar ?? 0;
    totals.fresh += fresh;
    totals.familiar += familiar;
    buckets.push({
      ms,
      label: labelForStart(ms, resolution),
      fresh,
      familiar,
      debuts: row?.debuts.size ?? 0,
    });
  }
  return { buckets, totals };
}

/* ---------------------------- Artist tenure ------------------------------ */

export interface Tenure {
  artist: string;
  /** First and last play in range (epoch ms). */
  firstMs: number;
  lastMs: number;
  count: number;
  /** Distinct local days with at least one play — how often they showed up. */
  activeDays: number;
}

/**
 * Lifers vs. flings: each artist's span from first to last play in range.
 * {@link discovery} plots debuts as points; this shows how long anyone actually
 * stayed, and `activeDays` separates a decade-long companion from an artist
 * whose whole span is two bursts of obsession years apart.
 *
 * Two passes, so the day-sets (the expensive part) are built only for the top-N
 * artists rather than for every long-tail name in the library.
 */
export function tenure(
  scrobbles: readonly CountableScrobble[],
  opts: { topN: number },
): Tenure[] {
  const counts = new Map<string, number>();
  for (const s of scrobbles) counts.set(s.artist, (counts.get(s.artist) ?? 0) + 1);
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, Math.max(1, opts.topN));
  if (!top.length) return [];

  const tracked = new Map(
    top.map(([artist, count]) => [
      artist,
      { count, firstMs: Infinity, lastMs: -Infinity, days: new Set<string>() },
    ]),
  );
  for (const s of scrobbles) {
    const row = tracked.get(s.artist);
    if (!row) continue;
    const ms = s.uts * 1000;
    if (ms < row.firstMs) row.firstMs = ms;
    if (ms > row.lastMs) row.lastMs = ms;
    const d = new Date(ms);
    row.days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }

  return [...tracked.entries()]
    .map(([artist, r]) => ({
      artist,
      firstMs: r.firstMs,
      lastMs: r.lastMs,
      count: r.count,
      activeDays: r.days.size,
    }))
    .sort((a, b) => a.firstMs - b.firstMs || b.count - a.count);
}

/* ---------------------------- Genre × hour ------------------------------- */

export interface GenreHourRow {
  genre: string;
  total: number;
  /** Plays per local hour, index 0..23. */
  counts: number[];
  /** Busiest single hour. */
  peakHour: number;
  /** Circular mean of play hours — the genre's centre of gravity in the day. */
  meanHour: number;
}

export interface GenreHours {
  rows: GenreHourRow[];
  total: number;
}

/**
 * What you play at 3am. {@link punchcard} shows when you listen overall; this
 * slices the same clock by genre, so each row is one genre's daily shape.
 *
 * Rows come back sorted by circular-mean hour rather than by size, which puts
 * the morning genres at the top and the nocturnal ones at the bottom. The mean
 * has to be circular: averaging 23:00 and 01:00 arithmetically lands on noon,
 * which would scatter exactly the late-night genres this view exists to find.
 */
export function genreHours(
  scrobbles: readonly CountableScrobble[],
  genreMap: Record<string, string>,
  opts: { topGenres: number },
): GenreHours {
  const byGenre = new Map<string, number[]>();
  let total = 0;
  for (const s of scrobbles) {
    const genre = genreMap[s.artist.toLowerCase()] ?? 'Unknown';
    let counts = byGenre.get(genre);
    if (!counts) {
      counts = new Array<number>(24).fill(0);
      byGenre.set(genre, counts);
    }
    counts[new Date(s.uts * 1000).getHours()] += 1;
    total += 1;
  }

  const rows = [...byGenre.entries()]
    .map(([genre, counts]) => {
      let sum = 0;
      let peakHour = 0;
      let sin = 0;
      let cos = 0;
      counts.forEach((c, h) => {
        sum += c;
        if (c > counts[peakHour]!) peakHour = h;
        const angle = (2 * Math.PI * h) / 24;
        sin += c * Math.sin(angle);
        cos += c * Math.cos(angle);
      });
      const mean = (Math.atan2(sin, cos) * 24) / (2 * Math.PI);
      return { genre, total: sum, counts, peakHour, meanHour: (mean + 24) % 24 };
    })
    // Size picks *which* genres appear; the clock decides their order.
    .sort((a, b) => b.total - a.total)
    .slice(0, Math.max(1, opts.topGenres))
    .sort((a, b) => a.meanHour - b.meanHour);

  return { rows, total };
}

/* ---------------------------- Album depth -------------------------------- */

export interface AlbumDepth {
  album: string;
  artist: string;
  plays: number;
  /** How many of the album's tracks you've played. */
  distinctTracks: number;
  /** plays / distinctTracks — how hard you leaned on the tracks you did play. */
  playsPerTrack: number;
  firstMs: number;
  lastMs: number;
}

/**
 * Deep cuts vs. hits: an album's breadth (distinct tracks played) against its
 * depth (total plays). Albums you lived inside sit top-right; a single you heard
 * once sits bottom-left.
 *
 * Honest limit: scrobbles carry no track numbers or tracklists, so this measures
 * how much of an album *you* touched — not how much of it exists, and not
 * whether you played it in order.
 *
 * Blank album titles are skipped rather than merged into one "Unknown" bucket,
 * which would otherwise dominate the chart as a meaningless outlier.
 */
export function albumDepth(
  scrobbles: readonly CountableScrobble[],
  opts: { limit?: number; minPlays?: number } = {},
): AlbumDepth[] {
  const limit = Math.max(1, opts.limit ?? 150);
  const minPlays = Math.max(1, opts.minPlays ?? 3);

  const byAlbum = new Map<
    string,
    { plays: number; tracks: Set<string>; firstMs: number; lastMs: number }
  >();
  for (const s of scrobbles) {
    if (!s.album || !s.track) continue;
    const k = `${s.artist}${SEP}${s.album}`;
    let row = byAlbum.get(k);
    if (!row) {
      row = { plays: 0, tracks: new Set(), firstMs: Infinity, lastMs: -Infinity };
      byAlbum.set(k, row);
    }
    const ms = s.uts * 1000;
    row.plays += 1;
    // Case-fold: Last.fm returns the same track with inconsistent casing often
    // enough that the raw string would inflate an album's breadth.
    row.tracks.add(s.track.toLowerCase());
    if (ms < row.firstMs) row.firstMs = ms;
    if (ms > row.lastMs) row.lastMs = ms;
  }

  const out: AlbumDepth[] = [];
  for (const [k, row] of byAlbum) {
    if (row.plays < minPlays) continue;
    const sep = k.indexOf(SEP);
    out.push({
      artist: k.slice(0, sep),
      album: k.slice(sep + 1),
      plays: row.plays,
      distinctTracks: row.tracks.size,
      playsPerTrack: row.plays / row.tracks.size,
      firstMs: row.firstMs,
      lastMs: row.lastMs,
    });
  }
  return out.sort((a, b) => b.plays - a.plays).slice(0, limit);
}

/* ------------------------------ Sessions --------------------------------- */

export interface SessionBin {
  label: string;
  /** Inclusive play-count bounds of the bin (`to` may be Infinity). */
  from: number;
  to: number;
  count: number;
}

export interface SessionsData {
  /** The silence that ends a session, echoed back for the view's copy. */
  gapMinutes: number;
  count: number;
  totalPlays: number;
  meanPlays: number;
  medianPlays: number;
  /** Median wall-clock length in minutes (a single-play session is 0). */
  medianMinutes: number;
  lengthBins: SessionBin[];
  /** Sessions *started* per local hour, index 0..23. */
  startHours: number[];
  longest: {
    startMs: number;
    endMs: number;
    plays: number;
    topArtist: string;
    /** The top artist's share of that session's plays. */
    topShare: number;
  } | null;
}

const SESSION_BINS: { label: string; from: number; to: number }[] = [
  { label: '1', from: 1, to: 1 },
  { label: '2–3', from: 2, to: 3 },
  { label: '4–6', from: 4, to: 6 },
  { label: '7–12', from: 7, to: 12 },
  { label: '13–25', from: 13, to: 25 },
  { label: '26–50', from: 26, to: 50 },
  { label: '51+', from: 51, to: Infinity },
];

/**
 * Listening blocks: consecutive plays separated by less than `gapMinutes` of
 * silence count as one sitting, which turns a flat play stream into sessions you
 * can count, measure and time.
 *
 * A heuristic, and knowingly so: a scrobble records when a track *started* and
 * carries no duration, so a boundary is inferred from the gap alone — hence an
 * adjustable threshold rather than a hardcoded one. From here, a long track and
 * a short break look identical.
 */
export function sessions(
  scrobbles: readonly CountableScrobble[],
  opts: { gapMinutes?: number } = {},
): SessionsData {
  const gapMinutes = Math.max(1, opts.gapMinutes ?? 30);
  const gapMs = gapMinutes * 60_000;
  if (!scrobbles.length) {
    return {
      gapMinutes,
      count: 0,
      totalPlays: 0,
      meanPlays: 0,
      medianPlays: 0,
      medianMinutes: 0,
      lengthBins: SESSION_BINS.map((b) => ({ ...b, count: 0 })),
      startHours: new Array<number>(24).fill(0),
      longest: null,
    };
  }

  // Don't assume input order: the cache is keyed by composite id, not by time.
  const plays = scrobbles
    .map((s) => ({ ms: s.uts * 1000, artist: s.artist }))
    .sort((a, b) => a.ms - b.ms);

  // Session boundaries as index pairs; per-session artist tallies are deferred
  // so only the winner pays for them.
  const found: { startIdx: number; endIdx: number; startMs: number; endMs: number }[] = [];
  let startIdx = 0;
  for (let i = 1; i <= plays.length; i++) {
    const broke = i === plays.length || plays[i]!.ms - plays[i - 1]!.ms > gapMs;
    if (!broke) continue;
    found.push({
      startIdx,
      endIdx: i - 1,
      startMs: plays[startIdx]!.ms,
      endMs: plays[i - 1]!.ms,
    });
    startIdx = i;
  }

  const startHours = new Array<number>(24).fill(0);
  const lengthBins = SESSION_BINS.map((b) => ({ ...b, count: 0 }));
  const playCounts: number[] = [];
  const durations: number[] = [];
  let longestIdx = 0;
  let longestPlays = 0;
  found.forEach((s, i) => {
    const n = s.endIdx - s.startIdx + 1;
    playCounts.push(n);
    durations.push((s.endMs - s.startMs) / 60_000);
    startHours[new Date(s.startMs).getHours()] += 1;
    const bin = lengthBins.find((b) => n >= b.from && n <= b.to);
    if (bin) bin.count += 1;
    if (n > longestPlays) {
      longestPlays = n;
      longestIdx = i;
    }
  });

  const median = (xs: number[]) => {
    if (!xs.length) return 0;
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };

  const best = found[longestIdx]!;
  const bestArtists = new Map<string, number>();
  for (let i = best.startIdx; i <= best.endIdx; i++) {
    const a = plays[i]!.artist;
    bestArtists.set(a, (bestArtists.get(a) ?? 0) + 1);
  }
  const [topArtist, topCount] = [...bestArtists.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0]!;

  return {
    gapMinutes,
    count: found.length,
    totalPlays: plays.length,
    meanPlays: plays.length / found.length,
    medianPlays: median(playCounts),
    medianMinutes: median(durations),
    lengthBins,
    startHours,
    longest: {
      startMs: best.startMs,
      endMs: best.endMs,
      plays: longestPlays,
      topArtist,
      topShare: topCount / longestPlays,
    },
  };
}

/* --------------------------- Year over year ------------------------------ */

export interface YearSeries {
  year: number;
  /** Cumulative plays by day-of-year, index 0 = Jan 1. Ends on the last day
   *  with plays, so a partial (or current) year stops rather than running flat
   *  to December. */
  cumulative: number[];
  total: number;
}

export interface YearOverYearData {
  years: YearSeries[];
  /** Largest year total, for a y domain shared across every line. */
  max: number;
}

/**
 * One cumulative curve per calendar year on a shared day-of-year axis, so years
 * can be read against each other: which was the heavy one, and whether you're
 * ahead of where you were this time last year.
 *
 * `seasonal` aggregates month-of-year across all years and so can't show either.
 *
 * Local time, like the other calendar-shaped views — this is "your clock". The
 * day index is derived from the local Y/M/D via UTC arithmetic so a DST shift
 * can't round a 23-hour day into the wrong slot.
 */
export function yearOverYear(
  scrobbles: readonly CountableScrobble[],
): YearOverYearData {
  const DAY = 86_400_000;
  const byYear = new Map<number, number[]>();
  for (const s of scrobbles) {
    const d = new Date(s.uts * 1000);
    const year = d.getFullYear();
    const dayIdx = Math.round(
      (Date.UTC(year, d.getMonth(), d.getDate()) - Date.UTC(year, 0, 1)) / DAY,
    );
    let daily = byYear.get(year);
    if (!daily) {
      daily = new Array<number>(366).fill(0); // 366: leap years
      byYear.set(year, daily);
    }
    daily[dayIdx] += 1;
  }

  const years: YearSeries[] = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, daily]) => {
      let lastDay = -1;
      for (let i = daily.length - 1; i >= 0; i--) {
        if (daily[i]) {
          lastDay = i;
          break;
        }
      }
      const cumulative: number[] = [];
      let run = 0;
      for (let i = 0; i <= lastDay; i++) {
        run += daily[i]!;
        cumulative.push(run);
      }
      return { year, cumulative, total: run };
    });

  return { years, max: Math.max(1, ...years.map((y) => y.total)) };
}

/* --------------------------- Cohort retention ---------------------------- */

export interface RetentionCohort {
  /** Year the artists in this cohort were first heard. */
  year: number;
  /** Distinct artists discovered that year. */
  artists: number;
  /** Plays per month since discovery, index 0 = the debut month. */
  months: number[];
  /** Each month's share of the cohort's plays, aligned to `months`. */
  shares: number[];
  total: number;
  /** Months until half the cohort's plays had happened — its decay speed. */
  halfLifeMonths: number;
  /**
   * Highest month-age observed for *every* artist in the cohort. Columns past
   * this are unobserved, not empty: a cohort from last year simply hasn't had
   * time to reach month 30 yet, and rendering that as a zero would read as
   * abandonment.
   */
  fullyObservedMonths: number;
}

export interface RetentionData {
  cohorts: RetentionCohort[];
  /** Widest age worth drawing, for a shared x axis. */
  maxAge: number;
}

/**
 * How long your enthusiasms last. Artists are grouped into cohorts by the year
 * you discovered them, then their plays are laid out by *age* — months since
 * that artist's debut — and normalized per cohort, so a 2016 cohort's decay
 * shape can be compared with a 2023 one regardless of size.
 *
 * `tenure` shows how long individual artists stayed; this shows the shape of the
 * fade, and `halfLifeMonths` compresses it to one number per cohort.
 *
 * Pass the **whole** history, not a ranged slice, for both arguments. A date
 * filter would chop the right-hand side off every row and bias every half-life
 * short — the failure is invisible in the output, which is why this reads all
 * history and the view says so.
 *
 * Ages beyond `maxMonths` are dropped, which only touches cohorts older than
 * the cap (10 years by default).
 */
export function retention(
  scrobbles: readonly CountableScrobble[],
  firstPlay: ReadonlyMap<string, number>,
  opts: { maxMonths?: number } = {},
): RetentionData {
  const maxMonths = Math.max(1, opts.maxMonths ?? 120);
  // Absolute month index (year * 12 + month) makes age a subtraction. UTC, to
  // match the monthly bucketing the streamgraph and novelty views use.
  const debutMonth = new Map<string, number>();
  const rows = new Map<
    number,
    {
      artists: Set<string>;
      months: number[];
      total: number;
      latestDebut: number;
    }
  >();
  let lastMonth = -Infinity;

  for (const s of scrobbles) {
    let debut = debutMonth.get(s.artist);
    if (debut == null) {
      const firstMs = firstPlay.get(s.artist) ?? s.uts * 1000;
      const f = new Date(firstMs);
      debut = f.getUTCFullYear() * 12 + f.getUTCMonth();
      debutMonth.set(s.artist, debut);
    }
    const d = new Date(s.uts * 1000);
    const abs = d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (abs > lastMonth) lastMonth = abs;
    const age = abs - debut;
    if (age < 0 || age > maxMonths) continue;

    const year = Math.floor(debut / 12);
    let row = rows.get(year);
    if (!row) {
      row = {
        artists: new Set(),
        months: new Array<number>(maxMonths + 1).fill(0),
        total: 0,
        latestDebut: -Infinity,
      };
      rows.set(year, row);
    }
    row.artists.add(s.artist);
    row.months[age] += 1;
    row.total += 1;
    if (debut > row.latestDebut) row.latestDebut = debut;
  }
  if (!rows.size) return { cohorts: [], maxAge: 0 };

  let maxAge = 0;
  const cohorts: RetentionCohort[] = [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, row]) => {
      // Half-life: the age by which half the cohort's plays had happened.
      let running = 0;
      let halfLifeMonths = 0;
      for (let i = 0; i < row.months.length; i++) {
        running += row.months[i]!;
        if (running >= row.total / 2) {
          halfLifeMonths = i;
          break;
        }
      }
      let lastNonZero = 0;
      for (let i = row.months.length - 1; i >= 0; i--) {
        if (row.months[i]) {
          lastNonZero = i;
          break;
        }
      }
      const fullyObservedMonths = Math.max(
        0,
        Math.min(maxMonths, lastMonth - row.latestDebut),
      );
      maxAge = Math.max(maxAge, lastNonZero, fullyObservedMonths);
      return {
        year,
        artists: row.artists.size,
        months: row.months,
        shares: row.months.map((v) => (row.total ? v / row.total : 0)),
        total: row.total,
        halfLifeMonths,
        fullyObservedMonths,
      };
    });

  return { cohorts, maxAge };
}

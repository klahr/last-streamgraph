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

/**
 * Meteorological seasons, northern hemisphere: winter starts in December and
 * so straddles the year boundary. `monthIndices` runs in season order.
 */
export const SEASONS: { name: string; months: string; monthIndices: number[] }[] = [
  { name: 'Winter', months: 'Dec–Feb', monthIndices: [11, 0, 1] },
  { name: 'Spring', months: 'Mar–May', monthIndices: [2, 3, 4] },
  { name: 'Summer', months: 'Jun–Aug', monthIndices: [5, 6, 7] },
  { name: 'Autumn', months: 'Sep–Nov', monthIndices: [8, 9, 10] },
];

/** Season index per month-of-year, index 0 = January. Derived, not restated. */
export const SEASON_OF_MONTH = SEASONS.reduce((acc, season, i) => {
  for (const m of season.monthIndices) acc[m] = i;
  return acc;
}, new Array<number>(12).fill(0));

/** A year needs this many plays of a key before it gets a vote on the peak. */
const YEAR_VOTE_FLOOR = 3;
/** A year's own peak counts as agreeing within ±2 months of the overall peak. */
const AGREE_MONTHS = 2;
/**
 * Calling something seasonal means claiming its peak months are meaningfully
 * busier than usual. A quarter more than usual is the least that deserves the
 * word; below it the profile is your ordinary listening with rounding on top.
 */
const MIN_PEAK_LIFT = 1.25;
/** And at least two separate years have to point the same way. */
const MIN_AGREEING_YEARS = 2;
/**
 * Share of all plays a key needs before it is worth a card. A fixed count
 * cannot do this job: twelve plays is a real habit in a thousand-play library
 * and a rounding error in a fifty-thousand-play one, and the fixed floor is
 * what let a thirty-play artist head a ranking over one played nine hundred
 * times. Concentration does not fall with size — a name you played six times a
 * year, always in December, is *genuinely* more concentrated than a favourite
 * — so no amount of statistical correction demotes it. It simply isn't
 * something the listener wants a card about, which is a question of relevance,
 * not of evidence, and belongs in a floor rather than in the score.
 */
const MIN_SHARE = 0.005;
/**
 * ...but the floor must never empty the view: it is capped at whatever the
 * MIN_CANDIDATES-th biggest key has, so a library too diffuse for anything to
 * reach {@link MIN_SHARE} still gets a ranking. Kept small deliberately — set
 * generously it stops being a safety net and starts readmitting the tail it
 * exists to exclude.
 */
const MIN_CANDIDATES = 8;

/** One artist/genre/album that recurs at the same time of year. */
export interface SeasonalKey {
  /** Name, per the caller's key function — an artist, genre or album. */
  key: string;
  /** Its total plays in range. */
  plays: number;
  /** Raw plays per calendar month, index 0 = January. */
  byMonth: number[];
  /**
   * Per month: this key's share of its own plays, divided by that month's
   * share of *all* plays. 1 means exactly as prominent that month as usual;
   * 2 means twice. Dividing by the overall month profile is what cancels
   * unequal month lengths and an account that started mid-year — both are
   * already baked into the denominator.
   */
  lift: number[];
  /** Rounded circular mean of the lift profile, 0 = January. */
  peakMonth: number;
  /** Mean lift across the three months centred on {@link peakMonth}. */
  peakLift: number;
  /** Circular concentration of the lift profile: 0 = flat, 1 = a single month. */
  strength: number;
  /**
   * How much concentration this many plays produces by luck alone. Twelve plays
   * land lopsidedly across twelve months most of the time; eight hundred do
   * not. Ranking subtracts this from {@link strength}, so a thin key has to be
   * far more concentrated than a thick one to place above it.
   */
  chanceDrift: number;
  /** Calendar years holding at least {@link YEAR_VOTE_FLOOR} plays of this key. */
  activeYears: number;
  /** How many of those years peak within {@link AGREE_MONTHS} of `peakMonth`. */
  agreeingYears: number;
  /** `strength × (agreeingYears / activeYears)` — the ranking key. */
  score: number;
}

export interface SeasonalData {
  /** Plays per calendar month, index 0 = January. */
  months: number[];
  /**
   * Days of the range that fell in each calendar month — the exposure behind
   * `months`. `months[m] / coverage[m]` is a plays-per-day rate that unequal
   * month lengths and a partial first year can't distort.
   */
  coverage: number[];
  /** Keys that recur at the same time of year, best {@link SeasonalKey.score} first. */
  keys: SeasonalKey[];
  /** Keys that cleared the play floor but appear in only one calendar year. */
  oneYearOnly: number;
  /** Keys with the plays and the years, but no peak worth the word "seasonal". */
  notSeasonal: number;
  /** Plays a key needed to be considered at all — see {@link MIN_SHARE}. */
  playFloor: number;
  total: number;
}

/** Days of the range falling in each calendar month. Local time, DST-safe. */
function monthCoverage(firstMs: number, lastMs: number): number[] {
  const days = new Array<number>(12).fill(0);
  if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs) || lastMs < firstMs) {
    return days;
  }
  const d = new Date(firstMs);
  d.setHours(0, 0, 0, 0);
  const end = new Date(lastMs);
  end.setHours(0, 0, 0, 0);
  // Stepping by calendar date rather than by 86.4e6 ms keeps the count right
  // across DST transitions, where a "day" is 23 or 25 hours long.
  while (d.getTime() <= end.getTime()) {
    days[d.getMonth()] += 1;
    d.setDate(d.getDate() + 1);
  }
  return days;
}

const TAU = 2 * Math.PI;
/** Month index → angle on the year circle. */
const angleOf = (m: number) => (TAU * m) / 12;

/**
 * Circular mean of a 12-slot weight profile, as a fractional month in [0, 12),
 * together with the resultant length (0 = perfectly flat, 1 = all one month).
 *
 * Months are a cycle, so December and January are neighbours. A plain mean or
 * variance over month *indices* would put the centre of a Dec/Jan habit in
 * June; summing unit vectors and taking the argument gets it right.
 */
function circularPeak(weights: readonly number[]): { month: number; strength: number } {
  let vx = 0;
  let vy = 0;
  let sum = 0;
  for (let m = 0; m < 12; m++) {
    const w = weights[m] ?? 0;
    if (w <= 0) continue;
    vx += w * Math.cos(angleOf(m));
    vy += w * Math.sin(angleOf(m));
    sum += w;
  }
  if (sum === 0) return { month: 0, strength: 0 };
  const r = Math.hypot(vx, vy);
  const month = (((Math.atan2(vy, vx) / TAU) * 12) + 12) % 12;
  return { month, strength: r / sum };
}

/**
 * Roughly how concentrated a profile built from `n` plays looks when there is
 * no seasonality at all.
 *
 * Concentration is biased upward by small samples: scatter twelve plays across
 * twelve months and they will not come out one per month, they will clump, and
 * the clump has a direction. For n draws from a uniform circle the resultant
 * length averages about sqrt(pi/4n) — 0.26 at twelve plays, 0.03 at eight
 * hundred — which is why an artist with a dozen plays could otherwise top this
 * ranking over one with a genuine decade-long winter habit.
 *
 * This is the uniform-circle result applied to a profile that has been
 * reweighted by lift, so it is an approximation used to order a list, not a
 * significance test, and nothing here reports a p-value.
 */
const chanceConcentration = (n: number) =>
  n > 0 ? Math.min(0.95, Math.sqrt(Math.PI / (4 * n))) : 0.95;

/** Distance between two fractional months around the 12-month circle, 0..6. */
function monthDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 12;
  return Math.min(d, 12 - d);
}

/**
 * Which of your music belongs to a time of year.
 *
 * Two things make this more than a month histogram:
 *
 * 1. **Every count is read against your own listening**, not against the
 *    calendar. A key's month profile is divided by *your* month profile, so a
 *    month that is longer, or that your account has simply lived through one
 *    more time, contributes to both sides and cancels. Raw month totals can
 *    show a 1.3× "summer bump" for someone whose listening is perfectly flat —
 *    that bump is the calendar, and this metric removes it.
 *
 * 2. **Evidence is weighed.** Concentration is biased upward by small samples,
 *    so the ranking subtracts the concentration that this many plays would
 *    show by luck alone — see {@link chanceConcentration}. Without it a
 *    twelve-play artist that happened to land in one January outranks a decade
 *    of December habit.
 *
 * 3. **A habit has to repeat.** An artist discovered one June and dropped by
 *    August looks intensely seasonal to any all-time metric, but it is a phase,
 *    not a season. So each calendar year with enough plays votes on its own
 *    peak, and a key is ranked by how concentrated its profile is *times* the
 *    fraction of its years that agree on when. One-year keys are excluded and
 *    counted in `oneYearOnly` rather than silently dropped.
 *
 * `minPlays` is the *absolute* lower bound on that floor; the floor actually
 * used is {@link MIN_SHARE} of your listening, since lift is violently unstable
 * on small counts (three plays that all land in one January score an enormous
 * lift on no evidence) and a key too small to matter is noise however clean its
 * shape. What survives both floors still has to clear
 * {@link MIN_PEAK_LIFT} and {@link MIN_AGREEING_YEARS} to be called seasonal —
 * a list padded with 1.1x "peaks" whose years disagree is a list that has
 * stopped meaning anything. Everything turned away is counted, not hidden.
 *
 * Local time, like the other calendar-shaped views.
 */
export function seasonal(
  scrobbles: readonly CountableScrobble[],
  keyOf: (s: CountableScrobble) => string = (s) => s.artist,
  opts: { minPlays?: number; limit?: number } = {},
): SeasonalData {
  const minPlays = Math.max(1, opts.minPlays ?? 12);
  const limit = Math.max(1, opts.limit ?? 24);

  const months = new Array<number>(12).fill(0);
  let firstMs = Infinity;
  let lastMs = -Infinity;

  interface Acc {
    plays: number;
    byMonth: number[];
    byYear: Map<number, number[]>;
  }
  const perKey = new Map<string, Acc>();

  for (const s of scrobbles) {
    const d = new Date(s.uts * 1000);
    const m = d.getMonth();
    months[m] += 1;
    const ms = d.getTime();
    if (ms < firstMs) firstMs = ms;
    if (ms > lastMs) lastMs = ms;

    const k = keyOf(s);
    let acc = perKey.get(k);
    if (!acc) {
      acc = { plays: 0, byMonth: new Array<number>(12).fill(0), byYear: new Map() };
      perKey.set(k, acc);
    }
    acc.plays += 1;
    acc.byMonth[m] += 1;
    const y = d.getFullYear();
    let yearMonths = acc.byYear.get(y);
    if (!yearMonths) {
      yearMonths = new Array<number>(12).fill(0);
      acc.byYear.set(y, yearMonths);
    }
    yearMonths[m] += 1;
  }

  const total = scrobbles.length;
  const coverage = monthCoverage(firstMs, lastMs);
  if (total === 0) {
    return {
      months,
      coverage,
      keys: [],
      oneYearOnly: 0,
      notSeasonal: 0,
      playFloor: minPlays,
      total,
    };
  }

  // Relative to the library, but never so high that it starves the view: the
  // share-based floor is capped at whatever the MIN_CANDIDATES-th biggest key
  // has, so that many always remain eligible no matter how flat the tail.
  const descending = [...perKey.values()].map((a) => a.plays).sort((a, b) => b - a);
  const playFloor = Math.max(
    minPlays,
    Math.min(
      Math.ceil(total * MIN_SHARE),
      descending[MIN_CANDIDATES - 1] ?? 0,
    ),
  );

  /** Each month's share of all plays — the denominator that cancels the calendar. */
  const monthShare = months.map((v) => v / total);

  const keys: SeasonalKey[] = [];
  let oneYearOnly = 0;
  let notSeasonal = 0;

  for (const [key, acc] of perKey) {
    if (acc.plays < playFloor) continue;

    const votingYears = [...acc.byYear.values()].filter(
      (ym) => ym.reduce((a, b) => a + b, 0) >= YEAR_VOTE_FLOOR,
    );
    if (votingYears.length < 2) {
      oneYearOnly += 1;
      continue;
    }

    const lift = acc.byMonth.map((v, m) =>
      monthShare[m]! > 0 ? v / acc.plays / monthShare[m]! : 0,
    );
    const { month: peakFrac, strength } = circularPeak(lift);
    const peakMonth = Math.round(peakFrac) % 12;
    const chanceDrift = chanceConcentration(acc.plays);

    // Each year gets one vote, cast from its own months. A year that peaks
    // somewhere else is what separates a habit from a single hot summer.
    const agreeingYears = votingYears.filter(
      (ym) => monthDistance(circularPeak(ym).month, peakFrac) <= AGREE_MONTHS,
    ).length;

    // Headline number over the three months centred on the peak: one month's
    // lift is jumpy, and a season is what the label claims anyway.
    const window = [peakMonth + 11, peakMonth, peakMonth + 1].map((m) => lift[m % 12]!);
    const peakLift = window.reduce((a, b) => a + b, 0) / 3;

    if (peakLift < MIN_PEAK_LIFT || agreeingYears < MIN_AGREEING_YEARS) {
      notSeasonal += 1;
      continue;
    }

    keys.push({
      key,
      plays: acc.plays,
      byMonth: acc.byMonth,
      lift,
      peakMonth,
      peakLift,
      strength,
      chanceDrift,
      activeYears: votingYears.length,
      agreeingYears,
      score:
        Math.max(0, (strength - chanceDrift) / (1 - chanceDrift)) *
        (agreeingYears / votingYears.length),
    });
  }

  // Ties break toward more plays, then by name, so the order never depends on
  // Map iteration order.
  keys.sort(
    (a, b) =>
      b.score - a.score || b.plays - a.plays || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );

  return {
    months,
    coverage,
    keys: keys.slice(0, limit),
    oneYearOnly,
    notSeasonal,
    playFloor,
    total,
  };
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

/* ------------------------- Breakdown hierarchy --------------------------- */

export interface HierNode {
  name: string;
  value?: number;
  children?: HierNode[];
}

/**
 * Two-ring hierarchy for a sunburst/treemap: the top `topInner` groups by play
 * count, each holding its own top `topOuterPerInner` members.
 *
 * Both levels are caller-keyed, so one shape serves every grouping the view
 * offers — genre → artist, artist → album, album → track. Anything outside a
 * cut is dropped rather than pooled into an "other" wedge: the rings are for
 * reading composition, and a giant grey remainder crowds out what you came to
 * look at.
 */
export function breakdownHierarchy(
  scrobbles: readonly CountableScrobble[],
  innerOf: (s: CountableScrobble) => string,
  outerOf: (s: CountableScrobble) => string,
  opts: { topInner: number; topOuterPerInner: number },
): HierNode {
  const byInner = new Map<string, Map<string, number>>();
  for (const s of scrobbles) {
    const inner = innerOf(s);
    let members = byInner.get(inner);
    if (!members) {
      members = new Map();
      byInner.set(inner, members);
    }
    const outer = outerOf(s);
    members.set(outer, (members.get(outer) ?? 0) + 1);
  }
  const groupTotal = (m: Map<string, number>) =>
    [...m.values()].reduce((a, b) => a + b, 0);
  const inners = [...byInner.entries()]
    .sort((a, b) => groupTotal(b[1]) - groupTotal(a[1]))
    .slice(0, opts.topInner);
  return {
    name: 'All',
    children: inners.map(([name, members]) => ({
      name,
      children: [...members.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, opts.topOuterPerInner)
        .map(([outer, value]) => ({ name: outer, value })),
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
  /**
   * The model evaluated over the months it was fitted on, aligned to
   * `history` (null before the fit window starts). Lets you eyeball how well
   * the projection's own method tracked the past before trusting its future.
   */
  fitted: (number | null)[];
  /** Projected future months with a ±band. */
  projection: { ms: number; value: number; lo: number; hi: number }[];
  slope: number;
  /**
   * Where the series sits on the momentum ramp, from `surging` down to `dead`.
   * The four moving states are slope bins normalised by the series' own
   * monthly average; `dead` is categorical (already at zero), not a bin.
   */
  trend: 'surging' | 'rising' | 'flat' | 'easing' | 'falling' | 'dead';
}

/**
 * Trend damping per month ahead. A pure linear extrapolation runs off to
 * absurdity (or slams into the zero clamp) within a few months; damping bends
 * it toward a plateau, which is both the better-behaved forecast and the
 * reason the projection reads as a curve rather than a ruler.
 */
const DAMPING = 0.85;
/** History needed before month-of-year effects are estimated at all. */
const SEASONAL_MIN_MONTHS = 24;

/**
 * Additive month-of-year effects (index 0 = January), or null when there isn't
 * enough history to estimate them.
 *
 * Textbook classical decomposition: a centred 12-month moving average as the
 * trend-cycle, the detrended remainder averaged per calendar month, shrunk
 * toward zero by how many years actually support each month, then re-centred
 * so the indices sum to zero — they redistribute plays across the year, they
 * never invent or destroy any.
 */
function seasonalIndices(history: readonly { ms: number; value: number }[]): number[] | null {
  const n = history.length;
  if (n < SEASONAL_MIN_MONTHS) return null;

  const trend = history.map((_, i) => {
    if (i < 6 || i > n - 7) return null;
    let sum = 0;
    for (let j = i - 6; j <= i + 6; j++) {
      // Half weight on the two endpoints so a 13-point window spans exactly
      // 12 months and can't favour whichever calendar month sits at the edge.
      sum += (j === i - 6 || j === i + 6 ? 0.5 : 1) * history[j]!.value;
    }
    return sum / 12;
  });

  const buckets: number[][] = Array.from({ length: 12 }, () => []);
  history.forEach((p, i) => {
    const t = trend[i];
    if (t != null) buckets[new Date(p.ms).getUTCMonth()]!.push(p.value - t);
  });

  const shrunk = buckets.map((b) => {
    if (!b.length) return 0;
    const mean = b.reduce((a, v) => a + v, 0) / b.length;
    // Two observed Decembers make a December effect a guess; six make it a
    // pattern. k/(k+1) pulls the thin ones most.
    return mean * (b.length / (b.length + 1));
  });
  const centre = shrunk.reduce((a, v) => a + v, 0) / 12;
  return shrunk.map((v) => v - centre);
}

/**
 * Slope bin edges, as a fraction of the series' own monthly average — so a
 * 200-plays/month genre and a 4-plays/month one are graded on the same scale.
 * Inside ±{@link FLAT_FRAC} nothing is really happening; beyond
 * ±{@link STRONG_FRAC} the series is gaining or shedding a quarter of its
 * typical monthly volume every month.
 */
const FLAT_FRAC = 0.05;
const STRONG_FRAC = 0.25;

/** Months of recent history considered when deciding a series has died out. */
const DEAD_TAIL_MONTHS = 3;
/** Absolute plays/month floor below which a series counts as dead regardless. */
const DEAD_FLOOR = 0.5;

/** Step one calendar month forward from a UTC month-start. */
function nextMonth(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/**
 * TA-style projection: monthly plays per top-`topN` series → SMA + a
 * least-squares trend over a recent window, carried `horizon` months ahead as
 * a *damped* trend plus month-of-year seasonality, inside a band that widens
 * with distance. Naive by design.
 *
 * The damping and the seasonal terms are what give the projection its shape:
 * it eases toward a plateau instead of running off in a straight line, and it
 * inherits the series' own annual rhythm where the history is long enough to
 * show one. Nothing is added for texture — every wiggle is an estimated
 * month-of-year effect, so a flat projection means no seasonality was found,
 * not that the model gave up.
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

    const seasonal = seasonalIndices(history);
    const seasonAt = (ms: number) =>
      seasonal ? seasonal[new Date(ms).getUTCMonth()]! : 0;

    // The model over the months it actually saw, so the same curve can be
    // drawn across the history and judged against what really happened.
    const fitStart = history.length - n;
    const fitted = history.map((p, i) =>
      i < fitStart
        ? null
        : Math.max(0, intercept + slope * (i - fitStart) + seasonAt(p.ms)),
    );

    // Anchor on the fitted value at the last observed month rather than the
    // raw count — one freak month shouldn't launch the whole projection.
    const lastFit = intercept + slope * (n - 1);
    const projection: ForecastSeries['projection'] = [];
    let ms = maxMs;
    let phiPow = 1;
    let carried = 0;
    for (let h = 1; h <= horizon; h++) {
      ms = nextMonth(ms);
      // Damped trend: each further month contributes phi^h of the slope, so
      // the curve bends toward a plateau at lastFit + slope*phi/(1-phi).
      phiPow *= DAMPING;
      carried += phiPow;
      const value = Math.max(0, lastFit + slope * carried + seasonAt(ms));
      // Uncertainty compounds with distance — a constant band claimed month
      // six was as knowable as month one.
      const band = 1.96 * resStd * Math.sqrt(h);
      projection.push({
        ms,
        value,
        lo: Math.max(0, value - band),
        hi: value + band,
      });
    }

    const monthlyAvg = (totals.get(key) ?? 0) / Math.max(1, history.length);
    const flatThreshold = FLAT_FRAC * monthlyAvg;
    const strongThreshold = STRONG_FRAC * monthlyAvg;

    // "Dead": the series has already faded out and isn't projected to come
    // back. Both ends must be near zero — recent months *and* the end of the
    // projection — so a steep but still-active decline stays 'falling'. The
    // threshold is relative to the series' own monthly average (a 200-plays/mo
    // genre at 3/mo is dead; a 4-plays/mo one isn't) with an absolute floor so
    // tiny series can't be "5% of almost nothing" forever.
    const deadThreshold = Math.max(DEAD_FLOOR, FLAT_FRAC * monthlyAvg);
    const tailStart = Math.max(0, history.length - DEAD_TAIL_MONTHS);
    const tail = history.slice(tailStart);
    const tailMean = tail.reduce((a, p) => a + p.value, 0) / Math.max(1, tail.length);
    const projEnd = projection[projection.length - 1]?.value ?? tailMean;
    const dead = tailMean <= deadThreshold && projEnd <= deadThreshold;

    const trend = dead
      ? 'dead'
      : slope > strongThreshold
        ? 'surging'
        : slope > flatThreshold
          ? 'rising'
          : slope < -strongThreshold
            ? 'falling'
            : slope < -flatThreshold
              ? 'easing'
              : 'flat';

    return { key, total: totals.get(key) ?? 0, history, sma, fitted, projection, slope, trend };
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

/**
 * A half-life is only believable once you've watched a cohort for a good
 * multiple of it: at 2x, the unobserved tail would have to outweigh everything
 * seen so far to move the figure. Below that, and below a floor of
 * {@link HALF_LIFE_MIN_OBSERVED} months where even a fast fade hasn't had room
 * to show, the number is censored by the observation window rather than
 * measured.
 */
const HALF_LIFE_CONFIDENCE = 2;
const HALF_LIFE_MIN_OBSERVED = 6;

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
   * True when the cohort is too young for {@link halfLifeMonths} to mean what
   * it looks like. A half-life can never exceed the window you've watched, so
   * a cohort observed for eight months cannot report one above eight however
   * loyal it turns out to be — read a censored figure as a floor, not an
   * estimate, and don't compare it against a mature cohort's.
   */
  halfLifeCensored: boolean;
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
 * fade, and `halfLifeMonths` compresses it to one number per cohort — though
 * only where `halfLifeCensored` is false. The newest cohorts are always
 * censored, and reading their half-lives as real would show a fake trend of
 * ever-flightier taste, since a young cohort's plays have nowhere to sit but
 * early.
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
        halfLifeCensored:
          fullyObservedMonths <
          Math.max(HALF_LIFE_MIN_OBSERVED, HALF_LIFE_CONFIDENCE * halfLifeMonths),
        fullyObservedMonths,
      };
    });

  return { cohorts, maxAge };
}

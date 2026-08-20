// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  punchcard,
  seasonal,
  discovery,
  dailyCounts,
  rankOverTime,
  forecast,
  breakdownHierarchy,
  networkGraph,
  obsessions,
  novelty,
  firstPlayMap,
  tenure,
  genreHours,
  albumDepth,
  sessions,
  yearOverYear,
  retention,
} from './analytics';
import type { Scrobble } from '../types';

let id = 0;
function mk(artist: string, d: Date): Scrobble {
  return {
    id: `x${id++}`,
    user: 'u',
    artist,
    album: 'a',
    track: 't',
    uts: Math.floor(d.getTime() / 1000),
  };
}

describe('punchcard', () => {
  it('counts into [weekday][hour] using local time', () => {
    // 2025-01-06 is a Monday; build with LOCAL components so the read matches.
    const s = [
      mk('A', new Date(2025, 0, 6, 14)), // Mon 14:00
      mk('A', new Date(2025, 0, 6, 14)),
      mk('A', new Date(2025, 0, 7, 9)), // Tue 09:00
    ];
    const { counts, max, total } = punchcard(s);
    expect(counts[1]![14]).toBe(2); // Monday 14h
    expect(counts[2]![9]).toBe(1); // Tuesday 9h
    expect(max).toBe(2);
    expect(total).toBe(3);
  });
});

describe('seasonal', () => {
  /** n plays of `artist` in month `m` (0-based) of 2024. */
  const many = (artist: string, m: number, n: number) =>
    Array.from({ length: n }, (_, i) => mk(artist, new Date(2024, m, 1 + (i % 20))));

  it('sums plays per month-of-year', () => {
    const s = [
      mk('A', new Date(2023, 0, 10)),
      mk('A', new Date(2025, 0, 2)),
      mk('B', new Date(2024, 6, 1)),
    ];
    const { months, total } = seasonal(s);
    expect(months[0]).toBe(2); // January across years
    expect(months[6]).toBe(1); // July
    expect(total).toBe(3);
  });

  it('folds months into seasons, with winter spanning the year boundary', () => {
    const s = [
      mk('A', new Date(2024, 11, 5)), // December -> winter
      mk('A', new Date(2024, 0, 5)), // January -> winter
      mk('A', new Date(2024, 3, 5)), // April -> spring
      mk('A', new Date(2024, 7, 5)), // August -> summer
      mk('A', new Date(2024, 9, 5)), // October -> autumn
    ];
    const { seasons } = seasonal(s);
    expect(seasons.map((x) => x.plays)).toEqual([2, 1, 1, 1]);
  });

  it('names the over-represented key, not the most-played one', () => {
    // "Big" is played twice as much overall, but "Cozy" only ever turns up in
    // winter — that's the one that says something seasonal.
    const s = [
      ...many('Big', 0, 10), // January
      ...many('Big', 6, 10), // July
      ...many('Cozy', 0, 6), // January only
    ];
    const { seasons, monthSignatures } = seasonal(s, (x) => x.artist, { minPlays: 5 });

    const winter = seasons[0]!.signature!;
    expect(winter.key).toBe('Cozy');
    expect(winter.distinctive).toBe(true);
    expect(winter.plays).toBe(6);
    expect(winter.share).toBeCloseTo(6 / 16);
    // 37.5% of winter against 23% of everything.
    expect(winter.lift).toBeCloseTo((6 / 16) / (6 / 26));

    // Summer is all Big, so Big is both the top and the signature there.
    expect(seasons[2]!.signature!.key).toBe('Big');
    expect(monthSignatures[0]!.key).toBe('Cozy');
    expect(monthSignatures[6]!.key).toBe('Big');
  });

  it('keys signatures off the caller\'s key function', () => {
    const genre = (x: { artist: string }) => (x.artist === 'Cozy' ? 'folk' : 'techno');
    const s = [...many('Big', 0, 10), ...many('Cozy', 0, 6), ...many('Big', 6, 10)];
    expect(seasonal(s, genre, { minPlays: 5 }).seasons[0]!.signature!.key).toBe('folk');
  });

  it('falls back to the top key, marked undistinctive, below the noise floor', () => {
    // Two plays can't establish a seasonal habit; label the wedge honestly
    // rather than crowning a 13x lift.
    const s = [mk('A', new Date(2024, 0, 3)), mk('A', new Date(2024, 0, 4))];
    const sig = seasonal(s, (x) => x.artist, { minPlays: 5 }).seasons[0]!.signature!;
    expect(sig.key).toBe('A');
    expect(sig.distinctive).toBe(false);
  });

  it('leaves empty seasons unsigned', () => {
    const { seasons } = seasonal([mk('A', new Date(2024, 6, 1))]);
    expect(seasons[2]!.plays).toBe(1);
    expect(seasons[0]!.signature).toBeNull();
    expect(seasons[1]!.signature).toBeNull();
  });
});

describe('discovery', () => {
  it('reports discovery time and total count per artist, ordered by discovery', () => {
    // minPlays:1 preserves the legacy "first scrobble" semantics so this test
    // still asserts ordering/count; the default (5) is covered below.
    const s = [
      mk('A', new Date(2020, 0, 1)),
      mk('B', new Date(2019, 0, 1)),
      mk('A', new Date(2021, 0, 1)),
    ];
    const d = discovery(s, { minPlays: 1 });
    expect(d.map((x) => x.artist)).toEqual(['B', 'A']); // B discovered earlier
    const a = d.find((x) => x.artist === 'A')!;
    expect(a.count).toBe(2);
    expect(a.firstMs).toBe(new Date(2020, 0, 1).getTime());
  });

  it('dates discovery to the threshold-crossing play, not the first play', () => {
    // A is played once in 2008 (a back-catalog import) then for real from 2020.
    // Under the old first-scrobble rule A would be “discovered” in 2008 — the
    // false-positive wall. With minPlays:2 the discovery date is the 2nd play.
    const s = [
      mk('A', new Date(2008, 0, 1)), // imported lone play
      mk('A', new Date(2020, 5, 1)),
      mk('A', new Date(2020, 6, 1)),
    ];
    const d = discovery(s, { minPlays: 2 });
    const a = d.find((x) => x.artist === 'A')!;
    expect(a.count).toBe(3);
    expect(a.firstMs).toBe(new Date(2020, 5, 1).getTime());
  });

  it('drops artists that never cross the threshold (drive-by / import-only)', () => {
    // B has a single backfilled play and nothing else — not a real discovery.
    const s = [
      mk('A', new Date(2020, 0, 1)),
      mk('A', new Date(2020, 1, 1)),
      mk('B', new Date(2008, 0, 1)),
    ];
    const d = discovery(s, { minPlays: 2 });
    expect(d.map((x) => x.artist)).toEqual(['A']);
  });
});

describe('dailyCounts', () => {
  it('aggregates per local day', () => {
    const s = [
      mk('A', new Date(2025, 5, 14, 10)),
      mk('A', new Date(2025, 5, 14, 23)),
      mk('A', new Date(2025, 5, 15, 1)),
    ];
    const { byDay, max } = dailyCounts(s);
    expect(byDay.get('2025-06-14')).toBe(2);
    expect(byDay.get('2025-06-15')).toBe(1);
    expect(max).toBe(2);
  });
});

describe('rankOverTime', () => {
  it('ranks top keys within each bucket (1 = most played)', () => {
    const s = [
      // Jan: A=2, B=1  → A rank 1, B rank 2
      mk('A', new Date(Date.UTC(2025, 0, 5))),
      mk('A', new Date(Date.UTC(2025, 0, 6))),
      mk('B', new Date(Date.UTC(2025, 0, 7))),
      // Feb: B=2, A=1  → B rank 1, A rank 2
      mk('B', new Date(Date.UTC(2025, 1, 5))),
      mk('B', new Date(Date.UTC(2025, 1, 6))),
      mk('A', new Date(Date.UTC(2025, 1, 7))),
    ];
    const { buckets, series } = rankOverTime(s, 'monthly', 10, (x) => x.artist);
    expect(buckets).toHaveLength(2);
    const a = series.find((x) => x.key === 'A')!;
    const b = series.find((x) => x.key === 'B')!;
    expect(a.ranks).toEqual([1, 2]);
    expect(b.ranks).toEqual([2, 1]);
  });
});

describe('forecast', () => {
  /** Trend label for a series with these monthly play counts. */
  const trendOf = (counts: number[]) => {
    const s: Scrobble[] = [];
    counts.forEach((c, m) => {
      for (let k = 0; k < c; k++) s.push(mk('A', new Date(Date.UTC(2025, m, 5))));
    });
    return forecast(s, (x) => x.artist, {
      topN: 1, horizon: 3, smaWindow: 3, regWindow: 12,
    })[0]!.trend;
  };

  it('projects horizon months and flags a growing trend', () => {
    // Monotonically increasing monthly plays for A over 6 months.
    const s: Scrobble[] = [];
    for (let m = 0; m < 6; m++) {
      for (let k = 0; k <= m; k++) s.push(mk('A', new Date(Date.UTC(2025, m, 5))));
    }
    const [series] = forecast(s, (x) => x.artist, {
      topN: 1,
      horizon: 3,
      smaWindow: 3,
      regWindow: 12,
    });
    expect(series!.key).toBe('A');
    expect(series!.history).toHaveLength(6);
    expect(series!.projection).toHaveLength(3);
    // +1/month against a 3.5/month average clears the strong bin's 25% edge.
    expect(series!.trend).toBe('surging');
    expect(series!.slope).toBeGreaterThan(0);
  });

  it('forecasts exactly the provided keys, ignoring topN', () => {
    // A is the top artist by plays, B is second. With keys: ['B'] only B is
    // forecast — the regex-filter path supplies an explicit key set.
    const s: Scrobble[] = [];
    for (let m = 0; m < 6; m++) s.push(mk('A', new Date(Date.UTC(2025, m, 5))));
    for (let m = 0; m < 3; m++) s.push(mk('B', new Date(Date.UTC(2025, m, 5))));
    const out = forecast(s, (x) => x.artist, {
      topN: 10,
      horizon: 2,
      smaWindow: 3,
      regWindow: 12,
      keys: ['B'],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.key).toBe('B');
  });

  it('flags a faded-out series as dead', () => {
    // A is played heavily for 6 months, then stops entirely for 6. The recent
    // tail and the projection are both ~0, so it's dead rather than falling.
    const s: Scrobble[] = [];
    for (let m = 0; m < 6; m++) {
      for (let k = 0; k < 20; k++) s.push(mk('A', new Date(Date.UTC(2025, m, 5))));
    }
    // Keep the month range going to month 11 with a different artist.
    for (let m = 6; m < 12; m++) s.push(mk('B', new Date(Date.UTC(2025, m, 5))));
    const [series] = forecast(s, (x) => x.artist, {
      topN: 1,
      horizon: 3,
      smaWindow: 3,
      regWindow: 12,
    });
    expect(series!.key).toBe('A');
    expect(series!.trend).toBe('dead');
  });

  it('keeps a steep but still-active decline as falling, not dead', () => {
    // A sheds roughly a third of its average every month but is still being
    // played at the end of the range, so it's falling — not yet dead.
    expect(trendOf([40, 32, 24, 16, 8, 4])).toBe('falling');
  });

  it('grades momentum into the full ramp', () => {
    // Bin edges are ±5% (flat) and ±25% (strong) of the series' own monthly
    // average, so each gradient below lands one step further along.
    expect(trendOf([4, 12, 20, 28, 36, 44])).toBe('surging');
    expect(trendOf([17, 19, 21, 23, 25, 27])).toBe('rising');
    expect(trendOf([20, 20, 20, 20, 20, 20])).toBe('flat');
    expect(trendOf([27, 25, 23, 21, 19, 17])).toBe('easing');
    expect(trendOf([44, 36, 28, 20, 12, 4])).toBe('falling');
  });

  it('grades on the series own scale, not raw play volume', () => {
    // +2/month on a 22-play average and +20/month on a 220-play average are
    // the same story; volume alone must not promote one up the ramp.
    expect(trendOf([170, 190, 210, 230, 250, 270])).toBe(
      trendOf([17, 19, 21, 23, 25, 27]),
    );
  });

  it('bends the projection instead of extrapolating a straight line', () => {
    // Steady growth of +1 play/month. A linear extrapolation would keep adding
    // exactly 1/month forever; the damped trend adds less each month out.
    const s: Scrobble[] = [];
    for (let m = 0; m < 12; m++) {
      for (let k = 0; k <= m; k++) s.push(mk('A', new Date(Date.UTC(2025, m, 5))));
    }
    const [series] = forecast(s, (x) => x.artist, {
      topN: 1, horizon: 4, smaWindow: 3, regWindow: 12,
    });
    const p = series!.projection.map((q) => q.value);
    const steps = p.slice(1).map((v, i) => v - p[i]!);
    // Each step forward is smaller than the one before it — a curve, not a ray.
    steps.slice(1).forEach((step, i) => {
      expect(step).toBeLessThan(steps[i]!);
    });
  });

  it('widens the uncertainty band with distance', () => {
    // Noisy history so the residual stddev (and thus the band) is non-zero.
    const s: Scrobble[] = [];
    const counts = [5, 20, 6, 22, 4, 19, 7, 21, 5, 18, 8, 20];
    counts.forEach((c, m) => {
      for (let k = 0; k < c; k++) s.push(mk('A', new Date(Date.UTC(2025, m, 5))));
    });
    const [series] = forecast(s, (x) => x.artist, {
      topN: 1, horizon: 5, smaWindow: 3, regWindow: 12,
    });
    const widths = series!.projection.map((q) => q.hi - q.lo);
    expect(widths[widths.length - 1]!).toBeGreaterThan(widths[0]!);
  });

  it('carries month-of-year seasonality into the projection', () => {
    // Three years of a hard December spike and nothing else. The projection
    // must reproduce the spike when it reaches a December, not average it away.
    const s: Scrobble[] = [];
    for (let year = 2022; year <= 2024; year++) {
      for (let m = 0; m < 12; m++) {
        const c = m === 11 ? 40 : 5;
        for (let k = 0; k < c; k++) s.push(mk('A', new Date(Date.UTC(year, m, 5))));
      }
    }
    // History ends Dec 2024, so a 12-month horizon lands on Dec 2025.
    const [series] = forecast(s, (x) => x.artist, {
      topN: 1, horizon: 12, smaWindow: 6, regWindow: 36,
    });
    const dec = series!.projection.find((q) => new Date(q.ms).getUTCMonth() === 11);
    const others = series!.projection.filter((q) => new Date(q.ms).getUTCMonth() !== 11);
    const otherMax = Math.max(...others.map((q) => q.value));
    expect(dec!.value).toBeGreaterThan(otherMax);
  });

  it('leaves the projection unseasonal when history is under two years', () => {
    // 18 months can't support month-of-year effects — fitted must stay defined
    // and the December spike must not be extrapolated from a single sighting.
    const s: Scrobble[] = [];
    for (let m = 0; m < 18; m++) {
      const c = m === 11 ? 40 : 5;
      for (let k = 0; k < c; k++) s.push(mk('A', new Date(Date.UTC(2024, m, 5))));
    }
    const [series] = forecast(s, (x) => x.artist, {
      topN: 1, horizon: 12, smaWindow: 6, regWindow: 24,
    });
    const vals = series!.projection.map((q) => q.value);
    const spread = Math.max(...vals) - Math.min(...vals);
    expect(spread).toBeLessThan(1);
  });

  it('exposes a fitted curve aligned to history', () => {
    const s: Scrobble[] = [];
    for (let m = 0; m < 12; m++) {
      for (let k = 0; k <= m; k++) s.push(mk('A', new Date(Date.UTC(2025, m, 5))));
    }
    const [series] = forecast(s, (x) => x.artist, {
      topN: 1, horizon: 3, smaWindow: 3, regWindow: 6,
    });
    expect(series!.fitted).toHaveLength(series!.history.length);
    // regWindow=6 over 12 months → the first six are outside the fit.
    expect(series!.fitted.slice(0, 6).every((v) => v == null)).toBe(true);
    expect(series!.fitted.slice(6).every((v) => v != null)).toBe(true);
  });

  it('widens the smoothing window for a longer selected range', () => {
    // The trend/SMA windows scale with the selected span: a short range uses a
    // tight reactive window, a long range a wider baseline. Observable via the
    // SMA's leading-null prefix (length = smaWindow - 1) — a 36-month span
    // should require more lead-in points than a 6-month span.
    const build = (months: number): Scrobble[] => {
      const out: Scrobble[] = [];
      for (let m = 0; m < months; m++) out.push(mk('A', new Date(Date.UTC(2025, m, 5))));
      return out;
    };
    const shortRun = forecast(build(6), (x) => x.artist, {
      topN: 1, horizon: 1, smaWindow: 6, regWindow: 24,
    });
    const longRun = forecast(build(36), (x) => x.artist, {
      topN: 1, horizon: 1, smaWindow: 6, regWindow: 24,
    });
    const shortNulls = shortRun[0]!.sma.filter((v) => v == null).length;
    const longNulls = longRun[0]!.sma.filter((v) => v == null).length;
    // spanMonths=6  → smaWindow = min(6, max(2, round(6/6)=1)) = 2 → 1 leading null
    // spanMonths=36 → smaWindow = min(6, max(2, round(36/6)=6)) = 6 → 5 leading nulls
    expect(longNulls).toBeGreaterThan(shortNulls);
  });
});

describe('breakdownHierarchy', () => {
  const build = (rows: [string, string][]) =>
    rows.map(([inner, outer]) => ({ ...mk(inner, new Date(Date.UTC(2025, 0, 5))), album: outer }));

  it('nests outer members under their inner group, both ranked by plays', () => {
    const s = build([
      ['A', 'One'], ['A', 'One'], ['A', 'One'],
      ['A', 'Two'],
      ['B', 'Three'], ['B', 'Three'],
    ]);
    const root = breakdownHierarchy(s, (x) => x.artist, (x) => x.album!, {
      topInner: 10,
      topOuterPerInner: 10,
    });
    // A has 4 plays to B's 2, so A leads; within A, One (3) leads Two (1).
    expect(root.children!.map((c) => c.name)).toEqual(['A', 'B']);
    expect(root.children![0]!.children!.map((c) => c.name)).toEqual(['One', 'Two']);
    expect(root.children![0]!.children![0]!.value).toBe(3);
  });

  it('cuts both rings to their top-N without pooling the remainder', () => {
    const s = build([
      ['A', 'One'], ['A', 'One'], ['A', 'Two'],
      ['B', 'Three'],
      ['C', 'Four'],
    ]);
    const root = breakdownHierarchy(s, (x) => x.artist, (x) => x.album!, {
      topInner: 2,
      topOuterPerInner: 1,
    });
    expect(root.children!.map((c) => c.name)).toEqual(['A', 'B']);
    // Only A's leading album survives the outer cut, and nothing is pooled.
    expect(root.children![0]!.children).toHaveLength(1);
    expect(root.children![0]!.children![0]!.name).toBe('One');
  });

  it('serves any pair of keys, not just genre to artist', () => {
    // Same rows keyed the other way round — albums outward to artists.
    const s = build([['A', 'One'], ['B', 'One'], ['B', 'One']]);
    const root = breakdownHierarchy(s, (x) => x.album!, (x) => x.artist, {
      topInner: 10,
      topOuterPerInner: 10,
    });
    expect(root.children!.map((c) => c.name)).toEqual(['One']);
    expect(root.children![0]!.children!.map((c) => c.name)).toEqual(['B', 'A']);
  });
});

describe('networkGraph', () => {
  it('preserves multi-word artist names in co-play edges', () => {
    // Two artists with spaces in their names, played together enough days to
    // clear MIN_SHARED_DAYS. A naive `'a b'.split(' ')` would corrupt the
    // edge endpoints into the first word of each name.
    const day = (m: number) => new Date(2025, m, 1);
    const s: Scrobble[] = [];
    for (let m = 0; m < 5; m++) {
      s.push(mk('Fleetwood Mac', day(m)));
      s.push(mk('Taylor Swift', day(m)));
    }
    const { nodes, links } = networkGraph(s, {}, {
      topN: 10,
      maxNodes: 60,
      minSharedDays: 3,
      maxEdges: 400,
    });
    expect(nodes.map((n) => n.artist).sort()).toEqual(['Fleetwood Mac', 'Taylor Swift']);
    expect(links).toHaveLength(1);
    expect(links[0]!.source).toBe('Fleetwood Mac');
    expect(links[0]!.target).toBe('Taylor Swift');
  });
});

/** Scrobble with explicit album/track, for the track-level aggregations. */
function mkFull(
  artist: string,
  track: string,
  album: string,
  d: Date,
): Scrobble {
  return {
    id: `y${id++}`,
    user: 'u',
    artist,
    album,
    track,
    uts: Math.floor(d.getTime() / 1000),
  };
}

describe('obsessions', () => {
  it('ranks a tight burst above a better-played but evenly spread track', () => {
    const s = [
      // 4 plays inside one afternoon.
      ...[10, 11, 12, 13].map((h) =>
        mkFull('A', 'Burst', 'Album', new Date(Date.UTC(2025, 2, 4, h))),
      ),
      // 6 plays, one a month — more total, no burst.
      ...[0, 1, 2, 3, 4, 5].map((m) =>
        mkFull('A', 'Steady', 'Album', new Date(Date.UTC(2025, m, 15, 12))),
      ),
    ];
    const { tracks } = obsessions(s, { minPlays: 3 });
    expect(tracks.map((t) => t.track)).toEqual(['Burst', 'Steady']);
    const burst = tracks[0]!;
    expect(burst.total).toBe(4);
    expect(burst.peak).toBe(4); // all four inside the 7-day window
    expect(burst.concentration).toBe(1);
    const steady = tracks[1]!;
    expect(steady.total).toBe(6);
    expect(steady.peak).toBe(1);
  });

  it('drops tracks below the play floor and keeps series aligned to the shared grid', () => {
    const s = [
      ...[0, 1, 2].map((h) =>
        mkFull('A', 'Kept', 'Album', new Date(Date.UTC(2025, 0, 6, 10 + h))),
      ),
      mkFull('A', 'Dropped', 'Album', new Date(Date.UTC(2025, 0, 20, 10))),
    ];
    const { weeks, tracks } = obsessions(s, { minPlays: 3 });
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.track).toBe('Kept');
    // 2025-01-06 and 2025-01-20 are Mondays three ISO weeks apart, and the grid
    // spans the whole slice, not just the surviving track.
    expect(weeks).toHaveLength(3);
    expect(tracks[0]!.series).toHaveLength(3);
    expect(tracks[0]!.series[0]).toBe(3);
    expect(tracks[0]!.series[2]).toBe(0);
  });

  it('ignores scrobbles with no track title', () => {
    const s = [0, 1, 2].map((h) =>
      mkFull('A', '', 'Album', new Date(Date.UTC(2025, 0, 6, 10 + h))),
    );
    expect(obsessions(s, { minPlays: 2 }).tracks).toHaveLength(0);
  });
});

describe('novelty', () => {
  it('splits plays into debuting artists and ones already heard', () => {
    const all = [
      mk('Old', new Date(Date.UTC(2024, 0, 15, 12))),
      mk('Old', new Date(Date.UTC(2024, 1, 15, 12))),
      mk('New', new Date(Date.UTC(2024, 1, 20, 12))),
    ];
    const { buckets, totals } = novelty(all, 'monthly', firstPlayMap(all));
    expect(buckets).toHaveLength(2);
    // January: Old debuts.
    expect(buckets[0]!).toMatchObject({ fresh: 1, familiar: 0, debuts: 1 });
    // February: Old is familiar by now, New debuts.
    expect(buckets[1]!).toMatchObject({ fresh: 1, familiar: 1, debuts: 1 });
    expect(totals).toEqual({ fresh: 2, familiar: 1 });
  });

  it('keeps old favourites familiar when the range excludes their debut', () => {
    // The whole point of passing a full-history first-play map: charting only
    // February must not re-brand a January artist as a fresh discovery.
    const all = [
      mk('Old', new Date(Date.UTC(2024, 0, 15, 12))),
      mk('Old', new Date(Date.UTC(2024, 1, 15, 12))),
    ];
    const februaryOnly = all.slice(1);
    const { buckets } = novelty(februaryOnly, 'monthly', firstPlayMap(all));
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!).toMatchObject({ fresh: 0, familiar: 1, debuts: 0 });
    // Whereas a map built from the slice alone gets it wrong — this is the trap.
    const naive = novelty(februaryOnly, 'monthly', firstPlayMap(februaryOnly));
    expect(naive.buckets[0]!.fresh).toBe(1);
  });

  it('emits silent buckets as explicit zeroes', () => {
    const all = [
      mk('A', new Date(Date.UTC(2024, 0, 15, 12))),
      mk('A', new Date(Date.UTC(2024, 3, 15, 12))),
    ];
    const { buckets } = novelty(all, 'monthly', firstPlayMap(all));
    expect(buckets.map((b) => b.label)).toEqual([
      '2024-01',
      '2024-02',
      '2024-03',
      '2024-04',
    ]);
    expect(buckets[1]!.fresh + buckets[1]!.familiar).toBe(0);
  });
});

describe('tenure', () => {
  it('spans first to last play and counts distinct active days', () => {
    const s = [
      mk('A', new Date(2024, 0, 10, 12)),
      mk('A', new Date(2024, 0, 10, 13)), // same local day
      mk('A', new Date(2024, 11, 20, 12)),
      mk('B', new Date(2024, 5, 1, 12)),
    ];
    const rows = tenure(s, { topN: 10 });
    // Ordered by arrival, so A (January) precedes B (June).
    expect(rows.map((r) => r.artist)).toEqual(['A', 'B']);
    const a = rows[0]!;
    expect(a.count).toBe(3);
    expect(a.activeDays).toBe(2);
    expect(a.firstMs).toBe(new Date(2024, 0, 10, 12).getTime());
    expect(a.lastMs).toBe(new Date(2024, 11, 20, 12).getTime());
  });

  it('keeps only the top-N artists by play count', () => {
    const s = [
      mk('Big', new Date(2024, 0, 2, 12)),
      mk('Big', new Date(2024, 0, 3, 12)),
      mk('Small', new Date(2024, 0, 1, 12)),
    ];
    const rows = tenure(s, { topN: 1 });
    expect(rows.map((r) => r.artist)).toEqual(['Big']);
  });
});

describe('genreHours', () => {
  it('averages play hours circularly so late-night listening stays late', () => {
    // 23:00 and 01:00 average to midnight, not to noon.
    const s = [
      mk('nightArtist', new Date(2025, 0, 6, 23)),
      mk('nightArtist', new Date(2025, 0, 7, 1)),
    ];
    const { rows } = genreHours(s, { nightartist: 'night' }, { topGenres: 5 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.meanHour).toBeCloseTo(0, 5);
    expect(rows[0]!.counts[23]).toBe(1);
    expect(rows[0]!.counts[1]).toBe(1);
  });

  it('orders rows by time of day, not by size', () => {
    const s = [
      // A dominant evening genre and a tiny early-morning one.
      ...Array.from({ length: 5 }, (_, i) =>
        mk('eveningArtist', new Date(2025, 0, 6 + i, 21)),
      ),
      mk('morningArtist', new Date(2025, 0, 6, 6)),
    ];
    const { rows, total } = genreHours(
      s,
      { eveningartist: 'evening', morningartist: 'morning' },
      { topGenres: 5 },
    );
    expect(rows.map((r) => r.genre)).toEqual(['morning', 'evening']);
    expect(rows[1]!.peakHour).toBe(21);
    expect(total).toBe(6);
  });

  it('falls back to Unknown for untagged artists', () => {
    const s = [mk('A', new Date(2025, 0, 6, 12))];
    const { rows } = genreHours(s, {}, { topGenres: 5 });
    expect(rows[0]!.genre).toBe('Unknown');
  });
});

describe('albumDepth', () => {
  it('counts distinct tracks case-insensitively', () => {
    const s = [
      mkFull('A', 'Song One', 'Rec', new Date(Date.UTC(2025, 0, 6, 12))),
      mkFull('A', 'song one', 'Rec', new Date(Date.UTC(2025, 0, 7, 12))),
      mkFull('A', 'Song Two', 'Rec', new Date(Date.UTC(2025, 0, 8, 12))),
    ];
    const rows = albumDepth(s, { minPlays: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!).toMatchObject({
      album: 'Rec',
      artist: 'A',
      plays: 3,
      distinctTracks: 2,
    });
    expect(rows[0]!.playsPerTrack).toBeCloseTo(1.5);
  });

  it('skips untitled albums instead of merging them into one bucket', () => {
    const s = [
      mkFull('A', 'T1', '', new Date(Date.UTC(2025, 0, 6, 12))),
      mkFull('B', 'T2', '', new Date(Date.UTC(2025, 0, 6, 13))),
      mkFull('A', 'T3', 'Real', new Date(Date.UTC(2025, 0, 6, 14))),
    ];
    const rows = albumDepth(s, { minPlays: 1 });
    expect(rows.map((r) => r.album)).toEqual(['Real']);
  });

  it('separates same-titled albums by artist and applies the play floor', () => {
    const s = [
      mkFull('A', 'T1', 'Greatest Hits', new Date(Date.UTC(2025, 0, 6, 12))),
      mkFull('A', 'T2', 'Greatest Hits', new Date(Date.UTC(2025, 0, 7, 12))),
      mkFull('B', 'T1', 'Greatest Hits', new Date(Date.UTC(2025, 0, 8, 12))),
    ];
    expect(albumDepth(s, { minPlays: 1 })).toHaveLength(2);
    expect(albumDepth(s, { minPlays: 2 }).map((r) => r.artist)).toEqual(['A']);
  });
});

describe('sessions', () => {
  it('breaks sittings on a gap longer than the threshold', () => {
    const base = new Date(2025, 0, 6, 20).getTime();
    const at = (min: number) => new Date(base + min * 60_000);
    const s = [
      mk('A', at(0)),
      mk('A', at(4)),
      mk('B', at(8)), // one sitting: 3 plays
      mk('C', at(120)),
      mk('C', at(124)), // second sitting after 112 min of silence
    ];
    const d = sessions(s, { gapMinutes: 30 });
    expect(d.count).toBe(2);
    expect(d.totalPlays).toBe(5);
    expect(d.medianPlays).toBe(2.5);
    expect(d.meanPlays).toBeCloseTo(2.5);
    expect(d.startHours[20]).toBe(1); // first sitting at 20:00
    expect(d.startHours[22]).toBe(1); // second at 22:00, after the break
    expect(d.lengthBins.find((b) => b.label === '2–3')!.count).toBe(2);
    expect(d.longest).toMatchObject({ plays: 3, topArtist: 'A' });
    expect(d.longest!.topShare).toBeCloseTo(2 / 3);
  });

  it('merges the same plays into one sitting under a wider gap', () => {
    const base = new Date(2025, 0, 6, 20).getTime();
    const s = [
      mk('A', new Date(base)),
      mk('A', new Date(base + 45 * 60_000)),
    ];
    expect(sessions(s, { gapMinutes: 30 }).count).toBe(2);
    expect(sessions(s, { gapMinutes: 60 }).count).toBe(1);
  });

  it('does not assume the input is in time order', () => {
    const base = new Date(2025, 0, 6, 20).getTime();
    const ordered = [
      mk('A', new Date(base)),
      mk('A', new Date(base + 5 * 60_000)),
      mk('B', new Date(base + 200 * 60_000)),
    ];
    const shuffled = [ordered[2]!, ordered[0]!, ordered[1]!];
    const a = sessions(ordered, { gapMinutes: 30 });
    const b = sessions(shuffled, { gapMinutes: 30 });
    expect(b.count).toBe(a.count);
    expect(b.longest).toEqual(a.longest);
  });

  it('reports an empty shape rather than throwing on no plays', () => {
    const d = sessions([], { gapMinutes: 30 });
    expect(d.count).toBe(0);
    expect(d.longest).toBeNull();
    expect(d.startHours).toHaveLength(24);
  });
});

describe('yearOverYear', () => {
  it('accumulates per calendar year on a day-of-year axis', () => {
    const s = [
      mk('A', new Date(2023, 0, 1, 12)), // day 0
      mk('A', new Date(2023, 0, 1, 13)), // same day
      mk('A', new Date(2023, 1, 1, 12)), // day 31
      mk('A', new Date(2024, 0, 1, 12)),
    ];
    const { years, max } = yearOverYear(s);
    expect(years.map((y) => y.year)).toEqual([2023, 2024]);
    const y23 = years[0]!;
    expect(y23.cumulative[0]).toBe(2); // both Jan 1 plays
    expect(y23.cumulative[31]).toBe(3); // plus Feb 1
    expect(y23.total).toBe(3);
    // Silent days between carry the running total forward rather than dropping.
    expect(y23.cumulative[15]).toBe(2);
    expect(max).toBe(3);
  });

  it('stops a partial year at its last play instead of running flat to December', () => {
    const s = [mk('A', new Date(2025, 1, 10, 12))]; // Feb 10 -> day 40
    const { years } = yearOverYear(s);
    expect(years[0]!.cumulative).toHaveLength(41);
    expect(years[0]!.cumulative[40]).toBe(1);
  });

  it('keeps leap-year days in range', () => {
    const s = [mk('A', new Date(2024, 11, 31, 12))]; // day 365 of a leap year
    const { years } = yearOverYear(s);
    expect(years[0]!.cumulative).toHaveLength(366);
    expect(years[0]!.total).toBe(1);
  });
});

describe('retention', () => {
  it('groups artists by discovery year and lays plays out by age in months', () => {
    const all = [
      // Discovered Jan 2020, played again 2 months later.
      mk('A', new Date(Date.UTC(2020, 0, 15, 12))),
      mk('A', new Date(Date.UTC(2020, 2, 15, 12))),
      // Discovered Jun 2021.
      mk('B', new Date(Date.UTC(2021, 5, 15, 12))),
    ];
    const { cohorts } = retention(all, firstPlayMap(all));
    expect(cohorts.map((c) => c.year)).toEqual([2020, 2021]);
    const c20 = cohorts[0]!;
    expect(c20.artists).toBe(1);
    expect(c20.total).toBe(2);
    expect(c20.months[0]).toBe(1); // debut month
    expect(c20.months[2]).toBe(1); // two months later
    expect(c20.months[1]).toBe(0);
    expect(c20.shares[0]).toBeCloseTo(0.5);
  });

  it('reports the age by which half a cohort had been played', () => {
    // 1 play at debut, 3 more a year later: the median play sits at month 12.
    const all = [
      mk('A', new Date(Date.UTC(2020, 0, 15, 12))),
      ...[0, 1, 2].map((i) =>
        mk('A', new Date(Date.UTC(2021, 0, 15, 12 + i))),
      ),
    ];
    const { cohorts } = retention(all, firstPlayMap(all));
    expect(cohorts[0]!.halfLifeMonths).toBe(12);
  });

  it('marks recent cohorts as only partly observed', () => {
    const all = [
      mk('Old', new Date(Date.UTC(2020, 0, 15, 12))),
      mk('New', new Date(Date.UTC(2023, 0, 15, 12))),
      mk('New', new Date(Date.UTC(2023, 6, 15, 12))), // last month in the data
    ];
    const { cohorts } = retention(all, firstPlayMap(all));
    const byYear = new Map(cohorts.map((c) => [c.year, c]));
    // Data ends Jul 2023: the 2020 cohort has 42 months of observation, the
    // 2023 one only 6 — so its later columns are unobserved, not empty.
    expect(byYear.get(2020)!.fullyObservedMonths).toBe(42);
    expect(byYear.get(2023)!.fullyObservedMonths).toBe(6);
  });

  it('censors a half-life the observation window is too short to place', () => {
    // Both cohorts measure a 12-month half-life. The 2015 one has been watched
    // for 108 months since, so the figure is settled; the 2023 one has been
    // watched for exactly 12, so 12 is just where the data runs out.
    const all = [
      mk('Old', new Date(Date.UTC(2015, 0, 15, 12))),
      ...[0, 1, 2].map((i) => mk('Old', new Date(Date.UTC(2016, 0, 15, 12 + i)))),
      mk('New', new Date(Date.UTC(2023, 0, 15, 12))),
      ...[0, 1, 2].map((i) => mk('New', new Date(Date.UTC(2024, 0, 15, 12 + i)))),
    ];
    const byYear = new Map(
      retention(all, firstPlayMap(all)).cohorts.map((c) => [c.year, c]),
    );
    expect(byYear.get(2015)!.halfLifeMonths).toBe(12);
    expect(byYear.get(2023)!.halfLifeMonths).toBe(12);
    expect(byYear.get(2015)!.halfLifeCensored).toBe(false);
    expect(byYear.get(2023)!.halfLifeCensored).toBe(true);
  });

  it('censors a young cohort even when its half-life reads as zero', () => {
    // Everything in the debut month gives half-life 0, which would otherwise
    // pass any "observed long enough" ratio test trivially.
    const all = [
      mk('A', new Date(Date.UTC(2025, 0, 15, 12))),
      mk('A', new Date(Date.UTC(2025, 0, 16, 12))),
    ];
    const [cohort] = retention(all, firstPlayMap(all)).cohorts;
    expect(cohort!.halfLifeMonths).toBe(0);
    expect(cohort!.halfLifeCensored).toBe(true);
  });

  it('uses full-history debuts, so an old artist is never a new cohort', () => {
    const all = [
      mk('A', new Date(Date.UTC(2019, 0, 15, 12))),
      mk('A', new Date(Date.UTC(2024, 0, 15, 12))),
    ];
    // Even when only the 2024 play is passed, a full-history first-play map
    // keeps A in the 2019 cohort at age 60 months.
    const { cohorts } = retention(all.slice(1), firstPlayMap(all));
    expect(cohorts.map((c) => c.year)).toEqual([2019]);
    expect(cohorts[0]!.months[60]).toBe(1);
  });

  it('drops ages beyond the cap', () => {
    const all = [
      mk('A', new Date(Date.UTC(2010, 0, 15, 12))),
      mk('A', new Date(Date.UTC(2025, 0, 15, 12))), // 180 months later
    ];
    const { cohorts } = retention(all, firstPlayMap(all), { maxMonths: 24 });
    expect(cohorts[0]!.total).toBe(1); // only the debut play survives the cap
  });
});

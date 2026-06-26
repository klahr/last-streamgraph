import { describe, it, expect } from 'vitest';
import {
  punchcard,
  seasonal,
  discovery,
  dailyCounts,
  rankOverTime,
  forecast,
  networkGraph,
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
  it('sums plays per month-of-year', () => {
    const s = [
      mk('A', new Date(2023, 0, 10)),
      mk('A', new Date(2025, 0, 2)),
      mk('B', new Date(2024, 6, 1)),
    ];
    const months = seasonal(s);
    expect(months[0]).toBe(2); // January across years
    expect(months[6]).toBe(1); // July
    expect(months.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe('discovery', () => {
  it('reports first-play time and count per artist, ordered by first play', () => {
    const s = [
      mk('A', new Date(2020, 0, 1)),
      mk('B', new Date(2019, 0, 1)),
      mk('A', new Date(2021, 0, 1)),
    ];
    const d = discovery(s);
    expect(d.map((x) => x.artist)).toEqual(['B', 'A']); // B discovered earlier
    const a = d.find((x) => x.artist === 'A')!;
    expect(a.count).toBe(2);
    expect(a.firstMs).toBe(new Date(2020, 0, 1).getTime());
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
  it('projects horizon months and flags a rising trend', () => {
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
    expect(series!.trend).toBe('rising');
    expect(series!.slope).toBeGreaterThan(0);
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

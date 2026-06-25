import { describe, it, expect } from 'vitest';
import {
  punchcard,
  seasonal,
  discovery,
  dailyCounts,
  rankOverTime,
  forecast,
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
});

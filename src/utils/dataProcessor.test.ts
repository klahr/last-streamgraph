import { describe, it, expect } from 'vitest';
import {
  aggregate,
  bucketFor,
  buildFromAggregation,
  processScrobbles,
  OTHERS_KEY,
} from './dataProcessor';
import type { Scrobble } from '../types';

/** Epoch seconds for a UTC date. */
const uts = (iso: string) => Math.floor(Date.parse(iso) / 1000);

let idCounter = 0;
function mk(artist: string, iso: string): Scrobble {
  const t = uts(iso);
  return {
    id: `u::${t}::${artist}::${idCounter++}`,
    user: 'u',
    artist,
    album: '',
    track: 't',
    uts: t,
  };
}

describe('bucketFor', () => {
  it('buckets monthly into calendar months (UTC)', () => {
    expect(bucketFor(uts('2025-01-15T12:00:00Z'), 'monthly')).toEqual({
      start: Date.UTC(2025, 0, 1),
      label: '2025-01',
    });
    expect(bucketFor(uts('2025-12-31T23:59:59Z'), 'monthly').label).toBe('2025-12');
  });

  it('buckets weekly into ISO weeks (Monday start)', () => {
    // 2025-01-15 is a Wednesday in ISO week 3; week starts Mon 2025-01-13.
    const b = bucketFor(uts('2025-01-15T12:00:00Z'), 'weekly');
    expect(b.label).toBe('2025-W03');
    expect(b.start).toBe(Date.UTC(2025, 0, 13));
  });

  it('assigns Jan 1 2025 (Wed) to ISO week 1', () => {
    expect(bucketFor(uts('2025-01-01T00:00:00Z'), 'weekly').label).toBe('2025-W01');
  });

  it('buckets yearly into calendar years (UTC)', () => {
    expect(bucketFor(uts('2025-07-15T12:00:00Z'), 'yearly')).toEqual({
      start: Date.UTC(2025, 0, 1),
      label: '2025',
    });
    expect(bucketFor(uts('2025-01-01T00:00:00Z'), 'yearly').label).toBe('2025');
    expect(bucketFor(uts('2025-12-31T23:59:59Z'), 'yearly').label).toBe('2025');
  });
});

describe('processScrobbles yearly resolution', () => {
  it('zero-fills missing years across the span', () => {
    const sparse = [mk('A', '2021-06-01T00:00:00Z'), mk('A', '2024-06-01T00:00:00Z')];
    const res = processScrobbles({
      scrobbles: sparse,
      resolution: 'yearly',
      topN: 10,
      othersMode: 'group',
    });
    expect(res.matrix.map((m) => m.label)).toEqual(['2021', '2022', '2023', '2024']);
    expect(res.matrix[1].A).toBe(0); // 2022 has no plays
    expect(res.matrix[3].A).toBe(1);
  });
});

describe('processScrobbles', () => {
  const scrobbles: Scrobble[] = [
    ...Array.from({ length: 5 }, () => mk('A', '2025-01-10T00:00:00Z')),
    ...Array.from({ length: 3 }, () => mk('B', '2025-01-11T00:00:00Z')),
    mk('C', '2025-01-12T00:00:00Z'),
  ];

  it('ranks artists and folds the rest into Others', () => {
    const res = processScrobbles({
      scrobbles,
      resolution: 'monthly',
      topN: 2,
      othersMode: 'group',
    });
    expect(res.keys).toEqual(['A', 'B', OTHERS_KEY]);
    expect(res.matrix).toHaveLength(1);
    expect(res.matrix[0]).toMatchObject({ A: 5, B: 3, [OTHERS_KEY]: 1 });
    expect(res.grandTotal).toBe(9);
    expect(res.totals).toEqual({ A: 5, B: 3, [OTHERS_KEY]: 1 });
  });

  it('discards the rest when othersMode is discard', () => {
    const res = processScrobbles({
      scrobbles,
      resolution: 'monthly',
      topN: 2,
      othersMode: 'discard',
    });
    expect(res.keys).toEqual(['A', 'B']);
    // grandTotal counts ALL in-range plays (C is discarded from the chart but
    // still counted in the header's "plays across N months").
    expect(res.grandTotal).toBe(9);
    expect(res.matrix[0]).not.toHaveProperty(OTHERS_KEY);
  });

  it('selects the UNION of per-interval top-N (one-month wonders qualify)', () => {
    // X dominates January but is tiny overall; A dominates everything else.
    const data = [
      ...Array.from({ length: 10 }, () => mk('X', '2025-01-05T00:00:00Z')),
      mk('A', '2025-01-06T00:00:00Z'),
      ...Array.from({ length: 50 }, () => mk('A', '2025-02-05T00:00:00Z')),
    ];
    const res = processScrobbles({
      scrobbles: data,
      resolution: 'monthly',
      topN: 1, // top 1 per month
      othersMode: 'discard',
    });
    // Jan's leader is X, Feb's leader is A → union {A, X}, ordered by total.
    expect(res.keys).toEqual(['A', 'X']);
    expect(res.totals).toEqual({ A: 51, X: 10 });
    // X is present (as 0) in February even though it never charts there.
    const feb = res.matrix.find((m) => m.label === '2025-02')!;
    expect(feb.X).toBe(0);
    expect(feb.A).toBe(50);
  });

  it('zero-fills empty buckets so the time axis is continuous', () => {
    const sparse = [
      mk('A', '2025-01-05T00:00:00Z'),
      mk('A', '2025-03-05T00:00:00Z'),
    ];
    const res = processScrobbles({
      scrobbles: sparse,
      resolution: 'monthly',
      topN: 10,
      othersMode: 'group',
    });
    expect(res.matrix.map((m) => m.label)).toEqual([
      '2025-01',
      '2025-02',
      '2025-03',
    ]);
    expect(res.matrix[1].A).toBe(0); // February has no plays
  });

  it('respects the [from, to] date window at bucket granularity', () => {
    const data = [
      mk('A', '2025-01-15T00:00:00Z'),
      mk('A', '2025-01-16T00:00:00Z'),
      mk('B', '2025-02-15T00:00:00Z'),
      mk('C', '2025-03-15T00:00:00Z'),
      mk('C', '2025-03-16T00:00:00Z'),
      mk('C', '2025-03-17T00:00:00Z'),
    ];
    // Window from Feb 1 onward → January bucket excluded entirely.
    const res = processScrobbles({
      scrobbles: data,
      resolution: 'monthly',
      topN: 10,
      othersMode: 'group',
      from: Date.UTC(2025, 1, 1),
    });
    expect(res.matrix.map((m) => m.label)).toEqual(['2025-02', '2025-03']);
    expect(res.keys).toContain('B');
    expect(res.keys).toContain('C');
    expect(res.keys).not.toContain('A');
    expect(res.totals).toEqual({ B: 1, C: 3 }); // in-window totals only
    expect(res.grandTotal).toBe(4);
  });

  it('reuses one aggregation across top-N values (matches one-shot)', () => {
    // Aggregate once, then build at two limits — the perf optimization the
    // worker relies on. Each build must equal the equivalent processScrobbles.
    const agg = aggregate(scrobbles, 'monthly');
    for (const topN of [1, 2, 5]) {
      const cached = buildFromAggregation(agg, { topN, othersMode: 'group' });
      const oneShot = processScrobbles({
        scrobbles,
        resolution: 'monthly',
        topN,
        othersMode: 'group',
      });
      expect(cached).toEqual(oneShot);
    }
  });

  it('caps rendered streams to maxStreams, folding the tail into Others', () => {
    // 6 artists, each the sole leader of its own month → union of 6.
    const months = ['01', '02', '03', '04', '05', '06'];
    const names = ['A', 'B', 'C', 'D', 'E', 'F'];
    const data: Scrobble[] = [];
    names.forEach((name, i) => {
      // Descending totals so ordering is deterministic: A=6 … F=1.
      for (let k = 0; k < 6 - i; k++) data.push(mk(name, `2025-${months[i]}-05T00:00:00Z`));
    });
    const agg = aggregate(data, 'monthly');
    const res = buildFromAggregation(agg, { topN: 1, othersMode: 'group', maxStreams: 3 });
    // Only the 3 highest-total artists keep their own stream; D/E/F → Others.
    expect(res.keys).toEqual(['A', 'B', 'C', OTHERS_KEY]);
    expect(res.totals[OTHERS_KEY]).toBe(3 + 2 + 1); // D+E+F
    // Others is non-zero only in the months those artists led.
    const apr = res.matrix.find((m) => m.label === '2025-04')!;
    expect(apr[OTHERS_KEY]).toBe(3); // D's month
  });

  it('returns empty output for no scrobbles', () => {
    const res = processScrobbles({
      scrobbles: [],
      resolution: 'weekly',
      topN: 10,
      othersMode: 'group',
    });
    expect(res).toEqual({ keys: [], matrix: [], totals: {}, grandTotal: 0 });
  });
});

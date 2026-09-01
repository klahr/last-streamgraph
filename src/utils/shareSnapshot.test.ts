// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  MAX_FRAGMENT_CHARS,
  SNAPSHOT_VERSION,
  decodeSnapshot,
  encodeSnapshot,
  isSnapshotView,
  type Snapshot,
} from './shareSnapshot';
import type {
  DailyCounts,
  RetentionData,
  SeasonalData,
  SeasonalKey,
} from './analytics';
import { shareTitleFor } from '../viewMeta';

const base: Omit<Snapshot, 'view' | 'payload'> = {
  palette: 'viridis',
  groupBy: 'artist',
  topN: 12,
  hasGenres: false,
  from: Date.UTC(2020, 0, 1),
  to: Date.UTC(2025, 0, 1),
  label: '',
  made: Date.UTC(2026, 7, 19),
};

const snap = (view: Snapshot['view'], payload: unknown): Snapshot => ({
  ...base,
  view,
  payload,
});

async function roundTrip(s: Snapshot): Promise<Snapshot> {
  const result = await decodeSnapshot(await encodeSnapshot(s));
  if (!result.ok) throw new Error(`decode failed: ${result.reason}`);
  return result.snapshot;
}

describe('shareSnapshot', () => {
  it('round-trips a payload and its display settings', async () => {
    const out = await roundTrip(
      snap('tenure', [
        { artist: 'A', firstMs: 1, lastMs: 2, count: 3, activeDays: 2 },
      ]),
    );
    expect(out.view).toBe('tenure');
    expect(out.payload).toEqual([
      { artist: 'A', firstMs: 1, lastMs: 2, count: 3, activeDays: 2 },
    ]);
    expect(out.palette).toBe('viridis');
    expect(out.topN).toBe(12);
    expect(out.from).toBe(base.from);
  });

  it('preserves the calendar Map that JSON would otherwise flatten', async () => {
    // byDay is a Map; a naive JSON.stringify turns it into {} and the calendar
    // decodes to a silently empty year rather than an error.
    const payload: DailyCounts = {
      byDay: new Map([
        ['2024-01-01', 4],
        ['2024-01-02', 9],
      ]),
      max: 9,
      firstMs: Date.UTC(2024, 0, 1),
      lastMs: Date.UTC(2024, 0, 2),
    };
    const out = await roundTrip(snap('calendar', payload));
    const byDay = (out.payload as DailyCounts).byDay;
    expect(byDay).toBeInstanceOf(Map);
    expect(byDay.get('2024-01-02')).toBe(9);
    expect(byDay.size).toBe(2);
  });

  it('rebuilds the retention shares it drops on the way out', async () => {
    const payload: RetentionData = {
      cohorts: [
        {
          year: 2020,
          artists: 3,
          months: [6, 3, 1],
          shares: [0.6, 0.3, 0.1],
          total: 10,
          halfLifeMonths: 0,
          halfLifeCensored: false,
          fullyObservedMonths: 24,
        },
      ],
      maxAge: 2,
    };
    const out = await roundTrip(snap('retention', payload));
    const cohort = (out.payload as RetentionData).cohorts[0]!;
    expect(cohort.shares).toEqual([0.6, 0.3, 0.1]);
    expect(cohort.months).toEqual([6, 3, 1]);
  });

  it('upgrades a bare-array seasonal payload from the very first shape', async () => {
    const legacy = [9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 10];
    const out = await roundTrip(snap('seasonal', legacy));
    const d = out.payload as SeasonalData;
    expect(d.months).toEqual(legacy);
    expect(d.total).toBe(60);
    // No ranking travelled in such a link, and none is invented for it.
    expect(d.keys).toEqual([]);
    expect(d.coverage).toEqual(new Array(12).fill(0));
  });

  it('upgrades a seasonal payload from the season-signature shape', async () => {
    const legacy = {
      months: [9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 10],
      monthSignatures: new Array(12).fill(null),
      seasons: [0, 1, 2, 3].map(() => ({ plays: 15, signature: null })),
      total: 60,
    };
    const out = await roundTrip(snap('seasonal', legacy));
    const d = out.payload as SeasonalData;
    expect(d.months).toEqual(legacy.months);
    expect(d.total).toBe(60);
    expect(d.keys).toEqual([]);
  });

  it('passes a current seasonal payload through untouched', async () => {
    const payload: SeasonalData = {
      months: new Array(12).fill(5),
      coverage: new Array(12).fill(30),
      others: [],
      unprofiled: 4,
      oneYearOnly: 2,
      notSeasonal: 1,
      playFloor: 12,
      total: 60,
      keys: [
        {
          key: 'Cozy',
          plays: 40,
          byMonth: [40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          lift: [12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          peakMonth: 0,
          peakLift: 4,
          strength: 1,
          chanceDrift: 0.14,
          activeYears: 3,
          agreeingYears: 3,
          score: 1,
          reason: 'ranked',
        },
      ],
    };
    const out = await roundTrip(snap('seasonal', payload));
    // `lift` is dropped on the wire and rebuilt from byMonth/plays against the
    // payload's own months and total, so the round trip must still be exact.
    expect(out.payload as SeasonalData).toEqual(payload);
    const encoded = await encodeSnapshot(snap('seasonal', payload));
    expect(encoded).not.toContain('lift');
  });

  it('leaves the sharer\'s unranked library index out of the link', async () => {
    // `others` backs the app's search box. It is the biggest thing in the
    // payload and it is the sharer's whole library, neither of which belongs in
    // a link that says "here is this one chart".
    const unranked: SeasonalKey = {
      key: 'Someone Obscure',
      plays: 9,
      byMonth: [9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      lift: [12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      peakMonth: 0,
      peakLift: 4,
      strength: 1,
      chanceDrift: 0.3,
      activeYears: 1,
      agreeingYears: 0,
      score: 0,
      reason: 'one-year',
    };
    const payload: SeasonalData = {
      months: new Array(12).fill(5),
      coverage: new Array(12).fill(30),
      keys: [],
      others: [unranked],
      unprofiled: 0,
      oneYearOnly: 1,
      notSeasonal: 0,
      playFloor: 12,
      total: 60,
    };
    const out = await roundTrip(snap('seasonal', payload));
    expect((out.payload as SeasonalData).others).toEqual([]);
    expect(await encodeSnapshot(snap('seasonal', payload))).not.toContain('Obscure');
  });

  it('refuses a fragment from a different snapshot version', async () => {
    const fragment = await encodeSnapshot(snap('seasonal', [1, 2, 3]));
    const bumped = `${SNAPSHOT_VERSION + 1}.${fragment.split('.')[1]}`;
    await expect(decodeSnapshot(bumped)).resolves.toEqual({
      ok: false,
      reason: 'version',
    });
  });

  it('reports damaged and empty fragments distinctly', async () => {
    await expect(decodeSnapshot('')).resolves.toEqual({ ok: false, reason: 'empty' });
    await expect(decodeSnapshot('#')).resolves.toEqual({ ok: false, reason: 'empty' });
    await expect(decodeSnapshot('nodot')).resolves.toEqual({
      ok: false,
      reason: 'corrupt',
    });
    await expect(decodeSnapshot('1.@@@not-base64@@@')).resolves.toEqual({
      ok: false,
      reason: 'corrupt',
    });
  });

  it('tolerates a leading hash, as read straight off location.hash', async () => {
    const fragment = await encodeSnapshot(snap('seasonal', [1, 2, 3]));
    const result = await decodeSnapshot(`#${fragment}`);
    expect(result.ok).toBe(true);
  });

  it('keeps a realistic payload well inside the fragment budget', async () => {
    // 12 groups x 12 members, the sunburst's actual cut.
    const payload = {
      name: 'All',
      children: Array.from({ length: 12 }, (_, g) => ({
        name: `Genre number ${g}`,
        children: Array.from({ length: 12 }, (_, a) => ({
          name: `An Artist Name ${g}-${a}`,
          value: 100 + a,
        })),
      })),
    };
    const fragment = await encodeSnapshot(snap('sunburst', payload));
    expect(fragment.length).toBeLessThan(MAX_FRAGMENT_CHARS);
  });

  it('excludes the streamgraph, which draws from another pipeline', () => {
    expect(isSnapshotView('streamgraph')).toBe(false);
    expect(isSnapshotView('retention')).toBe(true);
  });
});

describe('shareTitleFor', () => {
  it('names the sharer possessively and drops tab decoration', () => {
    expect(shareTitleFor('obsessions', 'klarre908')).toBe("klarre908's Obsessions");
    // The tab reads "🔮 Forecast"; a poster title shouldn't.
    expect(shareTitleFor('forecast', 'klarre908')).toBe("klarre908's Forecast");
  });

  it('falls back to the bare view name without a username', () => {
    expect(shareTitleFor('retention', '')).toBe('Retention');
    expect(shareTitleFor('retention', '   ')).toBe('Retention');
  });
});

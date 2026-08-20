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
import type { DailyCounts, RetentionData, SeasonalData } from './analytics';
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

  it('upgrades a seasonal payload shared before the season ring existed', async () => {
    const legacy = [9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 10];
    const out = await roundTrip(snap('seasonal', legacy));
    const d = out.payload as SeasonalData;
    expect(d.months).toEqual(legacy);
    expect(d.total).toBe(60);
    // Winter straddles the year boundary: Dec + Jan + Feb.
    expect(d.seasons[0]!.plays).toBe(10 + 9 + 8);
    // The signatures simply aren't in such a link; the ring says so.
    expect(d.seasons.every((x) => x.signature === null)).toBe(true);
    expect(d.monthSignatures).toHaveLength(12);
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

// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  punchcard,
  seasonal,
  discovery,
  dailyCounts,
  rankOverTime,
  forecast,
  networkGraph,
  obsessions,
  novelty,
  firstPlayMap,
  tenure,
  genreHours,
  albumDepth,
  sessions,
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

// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Headline numbers for the share poster, read straight off the snapshot's own
 * payload — nothing here recomputes or infers anything the chart isn't already
 * drawing.
 */
import { SEASONS, SEASON_OF_MONTH } from './analytics';
import type { Snapshot } from './shareSnapshot';
import type {
  AlbumDepth,
  DailyCounts,
  Discovery,
  ForecastSeries,
  GenreHours,
  HierNode,
  NetworkData,
  NoveltyData,
  ObsessionData,
  Punchcard,
  RankData,
  RetentionData,
  SeasonalData,
  SessionsData,
  Tenure,
  YearOverYearData,
} from './analytics';

export interface Fact {
  label: string;
  value: string;
}

const n = (v: number) => v.toLocaleString();

/** Up to three figures worth putting above the chart, or none. */
export function snapshotFacts(snapshot: Snapshot): Fact[] {
  const p = snapshot.payload;
  switch (snapshot.view) {
    case 'punchcard':
      return [{ label: 'plays', value: n((p as Punchcard).total) }];
    case 'calendar': {
      const d = p as DailyCounts;
      return [
        { label: 'days with plays', value: n(d.byDay.size) },
        { label: 'busiest day', value: n(d.max) },
      ];
    }
    case 'seasonal': {
      const d = p as SeasonalData;
      const facts: Fact[] = [{ label: 'plays', value: n(d.total) }];
      // The top-ranked key is the one line of this chart worth reading before
      // the chart itself. Old links carry no ranking; they just show the plays.
      const top = d.keys?.[0];
      if (top) {
        facts.push({
          label: `most ${SEASONS[SEASON_OF_MONTH[top.peakMonth]!]!.name.toLowerCase()}`,
          value: top.key,
        });
        facts.push({ label: 'at its peak', value: `${top.peakLift.toFixed(1)}×` });
      }
      return facts;
    }
    case 'discovery':
      return [{ label: 'artists discovered', value: n((p as Discovery[]).length) }];
    case 'rankbump': {
      const d = p as RankData;
      return [
        { label: 'artists ranked', value: n(d.series.length) },
        { label: 'time buckets', value: n(d.buckets.length) },
      ];
    }
    case 'sunburst': {
      const d = p as HierNode;
      const groups = d.children ?? [];
      const inner = groups.reduce((a, g) => a + (g.children?.length ?? 0), 0);
      return [
        { label: 'groups', value: n(groups.length) },
        { label: 'members', value: n(inner) },
      ];
    }
    case 'network': {
      const d = p as NetworkData;
      return [
        { label: 'artists', value: n(d.nodes.length) },
        { label: 'connections', value: n(d.links.length) },
      ];
    }
    case 'obsessions':
      return [{ label: 'obsessions', value: n((p as ObsessionData).tracks.length) }];
    case 'novelty': {
      const { fresh, familiar } = (p as NoveltyData).totals;
      const total = fresh + familiar;
      return [
        { label: 'plays', value: n(total) },
        {
          label: 'from new artists',
          value: total ? `${Math.round((fresh / total) * 100)}%` : '—',
        },
      ];
    }
    case 'tenure':
      return [{ label: 'artists', value: n((p as Tenure[]).length) }];
    case 'genrehours': {
      const d = p as GenreHours;
      return [
        { label: 'genres', value: n(d.rows.length) },
        { label: 'plays', value: n(d.total) },
      ];
    }
    case 'albumdepth':
      return [{ label: 'albums', value: n((p as AlbumDepth[]).length) }];
    case 'sessions': {
      const d = p as SessionsData;
      return [
        { label: 'sessions', value: n(d.count) },
        { label: 'median plays', value: n(d.medianPlays) },
        { label: 'median length', value: `${n(d.medianMinutes)} min` },
      ];
    }
    case 'yoy':
      return [{ label: 'years', value: n((p as YearOverYearData).years.length) }];
    case 'retention': {
      const d = p as RetentionData;
      return [
        { label: 'cohorts', value: n(d.cohorts.length) },
        {
          label: 'artists',
          value: n(d.cohorts.reduce((a, c) => a + c.artists, 0)),
        },
      ];
    }
    case 'forecast': {
      const d = p as ForecastSeries[];
      const dead = d.filter((s) => s.trend === 'dead').length;
      return [
        { label: 'series', value: n(d.length) },
        ...(dead ? [{ label: 'gone quiet', value: n(dead) }] : []),
      ];
    }
    default:
      return [];
  }
}

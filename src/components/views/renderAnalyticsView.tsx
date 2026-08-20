// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The one place that maps an analytics payload to its component.
 *
 * Both the app and the snapshot poster render the same charts from the same
 * union, so the mapping lives here rather than being written twice — a shared
 * link showing a subtly different chart from the app it came from would be a
 * quiet betrayal of the whole feature.
 *
 * The streamgraph is absent on purpose: it draws from `useProcessedData`, not
 * from the analytics worker, so it isn't part of this union.
 */
import type { ReactNode } from 'react';
import type { AnalyticsViewResult } from '../../hooks/useAnalytics';
import type { Size } from '../../hooks/useResizeObserver';
import type { GroupBy, PaletteId } from '../../types';
import { Punchcard } from './Punchcard';
import { CalendarHeatmap } from './CalendarHeatmap';
import { SeasonalRadial } from './SeasonalRadial';
import { DiscoveryTimeline } from './DiscoveryTimeline';
import { RankBump } from './RankBump';
import { Sunburst } from './Sunburst';
import { ArtistNetwork } from './ArtistNetwork';
import { Obsessions } from './Obsessions';
import { NoveltyStream } from './NoveltyStream';
import { TenureChart } from './TenureChart';
import { GenreClock } from './GenreClock';
import { AlbumDepth } from './AlbumDepth';
import { Sessions } from './Sessions';
import { YearOverYear } from './YearOverYear';
import { Retention } from './Retention';
import { Forecast } from './Forecast';

export interface AnalyticsViewOptions {
  result: AnalyticsViewResult;
  size: Size;
  palette: PaletteId;
  /** Needed by the sunburst (which rings) and the forecast (its copy). */
  groupBy: GroupBy;
  /** Needed by the discovery timeline. */
  topN: number;
  /** Whether artist→genre tags have loaded; only genre-keyed views care. */
  hasGenres: boolean;
}

/** What a genre-capable view is actually keyed by right now. */
export function effectiveGroupBy(
  groupBy: GroupBy,
  hasGenres: boolean,
): 'artist' | 'genre' | 'album' {
  if (groupBy === 'genre') return hasGenres ? 'genre' : 'artist';
  return groupBy === 'album' ? 'album' : 'artist';
}

export function renderAnalyticsView({
  result,
  size,
  palette,
  groupBy,
  topN,
  hasGenres,
}: AnalyticsViewOptions): ReactNode {
  const d = { size, palette };
  switch (result.view) {
    case 'punchcard':
      return <Punchcard data={result.payload} {...d} />;
    case 'calendar':
      return <CalendarHeatmap data={result.payload} {...d} />;
    case 'seasonal':
      return (
        <SeasonalRadial
          data={result.payload}
          {...d}
          groupBy={groupBy}
          hasGenres={hasGenres}
        />
      );
    case 'discovery':
      return <DiscoveryTimeline data={result.payload} {...d} topN={topN} />;
    case 'rankbump':
      return <RankBump data={result.payload} {...d} />;
    case 'sunburst':
      return (
        <Sunburst data={result.payload} {...d} groupBy={groupBy} hasGenres={hasGenres} />
      );
    case 'network':
      return <ArtistNetwork data={result.payload} {...d} />;
    case 'obsessions':
      return <Obsessions data={result.payload} {...d} />;
    case 'novelty':
      return <NoveltyStream data={result.payload} {...d} />;
    case 'tenure':
      return <TenureChart data={result.payload} {...d} />;
    case 'genrehours':
      return <GenreClock data={result.payload} {...d} hasGenres={hasGenres} />;
    case 'albumdepth':
      return <AlbumDepth data={result.payload} {...d} />;
    case 'sessions':
      return <Sessions data={result.payload} {...d} />;
    case 'yoy':
      return <YearOverYear data={result.payload} {...d} />;
    case 'retention':
      return <Retention data={result.payload} {...d} />;
    case 'forecast':
      return (
        <Forecast data={result.payload} by={effectiveGroupBy(groupBy, hasGenres)} />
      );
    default:
      return null;
  }
}

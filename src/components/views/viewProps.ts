// SPDX-License-Identifier: GPL-3.0-or-later
import type { Size } from '../../hooks/useResizeObserver';
import type { GroupBy, PaletteId } from '../../types';
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
  SessionsData,
  Tenure,
  YearOverYearData,
} from '../../utils/analytics';

/** Common display-only props shared by every auxiliary visualization. */
export interface DisplayProps {
  size: Size;
  palette: PaletteId;
}

export interface PunchcardProps extends DisplayProps {
  data: Punchcard;
}

export interface CalendarProps extends DisplayProps {
  data: DailyCounts;
}

export interface SeasonalProps extends DisplayProps {
  data: number[];
}

export interface DiscoveryProps extends DisplayProps {
  data: Discovery[];
  topN: number;
}

export interface RankBumpProps extends DisplayProps {
  data: RankData;
}

export interface SunburstProps extends DisplayProps {
  data: HierNode;
  /** Which pair of rings is drawn: genre→artist, artist→album, album→track. */
  groupBy: GroupBy;
  /** Only consulted for genre grouping — the other two need no tag fetch. */
  hasGenres: boolean;
}

export interface NetworkProps extends DisplayProps {
  data: NetworkData;
}

export interface ObsessionsProps extends DisplayProps {
  data: ObsessionData;
}

export interface NoveltyProps extends DisplayProps {
  data: NoveltyData;
}

export interface TenureProps extends DisplayProps {
  data: Tenure[];
}

export interface GenreClockProps extends DisplayProps {
  data: GenreHours;
  hasGenres: boolean;
}

export interface AlbumDepthProps extends DisplayProps {
  data: AlbumDepth[];
}

export interface SessionsProps extends DisplayProps {
  data: SessionsData;
}

export interface YearOverYearProps extends DisplayProps {
  data: YearOverYearData;
}

export interface RetentionProps extends DisplayProps {
  data: RetentionData;
}

export interface ForecastProps {
  data: ForecastSeries[];
  /** What the projection is keyed by — drives the descriptor copy. */
  by: 'artist' | 'genre' | 'album';
}

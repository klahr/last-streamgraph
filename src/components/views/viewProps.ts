// SPDX-License-Identifier: GPL-3.0-or-later
import type { Size } from '../../hooks/useResizeObserver';
import type { PaletteId } from '../../types';
import type {
  DailyCounts,
  Discovery,
  ForecastSeries,
  HierNode,
  NetworkData,
  Punchcard,
  RankData,
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
  hasGenres: boolean;
}

export interface NetworkProps extends DisplayProps {
  data: NetworkData;
}

export interface ForecastProps {
  data: ForecastSeries[];
  /** What the projection is keyed by — drives the descriptor copy. */
  by: 'artist' | 'genre' | 'album';
}

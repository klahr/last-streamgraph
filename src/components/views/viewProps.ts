import type { Size } from '../../hooks/useResizeObserver';
import type { PaletteId, Resolution, Scrobble } from '../../types';

/** Common inputs every auxiliary visualization receives from App. */
export interface ViewProps {
  /** Date-range-filtered scrobbles for the current selection. */
  scrobbles: Scrobble[];
  size: Size;
  palette: PaletteId;
  /** Lowercased artist → genre (for genre-aware views). */
  genreMap: Record<string, string>;
  resolution: Resolution;
  topN: number;
}

/**
 * Color palette helpers. Each palette maps an artist's stacking position to a
 * stable color sampled across a D3 sequential interpolator.
 */
import {
  interpolateWarm,
  interpolateCool,
  interpolateViridis,
  interpolateTurbo,
  interpolateRainbow,
  interpolateSpectral,
} from 'd3-scale-chromatic';
import type { PaletteId } from '../types';
import { OTHERS_KEY } from './dataProcessor';

const INTERPOLATORS: Record<PaletteId, (t: number) => string> = {
  warm: interpolateWarm,
  cool: interpolateCool,
  viridis: interpolateViridis,
  turbo: interpolateTurbo,
  rainbow: interpolateRainbow,
  spectral: interpolateSpectral,
};

export const PALETTES: { id: PaletteId; label: string }[] = [
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'viridis', label: 'Viridis' },
  { id: 'turbo', label: 'Turbo' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'spectral', label: 'Spectral' },
];

const OTHERS_COLOR = '#5b6470';

/**
 * Build a `key -> color` lookup. Colors are spread across the interpolator's
 * [0.05, 0.95] window to avoid the washed-out extremes. "Others" always gets a
 * neutral gray so it reads as background.
 */
export function buildColorMap(
  keys: string[],
  palette: PaletteId,
): Record<string, string> {
  const interp = INTERPOLATORS[palette] ?? interpolateWarm;
  const colored = keys.filter((k) => k !== OTHERS_KEY);
  const n = Math.max(1, colored.length - 1);
  const map: Record<string, string> = {};
  colored.forEach((key, i) => {
    map[key] = interp(0.05 + (0.9 * i) / n);
  });
  if (keys.includes(OTHERS_KEY)) map[OTHERS_KEY] = OTHERS_COLOR;
  return map;
}

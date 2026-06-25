/**
 * Seasonal radial chart ("coxcomb" / polar bar): 12 wedges, one per month,
 * arranged clockwise from the top (Jan at 12 o'clock). Each wedge's outer
 * radius encodes that month's total play count (summed across years), using a
 * sqrt scale so the *area* of each wedge reads proportionally to its value.
 */
import { useMemo } from 'react';
import { arc } from 'd3';
import { seasonal } from '../../utils/analytics';
import { interpolatorFor } from '../../utils/colors';
import type { ViewProps } from './viewProps';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function SeasonalRadial({ scrobbles, size, palette }: ViewProps) {
  const counts = useMemo(() => seasonal(scrobbles), [scrobbles]);
  const interp = useMemo(() => interpolatorFor(palette), [palette]);

  const max = Math.max(0, ...counts);
  if (!scrobbles.length || max === 0) return <Empty />;

  const margin = 40; // leaves room for month labels outside the wedges
  const innerR = 30;
  const maxR = Math.max(innerR + 1, Math.min(size.width, size.height) / 2 - margin);
  const labelR = maxR + 14;

  // Equal angular slices, like d3.scaleBand: 2π/12 per month, clockwise from top.
  const slice = (2 * Math.PI) / 12;

  // sqrt scaling: area ∝ value. r = sqrt(lerp of value²-ish) mapped to [innerR, maxR].
  const radiusFor = (v: number) => innerR + (maxR - innerR) * Math.sqrt(v / max);

  // Color by month index across the palette (t = i/11) — gives a smooth
  // seasonal gradient that reads as a calendar cycle, which suits this view
  // better than magnitude-based shading.
  const arcGen = arc<{ inner: number; outer: number; start: number; end: number }>()
    .innerRadius((d) => d.inner)
    .outerRadius((d) => d.outer)
    .startAngle((d) => d.start)
    .endAngle((d) => d.end)
    .padAngle(0.01)
    .cornerRadius(2);

  const cx = size.width / 2;
  const cy = size.height / 2;

  return (
    <div className="h-full w-full overflow-hidden p-4">
      <svg width={size.width} height={size.height}>
        <g transform={`translate(${cx},${cy})`}>
          {counts.map((v, i) => {
            const start = i * slice;
            const end = start + slice;
            const mid = start + slice / 2;
            const outer = radiusFor(v);
            const d = arcGen({ inner: innerR, outer, start, end }) ?? '';
            // SVG angle 0 points up (-y); rotate by mid clockwise for the label.
            const lx = Math.sin(mid) * labelR;
            const ly = -Math.cos(mid) * labelR;
            return (
              <g key={i}>
                <path d={d} fill={interp(i / 11)} stroke="#0f172a" strokeWidth={1}>
                  <title>{`${MONTHS[i]} — ${v.toLocaleString()} plays`}</title>
                </path>
                <text
                  x={lx}
                  y={ly}
                  dy="0.32em"
                  textAnchor="middle"
                  className="fill-slate-400 text-[11px]"
                >
                  {MONTH_LABELS[i]}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex h-full w-full items-center justify-center text-slate-500">
      No scrobbles in range yet.
    </div>
  );
}

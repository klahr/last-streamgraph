// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Year over year: one cumulative curve per calendar year on a shared
 * day-of-year axis.
 *
 * Read vertically it answers "which year was the heavy one"; read at today's
 * date it answers "am I ahead of where I was last year". The most recent year is
 * drawn heaviest, since that's the line you're usually asking about, and each
 * curve is labelled at its own end rather than in a legend so a dozen years stay
 * legible.
 *
 * The Seasonal view aggregates month-of-year across all years and so can show
 * neither.
 */
import { useMemo } from 'react';
import { curveMonotoneX, line as d3line, scaleLinear } from 'd3';
import { interpolatorFor } from '../../utils/colors';
import type { YearOverYearProps } from './viewProps';

// Day-of-year offsets for month starts in a non-leap year. Close enough for
// gridlines; a leap year shifts later months by one day, which is invisible at
// this scale.
const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

export function YearOverYear({ data, size, palette }: YearOverYearProps) {
  const interp = useMemo(() => interpolatorFor(palette), [palette]);
  const { years, max } = data;

  const margin = { top: 16, right: 56, bottom: 30, left: 52 };
  const w = Math.max(0, size.width - margin.left - margin.right);
  const h = Math.max(0, size.height - margin.top - margin.bottom);

  const x = useMemo(() => scaleLinear().domain([0, 365]).range([0, w]), [w]);
  const y = useMemo(
    () => scaleLinear().domain([0, max]).nice().range([h, 0]),
    [max, h],
  );

  if (!years.length) return <Empty />;

  const shape = d3line<number>()
    .x((_, i) => x(i))
    .y((v) => y(v))
    .curve(curveMonotoneX);

  const newest = years[years.length - 1]!.year;
  const span = Math.max(1, years.length - 1);

  return (
    <div className="h-full w-full p-4">
      <p className="mb-1 text-xs text-slate-500">
        Cumulative plays through each year · brightest = most recent · a steeper
        line is a busier stretch
      </p>
      <svg width={size.width} height={Math.max(0, size.height - 22)}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {y.ticks(5).map((tk) => (
            <g key={tk} transform={`translate(0,${y(tk)})`}>
              <line x2={w} stroke="#1e293b" />
              <text x={-8} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[10px]">
                {tk.toLocaleString()}
              </text>
            </g>
          ))}
          {MONTH_STARTS.map((d, i) => (
            <g key={d}>
              <line x1={x(d)} x2={x(d)} y1={0} y2={h} stroke="#1e293b" />
              <text
                x={x(d) + 3}
                y={h + 14}
                className="fill-slate-500 text-[10px]"
              >
                {MONTH_LABELS[i]}
              </text>
            </g>
          ))}

          {years.map((s, i) => {
            const isNewest = s.year === newest;
            const color = interp(0.2 + (0.75 * i) / span);
            const endIdx = s.cumulative.length - 1;
            return (
              <g key={s.year}>
                <path
                  d={shape(s.cumulative) ?? ''}
                  fill="none"
                  stroke={color}
                  strokeWidth={isNewest ? 2.5 : 1.5}
                  strokeOpacity={isNewest ? 1 : 0.85}
                >
                  <title>
                    {`${s.year} — ${s.total.toLocaleString()} plays`}
                  </title>
                </path>
                {/* Label at the curve's own end, so partial years read clearly. */}
                <text
                  x={Math.min(w + 4, x(endIdx) + 5)}
                  y={y(s.cumulative[endIdx] ?? 0)}
                  dy="0.32em"
                  className="text-[10px]"
                  fill={color}
                  fontWeight={isNewest ? 600 : 400}
                >
                  {s.year}
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

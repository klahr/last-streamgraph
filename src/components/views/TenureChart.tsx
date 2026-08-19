// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Tenure: lifers vs. flings.
 *
 * One bar per artist, spanning their first to last play in range, ordered by
 * when they arrived. Bar shade encodes total plays; the tooltip and trailing
 * label add the active-day count, which is what separates a decade-long
 * companion (long bar, many active days) from an artist whose whole span is two
 * bursts of obsession years apart (long bar, very few).
 *
 * The Discovery view plots arrivals as points; this one shows how long anybody
 * actually stayed.
 */
import { useEffect, useMemo, useRef } from 'react';
import { axisBottom, scaleTime, select, timeFormat } from 'd3';
import { interpolatorFor } from '../../utils/colors';
import type { TenureProps } from './viewProps';

const ROW_H = 18;
const MIN_ROW_H = 11;
const DAY_MS = 86_400_000;

export function TenureChart({ data, size, palette }: TenureProps) {
  const interp = useMemo(() => interpolatorFor(palette), [palette]);
  const axisRef = useRef<SVGGElement | null>(null);

  const margin = { top: 12, right: 74, bottom: 28, left: 132 };
  const w = Math.max(0, size.width - margin.left - margin.right);

  // Rows get their natural height and the chart scrolls when they don't fit,
  // rather than squeezing 60 artists into illegible slivers.
  const rowH = data.length
    ? Math.max(MIN_ROW_H, Math.min(ROW_H, (size.height - margin.top - margin.bottom) / data.length))
    : ROW_H;
  const plotH = rowH * data.length;
  const svgH = Math.max(size.height, plotH + margin.top + margin.bottom);

  const x = useMemo(() => {
    const first = Math.min(...data.map((d) => d.firstMs));
    const last = Math.max(...data.map((d) => d.lastMs));
    return scaleTime()
      .domain([new Date(first), new Date(last === first ? first + DAY_MS : last)])
      .range([0, w]);
  }, [data, w]);

  const maxCount = useMemo(() => Math.max(1, ...data.map((d) => d.count)), [data]);
  const fmtTick = useMemo(() => timeFormat("%b '%y"), []);
  const fmtTip = useMemo(() => timeFormat('%b %Y'), []);

  useEffect(() => {
    if (!axisRef.current) return;
    const g = select(axisRef.current);
    g.call(axisBottom(x).ticks(6).tickFormat((d) => fmtTick(d as Date)));
    g.selectAll('text').attr('fill', '#94a3b8').attr('font-size', 10);
    g.selectAll('line').attr('stroke', '#334155');
    g.selectAll('.domain').attr('stroke', '#334155');
    return () => {
      g.selectAll('*').remove();
    };
  }, [x, fmtTick]);

  if (!data.length) return <Empty />;

  return (
    <div className="h-full w-full overflow-auto p-4">
      <svg width={size.width} height={svgH}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {x.ticks(6).map((t) => (
            <line
              key={+t}
              x1={x(t)}
              x2={x(t)}
              y1={0}
              y2={plotH}
              stroke="#1e293b"
            />
          ))}
          {data.map((d, i) => {
            const x0 = x(new Date(d.firstMs));
            const x1 = x(new Date(d.lastMs));
            const spanDays = Math.max(1, Math.round((d.lastMs - d.firstMs) / DAY_MS));
            const years = spanDays / 365;
            return (
              <g key={d.artist} transform={`translate(0,${i * rowH})`}>
                <text
                  x={-8}
                  y={rowH / 2}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-slate-400 text-[10px]"
                >
                  {d.artist.length > 22 ? `${d.artist.slice(0, 21)}…` : d.artist}
                  <title>{d.artist}</title>
                </text>
                <rect
                  x={x0}
                  y={(rowH - Math.max(4, rowH - 5)) / 2}
                  width={Math.max(2, x1 - x0)}
                  height={Math.max(4, rowH - 5)}
                  rx={2}
                  fill={interp(0.2 + 0.75 * Math.sqrt(d.count / maxCount))}
                >
                  <title>
                    {`${d.artist}\n${fmtTip(new Date(d.firstMs))} → ${fmtTip(new Date(d.lastMs))} (${years >= 1 ? `${years.toFixed(1)} yrs` : `${spanDays} days`})\n${d.count.toLocaleString()} plays across ${d.activeDays.toLocaleString()} active day${d.activeDays === 1 ? '' : 's'}`}
                  </title>
                </rect>
                {rowH >= 13 && (
                  <text
                    x={w + 8}
                    y={rowH / 2}
                    dy="0.32em"
                    className="fill-slate-600 text-[9px]"
                  >
                    {d.count.toLocaleString()} · {d.activeDays}d
                  </text>
                )}
              </g>
            );
          })}
          <g ref={axisRef} transform={`translate(0,${plotH})`} />
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

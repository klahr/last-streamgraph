// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Discovery timeline: when each artist first entered your library, layered over
 * a cumulative "distinct artists discovered so far" curve. Marker size encodes
 * an artist's all-time play count; only the biggest get labels to limit clutter.
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  area as d3area,
  axisBottom,
  curveStepAfter,
  line as d3line,
  scaleLinear,
  scaleTime,
  select,
  timeFormat,
} from 'd3';
import { interpolatorFor } from '../../utils/colors';
import type { DiscoveryProps } from './viewProps';

const MAX_MARKERS = 40;
const MAX_LABELS = 15;

export function DiscoveryTimeline({ data: disc, size, palette, topN }: DiscoveryProps) {
  const interp = useMemo(() => interpolatorFor(palette), [palette]);
  const axisRef = useRef<SVGGElement | null>(null);

  const margin = { top: 16, right: 16, bottom: 28, left: 44 };
  const w = Math.max(0, size.width - margin.left - margin.right);
  const h = Math.max(0, size.height - margin.top - margin.bottom);

  // Cumulative curve: disc is already sorted by firstMs ascending, so the index
  // (1-based) is exactly the number of distinct artists discovered by that time.
  const total = disc.length;
  const x = useMemo(() => {
    const first = disc[0]?.firstMs ?? 0;
    const last = disc[total - 1]?.firstMs ?? 1;
    return scaleTime()
      .domain([new Date(first), new Date(last === first ? first + 1 : last)])
      .range([0, w]);
  }, [disc, total, w]);
  const y = useMemo(
    () => scaleLinear().domain([0, Math.max(1, total)]).range([h, 0]),
    [total, h],
  );

  // (firstMs, cumulative-index) points for the rising step curve.
  const curve = useMemo(
    () => disc.map((d, i) => ({ ms: d.firstMs, n: i + 1 })),
    [disc],
  );

  // Marker artists: top-N (capped) by all-time play count.
  const markers = useMemo(() => {
    const indexByArtist = new Map(disc.map((d, i) => [d.artist, i + 1]));
    const ranked = [...disc].sort((a, b) => b.count - a.count);
    const maxCount = ranked[0]?.count ?? 1;
    const limit = Math.min(topN, MAX_MARKERS);
    return ranked.slice(0, limit).map((d, rank) => ({
      artist: d.artist,
      firstMs: d.firstMs,
      count: d.count,
      n: indexByArtist.get(d.artist) ?? 0,
      r: 3 + 9 * Math.sqrt(d.count / maxCount),
      label: rank < MAX_LABELS,
    }));
  }, [disc, topN]);

  const fmtTick = useMemo(() => timeFormat("%b '%y"), []);
  const fmtTip = useMemo(() => timeFormat('%Y-%m'), []);

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

  if (!total) return <Empty />;

  const areaPath =
    d3area<{ ms: number; n: number }>()
      .x((d) => x(new Date(d.ms)))
      .y0(h)
      .y1((d) => y(d.n))
      .curve(curveStepAfter)(curve) ?? undefined;
  const linePath =
    d3line<{ ms: number; n: number }>()
      .x((d) => x(new Date(d.ms)))
      .y((d) => y(d.n))
      .curve(curveStepAfter)(curve) ?? undefined;

  return (
    <div className="h-full w-full p-4">
      <svg width={size.width} height={size.height}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* cumulative discovery curve */}
          <path d={areaPath} fill="#334155" fillOpacity={0.35} />
          <path d={linePath} fill="none" stroke="#64748b" strokeWidth={1.5} />

          {/* axes */}
          <g ref={axisRef} transform={`translate(0,${h})`} />
          <text
            x={-8}
            y={y(total)}
            dy="0.32em"
            textAnchor="end"
            className="fill-slate-500 text-[10px]"
          >
            {total}
          </text>
          <text x={-8} y={h} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[10px]">
            0
          </text>

          {/* artist markers */}
          {markers.map((m) => (
            <g key={m.artist}>
              <circle
                cx={x(new Date(m.firstMs))}
                cy={y(m.n)}
                r={m.r}
                fill={interp(0.15 + 0.8 * (m.n / total))}
                fillOpacity={0.85}
                stroke="#0f172a"
                strokeWidth={0.75}
              >
                <title>
                  {`${m.artist} — discovered ${fmtTip(new Date(m.firstMs))}, ${m.count.toLocaleString()} plays`}
                </title>
              </circle>
              {m.label && (
                <text
                  x={x(new Date(m.firstMs)) + m.r + 3}
                  y={y(m.n)}
                  dy="0.32em"
                  className="fill-slate-400 text-[10px]"
                >
                  {m.artist}
                </text>
              )}
            </g>
          ))}
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

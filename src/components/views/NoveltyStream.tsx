// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * New vs. familiar: were you exploring, or comforting yourself?
 *
 * Each bucket's plays split into artists making their first-ever appearance
 * (fresh) and artists you already knew (familiar), stacked so the band heights
 * read as volume, with the fresh *share* drawn on its own 0–100% axis so the
 * ratio stays visible even in a quiet month.
 *
 * "First-ever" is measured against your whole history, not the selected range —
 * narrowing the date filter doesn't turn old favourites back into discoveries.
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  area as d3area,
  axisBottom,
  curveMonotoneX,
  line as d3line,
  scaleLinear,
  scaleTime,
  select,
  timeFormat,
} from 'd3';
import type { NoveltyProps } from './viewProps';
import type { NoveltyBucket } from '../../utils/analytics';

const FRESH = '#38bdf8'; // sky-400 — the new stuff
const FAMILIAR = '#475569'; // slate-600 — the back catalogue
const SHARE = '#fbbf24'; // amber-400 — the ratio line

export function NoveltyStream({ data, size }: NoveltyProps) {
  const axisRef = useRef<SVGGElement | null>(null);
  const { buckets, totals } = data;

  const margin = { top: 16, right: 44, bottom: 28, left: 46 };
  const w = Math.max(0, size.width - margin.left - margin.right);
  const h = Math.max(0, size.height - margin.top - margin.bottom);

  const x = useMemo(() => {
    const first = buckets[0]?.ms ?? 0;
    const last = buckets[buckets.length - 1]?.ms ?? first + 1;
    return scaleTime()
      .domain([new Date(first), new Date(last === first ? first + 1 : last)])
      .range([0, w]);
  }, [buckets, w]);

  const yMax = useMemo(
    () => Math.max(1, ...buckets.map((b) => b.fresh + b.familiar)),
    [buckets],
  );
  const y = useMemo(
    () => scaleLinear().domain([0, yMax]).nice().range([h, 0]),
    [yMax, h],
  );
  const yShare = useMemo(() => scaleLinear().domain([0, 1]).range([h, 0]), [h]);

  const fmtTick = useMemo(() => timeFormat("%b '%y"), []);

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

  if (!buckets.length) return <Empty />;

  const familiarArea = d3area<NoveltyBucket>()
    .x((b) => x(new Date(b.ms)))
    .y0(() => y(0))
    .y1((b) => y(b.familiar))
    .curve(curveMonotoneX);
  // Fresh stacks on top of familiar, so the outer edge is the bucket total.
  const freshArea = d3area<NoveltyBucket>()
    .x((b) => x(new Date(b.ms)))
    .y0((b) => y(b.familiar))
    .y1((b) => y(b.familiar + b.fresh))
    .curve(curveMonotoneX);
  const shareLine = d3line<NoveltyBucket>()
    .x((b) => x(new Date(b.ms)))
    .y((b) => {
      const total = b.fresh + b.familiar;
      return yShare(total ? b.fresh / total : 0);
    })
    .curve(curveMonotoneX);

  const grand = totals.fresh + totals.familiar;
  const overall = grand ? totals.fresh / grand : 0;
  const bandW = Math.max(1, w / Math.max(1, buckets.length));

  return (
    <div className="h-full w-full p-4">
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <Swatch color={FRESH} label={`New artists (${totals.fresh.toLocaleString()} plays)`} />
        <Swatch color={FAMILIAR} label={`Familiar (${totals.familiar.toLocaleString()})`} />
        <Swatch color={SHARE} label={`New share — ${Math.round(overall * 100)}% overall`} dashed />
      </div>
      <svg width={size.width} height={Math.max(0, size.height - 24)}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {y.ticks(5).map((tk) => (
            <g key={tk} transform={`translate(0,${y(tk)})`}>
              <line x2={w} stroke="#1e293b" />
              <text x={-8} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[10px]">
                {tk.toLocaleString()}
              </text>
            </g>
          ))}
          {/* right-hand axis for the share line */}
          {[0, 0.5, 1].map((p) => (
            <text
              key={p}
              x={w + 8}
              y={yShare(p)}
              dy="0.32em"
              className="fill-amber-500/70 text-[10px]"
            >
              {p * 100}%
            </text>
          ))}

          <path d={familiarArea(buckets) ?? ''} fill={FAMILIAR} fillOpacity={0.75} />
          <path d={freshArea(buckets) ?? ''} fill={FRESH} fillOpacity={0.8} />
          <path
            d={shareLine(buckets) ?? ''}
            fill="none"
            stroke={SHARE}
            strokeWidth={1.25}
            strokeDasharray="3 2"
            strokeOpacity={0.9}
          />

          {/* Invisible hit bands carry the per-bucket tooltip. */}
          {buckets.map((b) => {
            const total = b.fresh + b.familiar;
            const pct = total ? Math.round((b.fresh / total) * 100) : 0;
            return (
              <rect
                key={b.ms}
                x={x(new Date(b.ms)) - bandW / 2}
                y={0}
                width={bandW}
                height={h}
                fill="transparent"
              >
                <title>
                  {`${b.label} — ${total.toLocaleString()} plays\n${b.fresh.toLocaleString()} from ${b.debuts.toLocaleString()} new artist${b.debuts === 1 ? '' : 's'} (${pct}%)`}
                </title>
              </rect>
            );
          })}

          <g ref={axisRef} transform={`translate(0,${h})`} />
        </g>
      </svg>
    </div>
  );
}

function Swatch({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5 text-slate-400">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={
          dashed
            ? { border: `1.5px dashed ${color}`, backgroundColor: 'transparent' }
            : { backgroundColor: color }
        }
      />
      {label}
    </span>
  );
}

function Empty() {
  return (
    <div className="flex h-full w-full items-center justify-center text-slate-500">
      No scrobbles in range yet.
    </div>
  );
}

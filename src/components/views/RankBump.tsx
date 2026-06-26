/**
 * Rank bump chart: tracks how the top artists' ranking shifts across time
 * buckets. Each artist is a line through its (bucket, rank) points with rank 1
 * pinned to the top; lines break where an artist drops out of the ranking.
 */
import { useMemo, useState } from 'react';
import { line, curveBumpX, scalePoint, scaleLinear } from 'd3';
import { buildColorMap } from '../../utils/colors';
import type { RankBumpProps } from './viewProps';

interface Point {
  i: number;
  rank: number | null;
}

export function RankBump({ data, size, palette }: RankBumpProps) {
  const colors = useMemo(
    () => buildColorMap(data.series.map((s) => s.key), palette),
    [data.series, palette],
  );
  // Key of the hovered series; null when none. Hovering brings a line to full
  // strength and dims the rest so it's easier to follow across crowded buckets.
  const [hovered, setHovered] = useState<string | null>(null);

  if (!data.buckets.length) return <Empty />;

  const { buckets, series } = data;
  const margin = { top: 24, right: 120, bottom: 36, left: 36 };
  const w = Math.max(0, size.width - margin.left - margin.right);
  const h = Math.max(0, size.height - margin.top - margin.bottom);

  const maxRank = Math.max(
    1,
    ...series.flatMap((s) => s.ranks.filter((r): r is number => r != null)),
  );

  const x = scalePoint<number>()
    .domain(buckets.map((_, i) => i))
    .range([0, w]);
  // Rank 1 at the top: invert the range so smaller ranks sit higher.
  const y = scaleLinear().domain([1, maxRank]).range([0, h]);

  const xOf = (i: number) => x(i) ?? 0;

  const lineGen = line<Point>()
    .defined((d) => d.rank != null)
    .x((d) => xOf(d.i))
    .y((d) => y(d.rank as number))
    .curve(curveBumpX);

  // Tick subset: keep the bottom axis from crowding.
  const tickEvery = Math.max(1, Math.ceil(buckets.length / 8));
  const xTicks = buckets
    .map((b, i) => ({ b, i }))
    .filter(({ i }) => i % tickEvery === 0 || i === buckets.length - 1);

  const yTicks = Array.from(
    new Set([1, 5, 10, maxRank].filter((r) => r >= 1 && r <= maxRank)),
  ).sort((a, b) => a - b);

  return (
    <div className="h-full w-full overflow-hidden bg-slate-900 p-4">
      <svg width={size.width} height={size.height}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* y axis (rank gridlines + labels) */}
          {yTicks.map((r) => (
            <g key={r} transform={`translate(0,${y(r)})`}>
              <line x1={0} x2={w} stroke="#1e293b" />
              <text x={-8} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[10px]">
                {r}
              </text>
            </g>
          ))}

          {/* x axis (subset of bucket labels) */}
          {xTicks.map(({ b, i }) => (
            <g key={i} transform={`translate(${xOf(i)},${h})`}>
              <line y2={6} stroke="#334155" />
              <text y={18} textAnchor="middle" className="fill-slate-400 text-[10px]">
                {b.label}
              </text>
            </g>
          ))}

          {/* Hover lingers over the whole chart so moving between a line and
              its label/circles doesn't flicker; leaving the chart clears it. */}
          <g
            onMouseLeave={() => setHovered(null)}
          >
            {/* series lines + points. The hovered series is rendered last so its
              stroke sits on top of the dimmed siblings. */}
            {[...series]
              .sort((a, b) => (a.key === hovered ? 1 : b.key === hovered ? -1 : 0))
              .map((s) => {
            const points: Point[] = s.ranks.map((rank, i) => ({ i, rank }));
            const color = colors[s.key] ?? '#94a3b8';
            const isHovered = hovered === s.key;
            const dim = hovered !== null && !isHovered;
            const path = lineGen(points) ?? '';
            // Last defined point gets the label.
            let lastDefined = -1;
            for (let i = points.length - 1; i >= 0; i--) {
              if (points[i]!.rank != null) {
                lastDefined = i;
                break;
              }
            }
            return (
              <g
                key={s.key}
                onMouseEnter={() => setHovered(s.key)}
                style={{ opacity: dim ? 0.15 : 1, transition: 'opacity 120ms' }}
              >
                <path d={path} fill="none" stroke={color} strokeWidth={isHovered ? 3 : 2} strokeLinecap="round" />
                {points.map((p) =>
                  p.rank != null ? (
                    <circle key={p.i} cx={xOf(p.i)} cy={y(p.rank)} r={isHovered ? 4 : 3} fill={color}>
                      <title>{`${s.key} — #${p.rank} (${buckets[p.i]!.label})`}</title>
                    </circle>
                  ) : null,
                )}
                {lastDefined >= 0 && (
                  <text
                    x={xOf(lastDefined) + 8}
                    y={y(points[lastDefined]!.rank as number)}
                    dy="0.32em"
                    className="text-[11px]"
                    fill={color}
                  >
                    {s.key}
                  </text>
                )}
              </g>
            );
              })}
          </g>
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

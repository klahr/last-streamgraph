// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Genre sunburst: a two-ring radial breakdown of your listening. The inner ring
 * is your top genres (sized by total plays); the outer ring is each genre's top
 * artists, drawn in shades of the parent genre's color so a ring reads as
 * "variations within a genre".
 */
import { useMemo } from 'react';
import { arc, hierarchy, partition } from 'd3';
import { interpolatorFor } from '../../utils/colors';
import type { SunburstProps } from './viewProps';

export function GenreSunburst({ data: root, size, palette, hasGenres }: SunburstProps) {
  const interp = useMemo(() => interpolatorFor(palette), [palette]);

  if (!hasGenres || !root.children?.length) {
    return <Message text="Switch Group-by to Genres (and let genres finish fetching) to see this." />;
  }

  const margin = 8;
  const radius = Math.max(0, Math.min(size.width, size.height) / 2 - margin);

  // partition() returns a rectangular node carrying x0/x1/y0/y1.
  const layout = partition<typeof root>().size([2 * Math.PI, radius])(
    hierarchy(root)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
  );

  // Inner ring (depth 1 = genres) occupies the first radius band; the outer
  // ring (depth 2 = artists) the second. Skip the root (depth 0).
  const inner = radius * 0.55;
  const ringFor = (depth: number) =>
    depth === 1 ? { y0: 0, y1: inner } : { y0: inner, y1: radius };

  const genres = layout.children ?? [];
  const genreColor = new Map<string, string>();
  const denom = Math.max(1, genres.length - 1);
  genres.forEach((g, i) => {
    genreColor.set(g.data.name, interp(0.05 + (0.9 * i) / denom));
  });

  const arcGen = arc<{ x0: number; x1: number; y0: number; y1: number }>()
    .startAngle((d) => d.x0)
    .endAngle((d) => d.x1)
    .innerRadius((d) => d.y0)
    .outerRadius((d) => d.y1)
    .padAngle(0.004)
    .padRadius(radius);

  const nodes = layout.descendants().filter((d) => d.depth >= 1);

  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden p-4">
      <svg width={size.width} height={size.height}>
        <g transform={`translate(${size.width / 2},${size.height / 2})`}>
          {nodes.map((d, i) => {
            const ring = ringFor(d.depth);
            const path = arcGen({ x0: d.x0, x1: d.x1, y0: ring.y0, y1: ring.y1 });
            if (!path) return null;
            const isGenre = d.depth === 1;
            const genreName = isGenre ? d.data.name : (d.parent?.data.name ?? '');
            const base = genreColor.get(genreName) ?? '#5b6470';
            const plays = (d.value ?? 0).toLocaleString();
            const title = isGenre
              ? `${genreName} — ${plays} plays`
              : `${genreName} › ${d.data.name} — ${plays} plays`;
            const wide = d.x1 - d.x0 > 0.12;
            const labelAngle = (d.x0 + d.x1) / 2;
            const labelR = (ring.y0 + ring.y1) / 2;
            const rotate = (labelAngle * 180) / Math.PI - 90;
            const flip = labelAngle > Math.PI;
            return (
              <g key={i}>
                <path
                  d={path}
                  fill={base}
                  fillOpacity={isGenre ? 0.95 : 0.55}
                  stroke="#0f172a"
                  strokeWidth={0.75}
                >
                  <title>{title}</title>
                </path>
                {isGenre && wide && (
                  <text
                    transform={`rotate(${rotate}) translate(${labelR},0)${flip ? ' rotate(180)' : ''}`}
                    textAnchor="middle"
                    dy="0.32em"
                    className="pointer-events-none fill-slate-100 text-[10px]"
                  >
                    {d.data.name}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function Message({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-6 text-center text-slate-500">
      {text}
    </div>
  );
}

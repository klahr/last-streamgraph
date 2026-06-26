// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Artist affinity network: a force-directed graph where artists you play on the
 * same days pull together. Node size encodes total plays; node color encodes
 * genre (falling back to neutral slate); edges encode how many local days two
 * artists were played together. Layout is computed once per input change by
 * running the simulation synchronously for a fixed number of ticks (no
 * animation loop), then rendered statically.
 *
 * The O(N) co-play aggregation runs in the analytics Web Worker (see {@link
 * networkGraph}); this component only runs the size-dependent d3-force
 * simulation and rendering.
 */
import { useMemo } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from 'd3';
import { buildColorMap } from '../../utils/colors';
import type { NetworkProps } from './viewProps';
import type { NetworkNode } from '../../utils/analytics';

const NEUTRAL_SLATE = '#64748b';
const LAYOUT_TICKS = 300;
const LABEL_COUNT = 20;

interface SimNode extends NetworkNode {
  r: number;
  color: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  index?: number;
}

interface SimLink {
  source: SimNode | string | number;
  target: SimNode | string | number;
  weight: number;
}

export function ArtistNetwork({ data, size, palette }: NetworkProps) {
  const { nodes: rawNodes, links: rawLinks } = data;

  // Add render-only r/color to the worker-produced nodes.
  const { nodes, links } = useMemo(() => {
    if (!rawNodes.length) return { nodes: [] as SimNode[], links: [] as SimLink[] };

    const maxCount = rawNodes[0]!.count;
    const distinctGenres = [
      ...new Set(
        rawNodes
          .map((n) => n.genre)
          .filter((g): g is string => Boolean(g)),
      ),
    ];
    const genreColors = buildColorMap(distinctGenres, palette);

    const nodes: SimNode[] = rawNodes.map((n) => ({
      ...n,
      r: 4 + 18 * Math.sqrt(n.count / maxCount),
      color: n.genre ? genreColors[n.genre] ?? NEUTRAL_SLATE : NEUTRAL_SLATE,
    }));

    const links: SimLink[] = rawLinks.map((l) => ({
      source: l.source,
      target: l.target,
      weight: l.weight,
    }));

    return { nodes, links };
  }, [rawNodes, rawLinks, palette]);

  const positioned = useMemo(() => {
    if (!nodes.length) return { nodes: [] as SimNode[], links: [] as SimLink[], maxWeight: 1 };

    const w = Math.max(1, size.width);
    const h = Math.max(1, size.height);

    // Work on copies so the simulation mutates throwaway objects.
    const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
    const byArtist = new Map(simNodes.map((n) => [n.artist, n]));
    const simLinks: SimLink[] = links
      .map((l) => ({
        source: byArtist.get(l.source as string)!,
        target: byArtist.get(l.target as string)!,
        weight: l.weight,
      }))
      .filter((l) => l.source && l.target);

    const sim = forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.artist)
          .distance((l) => 60 / Math.sqrt(l.weight)),
      )
      .force('charge', forceManyBody().strength(-120))
      .force('center', forceCenter(w / 2, h / 2))
      .force(
        'collide',
        forceCollide<SimNode>().radius((d) => d.r + 2),
      )
      .stop();

    for (let i = 0; i < LAYOUT_TICKS; i++) sim.tick();

    // Clamp into the viewport.
    for (const n of simNodes) {
      n.x = Math.max(n.r, Math.min(w - n.r, n.x ?? w / 2));
      n.y = Math.max(n.r, Math.min(h - n.r, n.y ?? h / 2));
    }

    const maxWeight = simLinks.reduce((m, l) => Math.max(m, l.weight), 1);
    return { nodes: simNodes, links: simLinks, maxWeight };
  }, [nodes, links, size.width, size.height]);

  if (!rawNodes.length) return <Empty />;

  const labelled = new Set(
    [...positioned.nodes]
      .sort((a, b) => b.count - a.count)
      .slice(0, LABEL_COUNT)
      .map((n) => n.artist),
  );

  return (
    <div className="h-full w-full overflow-hidden p-4">
      <svg width={size.width} height={size.height}>
        <g>
          {positioned.links.map((l, i) => {
            const s = l.source as SimNode;
            const t = l.target as SimNode;
            return (
              <line
                key={i}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke="#94a3b8"
                strokeOpacity={0.08 + 0.32 * (l.weight / positioned.maxWeight)}
                strokeWidth={1}
              />
            );
          })}
        </g>
        <g>
          {positioned.nodes.map((n) => (
            <circle
              key={n.artist}
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill={n.color}
              stroke="#0f172a"
              strokeWidth={1}
            >
              <title>{`${n.artist} — ${n.count.toLocaleString()} plays${n.genre ? ` · ${n.genre}` : ''}`}</title>
            </circle>
          ))}
        </g>
        <g>
          {positioned.nodes
            .filter((n) => labelled.has(n.artist))
            .map((n) => (
              <text
                key={n.artist}
                x={n.x}
                y={(n.y ?? 0) - n.r - 3}
                textAnchor="middle"
                className="pointer-events-none fill-slate-300 text-[10px]"
              >
                {n.artist}
              </text>
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

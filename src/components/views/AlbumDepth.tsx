// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Album depth: deep cuts vs. hits.
 *
 * Breadth (how many of an album's tracks you've played) against depth (total
 * plays). Albums you lived inside sit top-right; a single you heard once sits
 * bottom-left. The dashed reference curve is one play per track — anything above
 * it is repeat listening rather than a single pass through.
 *
 * Marker color encodes recency, so a cluster of pale dots reads as "albums I've
 * moved on from" without needing a second chart.
 *
 * Honest limit: scrobbles carry no tracklists, so the x axis is how much of an
 * album *you* touched, not how complete your listening was — and nothing here
 * knows whether you played it in order.
 */
import { useEffect, useMemo, useRef } from 'react';
import { axisBottom, scaleLinear, scaleSqrt, select, timeFormat } from 'd3';
import { interpolatorFor } from '../../utils/colors';
import type { AlbumDepthProps } from './viewProps';

const MAX_LABELS = 12;

export function AlbumDepth({ data, size, palette }: AlbumDepthProps) {
  const interp = useMemo(() => interpolatorFor(palette), [palette]);
  const axisRef = useRef<SVGGElement | null>(null);

  const margin = { top: 16, right: 20, bottom: 34, left: 52 };
  const w = Math.max(0, size.width - margin.left - margin.right);
  const h = Math.max(0, size.height - margin.top - margin.bottom);

  const maxTracks = useMemo(
    () => Math.max(2, ...data.map((d) => d.distinctTracks)),
    [data],
  );
  const maxPlays = useMemo(() => Math.max(2, ...data.map((d) => d.plays)), [data]);

  const x = useMemo(
    () => scaleLinear().domain([0, maxTracks]).nice().range([0, w]),
    [maxTracks, w],
  );
  // sqrt on plays: one 900-play album would otherwise flatten the whole cloud
  // onto the axis, and this view is about the cloud's shape.
  const y = useMemo(
    () => scaleSqrt().domain([0, maxPlays]).nice().range([h, 0]),
    [maxPlays, h],
  );

  const [minLast, maxLast] = useMemo(() => {
    const times = data.map((d) => d.lastMs);
    return [Math.min(...times), Math.max(...times)];
  }, [data]);

  const r = useMemo(
    () => scaleSqrt().domain([1, Math.max(2, ...data.map((d) => d.playsPerTrack))]).range([3, 11]),
    [data],
  );

  const fmtTip = useMemo(() => timeFormat('%b %Y'), []);

  useEffect(() => {
    if (!axisRef.current) return;
    const g = select(axisRef.current);
    g.call(axisBottom(x).ticks(8).tickFormat((d) => String(d)));
    g.selectAll('text').attr('fill', '#94a3b8').attr('font-size', 10);
    g.selectAll('line').attr('stroke', '#334155');
    g.selectAll('.domain').attr('stroke', '#334155');
    return () => {
      g.selectAll('*').remove();
    };
  }, [x]);

  if (!data.length) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6 text-center text-slate-500">
        No albums with 3+ plays in range yet.
      </div>
    );
  }

  // Reference curve plays = distinctTracks. Sampled rather than a straight line
  // because the y axis is sqrt-scaled.
  const refPath = Array.from({ length: 41 }, (_, i) => {
    const tracks = (maxTracks * i) / 40;
    return `${i === 0 ? 'M' : 'L'}${x(tracks)},${y(Math.min(tracks, maxPlays))}`;
  }).join('');

  const labelled = new Set(
    [...data].sort((a, b) => b.plays - a.plays).slice(0, MAX_LABELS).map((d) => `${d.artist}/${d.album}`),
  );
  const recency = (ms: number) =>
    maxLast === minLast ? 1 : (ms - minLast) / (maxLast - minLast);

  return (
    <div className="h-full w-full p-4">
      <p className="mb-1 text-xs text-slate-500">
        Breadth (distinct tracks played) × depth (total plays) · brighter = played
        more recently · dashed line = one play per track
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
          <path d={refPath} fill="none" stroke="#475569" strokeWidth={1} strokeDasharray="4 3" />

          {data.map((d) => {
            const key = `${d.artist}/${d.album}`;
            const cx = x(d.distinctTracks);
            const cy = y(d.plays);
            const rad = r(Math.max(1, d.playsPerTrack));
            return (
              <g key={key}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={rad}
                  fill={interp(0.15 + 0.8 * recency(d.lastMs))}
                  fillOpacity={0.8}
                  stroke="#0f172a"
                  strokeWidth={0.75}
                >
                  <title>
                    {`${d.album} — ${d.artist}\n${d.plays.toLocaleString()} plays across ${d.distinctTracks} track${d.distinctTracks === 1 ? '' : 's'} (${d.playsPerTrack.toFixed(1)} per track)\nlast played ${fmtTip(new Date(d.lastMs))}`}
                  </title>
                </circle>
                {labelled.has(key) && (
                  <text
                    x={cx + rad + 3}
                    y={cy}
                    dy="0.32em"
                    className="fill-slate-400 text-[10px]"
                  >
                    {d.album.length > 24 ? `${d.album.slice(0, 23)}…` : d.album}
                  </text>
                )}
              </g>
            );
          })}

          <g ref={axisRef} transform={`translate(0,${h})`} />
          <text
            x={w / 2}
            y={h + 30}
            textAnchor="middle"
            className="fill-slate-500 text-[10px]"
          >
            distinct tracks played
          </text>
        </g>
      </svg>
    </div>
  );
}

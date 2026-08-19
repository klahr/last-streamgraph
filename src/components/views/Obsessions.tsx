// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Obsessions: the tracks you played into the ground.
 *
 * Small multiples, one sparkline per track, ranked by *burst* rather than by
 * total plays — peak plays in any seven-day stretch, weighted by how much of the
 * track's listening that stretch accounts for. The result is a wall of spikes:
 * the song you played forty times one week in March and never again.
 *
 * Every sparkline shares one weekly timeline (the whole selected range), so a
 * spike's horizontal position is directly comparable between cards.
 */
import { useMemo } from 'react';
import { area, curveMonotoneX, scaleLinear, timeFormat } from 'd3';
import { interpolatorFor } from '../../utils/colors';
import type { ObsessionsProps } from './viewProps';
import type { Obsession } from '../../utils/analytics';

// Logical sparkline canvas. Cards scale it via viewBox, so strokes are marked
// non-scaling to survive the horizontal stretch.
const SPARK_W = 300;
const SPARK_H = 52;

export function Obsessions({ data, palette }: ObsessionsProps) {
  const interp = useMemo(() => interpolatorFor(palette), [palette]);
  const fmtYear = useMemo(() => timeFormat('%b %Y'), []);
  const { weeks, tracks } = data;

  if (!tracks.length) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6 text-center text-slate-500">
        No track-level bursts in range yet — an obsession needs at least 8 plays
        of one track.
      </div>
    );
  }

  const first = weeks[0]!;
  const last = weeks[weeks.length - 1]!;

  return (
    <div className="h-full w-full overflow-auto p-4">
      <p className="mb-3 text-xs text-slate-500">
        Ranked by burst: peak plays in any 7 days × how concentrated the track's
        listening is. All sparklines share one timeline —{' '}
        <span className="text-slate-400">
          {fmtYear(new Date(first))} → {fmtYear(new Date(last))}
        </span>
        .
      </p>
      <div className="flex flex-wrap gap-3">
        {tracks.map((t, i) => (
          <div key={`${t.artist}/${t.track}`} className="w-full sm:w-[340px]">
            <ObsessionCard
              t={t}
              weeks={weeks}
              color={interp(0.25 + (0.6 * i) / Math.max(1, tracks.length - 1))}
              fmtDate={fmtYear}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ObsessionCard({
  t,
  weeks,
  color,
  fmtDate,
}: {
  t: Obsession;
  weeks: number[];
  color: string;
  fmtDate: (d: Date) => string;
}) {
  const x = scaleLinear()
    .domain([0, Math.max(1, weeks.length - 1)])
    .range([0, SPARK_W]);
  const yMax = Math.max(1, ...t.series);
  const y = scaleLinear().domain([0, yMax]).range([SPARK_H, 0]);

  const shape = area<number>()
    .x((_, i) => x(i))
    .y0(SPARK_H)
    .y1((v) => y(v))
    .curve(curveMonotoneX);

  // Where the peak window starts, in grid coordinates — the marker lands on the
  // week containing it rather than on the busiest week of the series, so it
  // agrees with the headline number.
  const peakIdx = weeks.findIndex((w, i) => {
    const next = weeks[i + 1] ?? Infinity;
    return t.peakMs >= w && t.peakMs < next;
  });

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/60 p-2">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-sm text-slate-200" title={t.track}>
          {t.track}
        </span>
        <span className="shrink-0 text-xs font-medium" style={{ color }}>
          {t.peak}× / week
        </span>
      </div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-slate-500" title={t.artist}>
          {t.artist}
        </span>
        <span className="shrink-0 text-[10px] text-slate-600">
          {t.total.toLocaleString()} plays ·{' '}
          {Math.round(t.concentration * 100)}% in one week
        </span>
      </div>
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        width="100%"
        height={SPARK_H}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${t.track} by ${t.artist}: ${t.total} plays, peaking at ${t.peak} in the week of ${fmtDate(new Date(t.peakMs))}`}
      >
        <line
          x1={0}
          x2={SPARK_W}
          y1={SPARK_H - 0.5}
          y2={SPARK_H - 0.5}
          stroke="#1e293b"
          vectorEffect="non-scaling-stroke"
        />
        {peakIdx >= 0 && (
          <line
            x1={x(peakIdx)}
            x2={x(peakIdx)}
            y1={0}
            y2={SPARK_H}
            stroke={color}
            strokeOpacity={0.35}
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path d={shape(t.series) ?? ''} fill={color} fillOpacity={0.55} />
        <path
          d={shape.lineY1()(t.series) ?? ''}
          fill="none"
          stroke={color}
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
        />
        <title>
          {`${t.track} — ${t.artist}\n${t.total.toLocaleString()} plays, peak ${t.peak} in the week of ${fmtDate(new Date(t.peakMs))}`}
        </title>
      </svg>
    </div>
  );
}

// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * "Crystal ball" view: a TA-style projection of future listening.
 *
 * Small multiples — one mini chart per top series (genre if genres are loaded,
 * else artist). Each shows monthly history (solid), a simple moving average
 * (faint), and a least-squares trend projected `horizon` months ahead (dashed)
 * with a residual-based uncertainty band. It's a naive extrapolation, not a
 * real forecast — listening isn't a stock — so treat it as for-fun.
 */
import { useResizeObserver } from '../../hooks/useResizeObserver';
import { area, curveMonotoneX, line, scaleLinear } from 'd3';
import type { ForecastProps } from './viewProps';
import type { ForecastSeries } from '../../utils/analytics';
import { FORECAST_HORIZON } from '../../workers/analytics.worker';

const CARD_H = 150;
const M = { top: 22, right: 10, bottom: 18, left: 30 };

export function Forecast({ data: series, by }: ForecastProps) {
  if (!series.length) {
    return (
      <div className="flex h-full w-full items-center justify-center text-slate-500">
        No scrobbles in range yet.
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto p-4">
      <p className="mb-3 text-xs text-slate-500">
        Projecting the next {FORECAST_HORIZON} months by {by} —
        moving average + a damped trend with month-of-year seasonality, inside a
        band that widens with distance. The faint dashed line over the history
        is the same model run backwards — where it tracks, the forecast has
        earned a little trust. Each card is graded ↑↑ surging → ☠ dead by how
        fast it's moving relative to its own average. Still a naive
        extrapolation, for fun.
      </p>
      <div className="flex flex-wrap gap-3">
        {series.map((s) => (
          <div key={s.key} className="w-full sm:w-[340px]">
            <ForecastCard s={s} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The momentum ramp, strongest growth first. Hue carries direction (green up,
 * warm down) and lightness carries strength, so the two growth states stay
 * legibly "good" instead of a mild gain being painted warning-orange. Every
 * state also has its own glyph and its own word — on a green/yellow/orange
 * ramp the colour is the redundant channel, not the load-bearing one.
 */
const TREND = {
  surging: { arrow: '↑↑', cls: 'text-emerald-300', stroke: '#6ee7b7' },
  rising: { arrow: '↑', cls: 'text-emerald-500', stroke: '#10b981' },
  flat: { arrow: '→', cls: 'text-slate-400', stroke: '#94a3b8' },
  easing: { arrow: '↓', cls: 'text-yellow-400', stroke: '#facc15' },
  falling: { arrow: '↓↓', cls: 'text-orange-400', stroke: '#fb923c' },
  dead: { arrow: '☠', cls: 'text-slate-500', stroke: '#64748b' },
} as const;

function ForecastCard({ s }: { s: ForecastSeries }) {
  // Measure the card's own content box so the SVG fills it exactly — no
  // arithmetic drift from the grid track / padding. Same pattern as the main
  // chart's useResizeObserver.
  const [cardRef, size] = useResizeObserver<HTMLDivElement>();
  const width = Math.max(0, size.width);
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = CARD_H - M.top - M.bottom;
  const t = TREND[s.trend];

  const n = s.history.length;
  // Split the width so the prediction always gets a legible share of the graph
  // (30%), independent of how long the history is. Without this a 6-month
  // forecast on years of history renders as a thin sliver at the right edge.
  // Each region stays internally proportional to months; only the px/month
  // rate steps at the divider.
  const HIST_FRAC = 0.7;
  const histW = innerW * HIST_FRAC;
  const xHist = scaleLinear()
    .domain([0, Math.max(1, n - 1)])
    .range([0, histW]);
  const xProj = scaleLinear()
    .domain([0, Math.max(1, s.projection.length)])
    .range([histW, innerW]);
  const yMax = Math.max(
    1,
    ...s.history.map((p) => p.value),
    ...s.projection.map((p) => p.hi),
    ...s.fitted.map((v) => v ?? 0),
  );
  const y = scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

  const histLine = line<{ value: number }>()
    .x((_, i) => xHist(i))
    .y((d) => y(d.value))
    .curve(curveMonotoneX);

  const smaPts = s.sma
    .map((v, i) => ({ v, i }))
    .filter((d): d is { v: number; i: number } => d.v != null);
  const smaLine = line<{ v: number; i: number }>()
    .x((d) => xHist(d.i))
    .y((d) => y(d.v))
    .curve(curveMonotoneX);

  // The projection's own model, drawn back over the months it was fitted on:
  // where this hugs the solid history line the dashed future is worth some
  // trust, where it doesn't it isn't.
  const fitPts = s.fitted
    .map((v, i) => ({ v, i }))
    .filter((d): d is { v: number; i: number } => d.v != null);
  const fitLine = line<{ v: number; i: number }>()
    .x((d) => xHist(d.i))
    .y((d) => y(d.v))
    .curve(curveMonotoneX);

  // Projection path continues from the last history point (which sits at the
  // divider, xProj(0)).
  // Start the projection from the fitted endpoint, not the raw last month, so
  // the backfit and the forecast meet at the divider instead of jumping.
  const last = { value: s.fitted[n - 1] ?? s.history[n - 1]?.value ?? 0 };
  const projLine = line<{ value: number }>()
    .x((_, i) => xProj(i))
    .y((d) => y(d.value))
    .curve(curveMonotoneX);
  const projData = [last, ...s.projection];

  const bandArea = area<{ lo: number; hi: number }>()
    .x((_, i) => xProj(i + 1))
    .y0((d) => y(d.lo))
    .y1((d) => y(d.hi))
    .curve(curveMonotoneX);

  return (
    <div
      ref={cardRef}
      className={`rounded-md border border-slate-800 bg-slate-900/60 p-2 ${
        s.trend === 'dead' ? 'opacity-60' : ''
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-sm text-slate-200" title={s.key}>
          {s.key}
        </span>
        <span
          className={`shrink-0 text-sm font-medium ${t.cls}`}
          title={
            s.trend === 'dead'
              ? `faded out — slope ${s.slope.toFixed(1)}/mo`
              : `slope ${s.slope.toFixed(1)}/mo`
          }
        >
          {t.arrow} {s.trend}
        </span>
      </div>
      <svg width="100%" height={CARD_H}>
        <g transform={`translate(${M.left},${M.top})`}>
          {y.ticks(3).map((tk) => (
            <g key={tk} transform={`translate(0,${y(tk)})`}>
              <line x2={innerW} stroke="#1e293b" />
              <text x={-6} dy="0.32em" textAnchor="end" className="fill-slate-600 text-[9px]">
                {tk}
              </text>
            </g>
          ))}
          {/* divider between past and future */}
          <line x1={histW} x2={histW} y2={innerH} stroke="#334155" strokeDasharray="2 2" />
          <path d={bandArea(s.projection) ?? ''} fill={t.stroke} fillOpacity={0.12} />
          <path d={smaLine(smaPts) ?? ''} fill="none" stroke="#64748b" strokeWidth={1} strokeOpacity={0.7} />
          <path
            d={fitLine(fitPts) ?? ''}
            fill="none"
            stroke={t.stroke}
            strokeWidth={1}
            strokeDasharray="4 3"
            strokeOpacity={0.45}
          />
          <path d={histLine(s.history) ?? ''} fill="none" stroke="#cbd5e1" strokeWidth={1.5} />
          <path d={projLine(projData) ?? ''} fill="none" stroke={t.stroke} strokeWidth={1.5} strokeDasharray="4 3" />
        </g>
      </svg>
    </div>
  );
}

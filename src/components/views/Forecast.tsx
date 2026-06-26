/**
 * "Crystal ball" view: a TA-style projection of future listening.
 *
 * Small multiples — one mini chart per top series (genre if genres are loaded,
 * else artist). Each shows monthly history (solid), a simple moving average
 * (faint), and a least-squares trend projected `horizon` months ahead (dashed)
 * with a residual-based uncertainty band. It's a naive extrapolation, not a
 * real forecast — listening isn't a stock — so treat it as for-fun.
 */
import { area, curveMonotoneX, line, scaleLinear } from 'd3';
import type { ForecastProps } from './viewProps';
import type { ForecastSeries } from '../../utils/analytics';

const CARD_W = 280;
const CARD_H = 150;
const M = { top: 22, right: 10, bottom: 18, left: 30 };

export function Forecast({ data: series }: ForecastProps) {
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
        Projecting the next 6 months — moving average + least-squares trend with
        an uncertainty band. A naive extrapolation, for fun.
      </p>
      <div className="flex flex-wrap gap-3">
        {series.map((s) => (
          <ForecastCard key={s.key} s={s} />
        ))}
      </div>
    </div>
  );
}

const TREND = {
  rising: { arrow: '↑', cls: 'text-emerald-400', stroke: '#34d399' },
  falling: { arrow: '↓', cls: 'text-red-400', stroke: '#f87171' },
  flat: { arrow: '→', cls: 'text-slate-400', stroke: '#94a3b8' },
} as const;

function ForecastCard({ s }: { s: ForecastSeries }) {
  const innerW = CARD_W - M.left - M.right;
  const innerH = CARD_H - M.top - M.bottom;
  const t = TREND[s.trend];

  const n = s.history.length;
  const allX = n + s.projection.length;
  const x = scaleLinear().domain([0, Math.max(1, allX - 1)]).range([0, innerW]);
  const yMax = Math.max(
    1,
    ...s.history.map((p) => p.value),
    ...s.projection.map((p) => p.hi),
  );
  const y = scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

  const histLine = line<{ value: number }>()
    .x((_, i) => x(i))
    .y((d) => y(d.value))
    .curve(curveMonotoneX);

  const smaPts = s.sma
    .map((v, i) => ({ v, i }))
    .filter((d): d is { v: number; i: number } => d.v != null);
  const smaLine = line<{ v: number; i: number }>()
    .x((d) => x(d.i))
    .y((d) => y(d.v))
    .curve(curveMonotoneX);

  // Projection path continues from the last history point.
  const last = { value: s.history[n - 1]?.value ?? 0 };
  const projLine = line<{ value: number }>()
    .x((_, i) => x(n - 1 + i))
    .y((d) => y(d.value))
    .curve(curveMonotoneX);
  const projData = [last, ...s.projection];

  const bandArea = area<{ lo: number; hi: number }>()
    .x((_, i) => x(n + i))
    .y0((d) => y(d.lo))
    .y1((d) => y(d.hi))
    .curve(curveMonotoneX);

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/60 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-sm text-slate-200" title={s.key}>
          {s.key}
        </span>
        <span className={`shrink-0 text-sm font-medium ${t.cls}`} title={`slope ${s.slope.toFixed(1)}/mo`}>
          {t.arrow} {s.trend}
        </span>
      </div>
      <svg width={CARD_W} height={CARD_H}>
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
          <line x1={x(n - 1)} x2={x(n - 1)} y2={innerH} stroke="#334155" strokeDasharray="2 2" />
          <path d={bandArea(s.projection) ?? ''} fill={t.stroke} fillOpacity={0.12} />
          <path d={smaLine(smaPts) ?? ''} fill="none" stroke="#64748b" strokeWidth={1} strokeOpacity={0.7} />
          <path d={histLine(s.history) ?? ''} fill="none" stroke="#cbd5e1" strokeWidth={1.5} />
          <path d={projLine(projData) ?? ''} fill="none" stroke={t.stroke} strokeWidth={1.5} strokeDasharray="4 3" />
        </g>
      </svg>
    </div>
  );
}

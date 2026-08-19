// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Cohort retention: how long your enthusiasms last.
 *
 * One row per discovery year, columns running rightward in months since each
 * artist's debut. Cell brightness is that month's share of the cohort's plays,
 * scaled to the row's own peak, so a small cohort's decay shape reads as clearly
 * as a big one's. The half-life on the right is the age by which half a cohort's
 * listening had already happened — one number for "how fast did they fade".
 *
 * Columns past a cohort's fully-observed age are left blank rather than drawn as
 * zero: a cohort from last year hasn't had the chance to reach month 30, and
 * painting that as empty would read as abandonment.
 *
 * This view reads your whole history and ignores the date-range filter, which
 * would otherwise chop the right-hand side off every row and bias every
 * half-life short.
 */
import { useMemo } from 'react';
import { interpolatorFor } from '../../utils/colors';
import type { RetentionProps } from './viewProps';

/** Empty-but-observed cell — distinct from the unpainted unobserved region. */
const ZERO_FILL = '#1e293b';

export function Retention({ data, size, palette }: RetentionProps) {
  const interp = useMemo(() => interpolatorFor(palette), [palette]);
  const { cohorts, maxAge } = data;

  if (!cohorts.length) {
    return (
      <div className="flex h-full w-full items-center justify-center text-slate-500">
        Not enough history yet to group artists into discovery cohorts.
      </div>
    );
  }

  const margin = { top: 28, right: 92, bottom: 24, left: 92 };
  const cols = maxAge + 1;
  const w = Math.max(0, size.width - margin.left - margin.right);
  const cellW = w / cols;
  const rowH = Math.max(
    16,
    Math.min(30, (size.height - margin.top - margin.bottom - 20) / cohorts.length),
  );
  const plotH = rowH * cohorts.length;
  const gap = cellW > 4 ? 1 : 0;

  // A tick per year of age; thin out when a decade of columns would crowd.
  const yearTicks: number[] = [];
  const step = cols > 84 ? 24 : 12;
  for (let m = 0; m <= maxAge; m += step) yearTicks.push(m);

  return (
    <div className="h-full w-full overflow-auto p-4">
      <p className="mb-2 text-xs text-slate-500">
        Rows = the year you discovered an artist · columns = months since that
        artist's debut · brightness = share of the cohort's plays (scaled per row)
        · blank = not observed yet. Reads all history, ignoring the date filter.
      </p>
      <svg
        width={size.width}
        height={Math.max(size.height - 40, plotH + margin.top + margin.bottom)}
      >
        <g transform={`translate(${margin.left},${margin.top})`}>
          {yearTicks.map((m) => (
            <text
              key={m}
              x={m * cellW + cellW / 2}
              y={-10}
              textAnchor="middle"
              className="fill-slate-500 text-[10px]"
            >
              {m === 0 ? 'debut' : `${m / 12}y`}
            </text>
          ))}

          {cohorts.map((c, i) => {
            const rowMax = Math.max(...c.shares.slice(0, maxAge + 1));
            return (
              <g key={c.year} transform={`translate(0,${i * rowH})`}>
                <text
                  x={-10}
                  y={rowH / 2}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-slate-400 text-[11px]"
                >
                  {c.year}
                  <title>{`${c.artists.toLocaleString()} artists discovered in ${c.year}, ${c.total.toLocaleString()} plays`}</title>
                </text>
                <text
                  x={-62}
                  y={rowH / 2}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-slate-600 text-[9px]"
                >
                  {c.artists.toLocaleString()}
                </text>

                {Array.from({ length: cols }, (_, age) => {
                  const observed = age <= c.fullyObservedMonths;
                  if (!observed) return null;
                  const share = c.shares[age] ?? 0;
                  const plays = c.months[age] ?? 0;
                  return (
                    <rect
                      key={age}
                      x={age * cellW + gap / 2}
                      y={gap / 2}
                      width={Math.max(0.5, cellW - gap)}
                      height={Math.max(2, rowH - gap)}
                      rx={cellW > 4 ? 1 : 0}
                      fill={
                        plays === 0
                          ? ZERO_FILL
                          : interp(0.15 + 0.85 * (rowMax ? share / rowMax : 0))
                      }
                    >
                      <title>
                        {`${c.year} cohort · month ${age} — ${plays.toLocaleString()} plays (${(share * 100).toFixed(1)}% of the cohort)`}
                      </title>
                    </rect>
                  );
                })}

                <text
                  x={w + 10}
                  y={rowH / 2}
                  dy="0.32em"
                  className="fill-slate-500 text-[10px]"
                >
                  {c.halfLifeMonths === 0
                    ? 'debut mo.'
                    : `${c.halfLifeMonths} mo`}
                  <title>{`Half of the ${c.year} cohort's plays had happened by month ${c.halfLifeMonths}`}</title>
                </text>
              </g>
            );
          })}

          <text
            x={w + 10}
            y={-10}
            className="fill-slate-600 text-[9px]"
          >
            half-life
          </text>
          <text x={-62} y={-10} textAnchor="end" className="fill-slate-600 text-[9px]">
            artists
          </text>
        </g>
      </svg>
    </div>
  );
}

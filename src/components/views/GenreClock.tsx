// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Genre clock: what you play at 3am.
 *
 * The Punchcard shows when you listen overall; this splits the same 24 hours by
 * genre, one row each. Rows are normalized to their own peak, so a small genre's
 * daily shape is as readable as a dominant one — cell brightness is "busy *for
 * this genre*", never "big genre".
 *
 * Rows are ordered by each genre's circular mean hour, which sorts the morning
 * listening to the top and the nocturnal listening to the bottom.
 */
import { useMemo } from 'react';
import { interpolatorFor } from '../../utils/colors';
import type { GenreClockProps } from './viewProps';

const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21];

export function GenreClock({ data, size, palette, hasGenres }: GenreClockProps) {
  const interp = useMemo(() => interpolatorFor(palette), [palette]);
  const { rows, total } = data;

  if (!hasGenres) {
    return (
      <Message text="Genres aren't tagged yet — let genre tagging finish in the panel (Group by → Genres) to see this." />
    );
  }
  if (!total || !rows.length) return <Message text="No scrobbles in range yet." />;

  const margin = { top: 26, right: 60, bottom: 20, left: 116 };
  const w = Math.max(0, size.width - margin.left - margin.right);
  const cellW = w / 24;
  const rowH = Math.max(
    14,
    Math.min(30, (size.height - margin.top - margin.bottom) / rows.length),
  );
  const plotH = rowH * rows.length;
  const gap = 2;

  const fmtHour = (h: number) => `${String(h).padStart(2, '0')}:00`;

  return (
    <div className="h-full w-full overflow-auto p-4">
      <svg
        width={size.width}
        height={Math.max(size.height, plotH + margin.top + margin.bottom)}
      >
        <g transform={`translate(${margin.left},${margin.top})`}>
          {HOUR_TICKS.map((hr) => (
            <text
              key={hr}
              x={hr * cellW + cellW / 2}
              y={-10}
              textAnchor="middle"
              className="fill-slate-500 text-[10px]"
            >
              {fmtHour(hr)}
            </text>
          ))}
          {rows.map((row, i) => {
            const rowMax = Math.max(1, ...row.counts);
            return (
              <g key={row.genre} transform={`translate(0,${i * rowH})`}>
                <text
                  x={-10}
                  y={rowH / 2}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-slate-400 text-[11px]"
                >
                  {row.genre.length > 18 ? `${row.genre.slice(0, 17)}…` : row.genre}
                  <title>{row.genre}</title>
                </text>
                {row.counts.map((c, hr) => (
                  <rect
                    key={hr}
                    x={hr * cellW + gap / 2}
                    y={gap / 2}
                    width={Math.max(0, cellW - gap)}
                    height={Math.max(0, rowH - gap)}
                    rx={2}
                    fill={c === 0 ? '#1e293b' : interp(0.15 + 0.85 * (c / rowMax))}
                    stroke={hr === row.peakHour ? '#e2e8f0' : undefined}
                    strokeOpacity={hr === row.peakHour ? 0.35 : undefined}
                  >
                    <title>
                      {`${row.genre} · ${fmtHour(hr)} — ${c.toLocaleString()} plays (${Math.round((c / rowMax) * 100)}% of its busiest hour)`}
                    </title>
                  </rect>
                ))}
                <text
                  x={w + 8}
                  y={rowH / 2}
                  dy="0.32em"
                  className="fill-slate-600 text-[9px]"
                >
                  {fmtHour(Math.round(row.meanHour) % 24)}
                  <title>{`${row.genre}: centre of gravity ${fmtHour(Math.round(row.meanHour) % 24)}, ${row.total.toLocaleString()} plays`}</title>
                </text>
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

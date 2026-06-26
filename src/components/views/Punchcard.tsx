// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Listening punchcard: a weekday × hour heatmap of when you listen (local time).
 * Cell color encodes play count for that (day, hour) slot.
 */
import { useMemo } from 'react';
import { interpolatorFor } from '../../utils/colors';
import type { PunchcardProps } from './viewProps';

// Display rows Monday-first; analytics indexes by getDay (0 = Sunday).
const ROW_DAYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function Punchcard({ data, size, palette }: PunchcardProps) {
  const { counts, max } = data;
  const interp = useMemo(() => interpolatorFor(palette), [palette]);

  if (data.total === 0) return <Empty />;

  const margin = { top: 24, right: 16, bottom: 16, left: 44 };
  const w = Math.max(0, size.width - margin.left - margin.right);
  const h = Math.max(0, size.height - margin.top - margin.bottom);
  const cellW = w / 24;
  const cellH = Math.min(h / 7, 48);
  const gap = 2;

  return (
    <div className="h-full w-full overflow-auto p-4">
      <svg width={size.width} height={Math.max(size.height, margin.top + cellH * 7 + margin.bottom)}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* hour axis */}
          {[0, 3, 6, 9, 12, 15, 18, 21].map((hr) => (
            <text
              key={hr}
              x={hr * cellW + cellW / 2}
              y={-8}
              textAnchor="middle"
              className="fill-slate-500 text-[10px]"
            >
              {hr}:00
            </text>
          ))}
          {ROW_DAYS.map((day, row) => (
            <g key={day} transform={`translate(0,${row * cellH})`}>
              <text x={-10} y={cellH / 2} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[11px]">
                {DAY_LABELS[row]}
              </text>
              {counts[day]!.map((c, hr) => (
                <rect
                  key={hr}
                  x={hr * cellW + gap / 2}
                  y={gap / 2}
                  width={Math.max(0, cellW - gap)}
                  height={Math.max(0, cellH - gap)}
                  rx={2}
                  fill={c === 0 ? '#1e293b' : interp(0.15 + 0.85 * (c / max))}
                >
                  <title>{`${DAY_LABELS[row]} ${hr}:00 — ${c.toLocaleString()} plays`}</title>
                </rect>
              ))}
            </g>
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

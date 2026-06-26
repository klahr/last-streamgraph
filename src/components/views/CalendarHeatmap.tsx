/**
 * GitHub-contributions-style calendar heatmap: one cell per day, columns are
 * weeks (Monday-anchored), rows are weekdays (Mon at top → Sun). Cell color
 * encodes that day's play count, using the viewer's local time (matching the
 * "YYYY-MM-DD" keys from {@link dailyCounts}).
 */
import { useMemo } from 'react';
import { interpolatorFor } from '../../utils/colors';
import type { CalendarProps } from './viewProps';

const pad2 = (n: number) => String(n).padStart(2, '0');

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const CELL = 13; // cell size in px
const GAP = 3; // gap between cells
const STEP = CELL + GAP; // column/row pitch
const DAY_MS = 24 * 60 * 60 * 1000;

/** Mon=0 … Sun=6 from a JS getDay() (0=Sun). */
const mondayRow = (jsDay: number) => (jsDay + 6) % 7;

interface Cell {
  col: number;
  row: number;
  key: string;
  count: number;
}

export function CalendarHeatmap({ data, size, palette }: CalendarProps) {
  const { byDay, max, firstMs, lastMs } = data;
  const interp = useMemo(() => interpolatorFor(palette), [palette]);

  const layout = useMemo(() => {
    if (!Number.isFinite(firstMs)) {
      return { cells: [] as Cell[], months: [] as { col: number; label: string }[], cols: 0 };
    }
    // Walk local days by calendar arithmetic (not fixed-ms steps) so DST
    // transitions (23h/25h days) can't shift a date into the wrong column or
    // drop a day. Columns are weeks (Monday-anchored) counted from the first.
    const cells: Cell[] = [];
    const months: { col: number; label: string }[] = [];
    let lastLabeledMonth = -1;
    let cols = 0;

    const first = new Date(firstMs);
    const firstMidnight = new Date(
      first.getFullYear(),
      first.getMonth(),
      first.getDate(),
    ).getTime();
    const firstColShift = mondayRow(first.getDay());

    let cursor = new Date(firstMidnight);
    while (cursor.getTime() <= lastMs) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      const day = cursor.getDate();
      const key = `${y}-${pad2(m + 1)}-${pad2(day)}`;
      // Days elapsed since the first day; rounds to absorb DST's ±1h drift.
      const offsetDays = Math.round(
        (cursor.getTime() - firstMidnight) / DAY_MS,
      );
      const col = Math.floor((offsetDays + firstColShift) / 7);
      const row = mondayRow(cursor.getDay());
      if (col + 1 > cols) cols = col + 1;

      // Month label at the first cell of each new month.
      if (m !== lastLabeledMonth) {
        const label = m === 0 ? `${MONTH_LABELS[m]} ${y}` : MONTH_LABELS[m]!;
        months.push({ col, label });
        lastLabeledMonth = m;
      }

      cells.push({ col, row, key, count: byDay.get(key) ?? 0 });
      cursor = new Date(y, m, day + 1);
    }

    return { cells, months, cols };
  }, [byDay, firstMs, lastMs]);

  if (!Number.isFinite(firstMs)) return <Empty />;

  const margin = { top: 24, right: 16, bottom: 8, left: 36 };
  const gridW = layout.cols * STEP;
  const gridH = 7 * STEP;
  const svgW = margin.left + gridW + margin.right;
  const svgH = margin.top + gridH + margin.bottom;

  return (
    <div className="h-full w-full overflow-auto p-4">
      <svg width={Math.max(svgW, size.width)} height={Math.max(svgH, 0)}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* month labels */}
          {layout.months.map((mo, i) => (
            <text
              key={`${mo.label}-${i}`}
              x={mo.col * STEP}
              y={-8}
              textAnchor="start"
              className="fill-slate-500 text-[10px]"
            >
              {mo.label}
            </text>
          ))}
          {/* weekday labels (Mon/Wed/Fri) */}
          {[0, 2, 4].map((row) => (
            <text
              key={row}
              x={-8}
              y={row * STEP + CELL / 2}
              dy="0.32em"
              textAnchor="end"
              className="fill-slate-400 text-[10px]"
            >
              {WEEKDAY_LABELS[row]}
            </text>
          ))}
          {/* day cells */}
          {layout.cells.map((c) => (
            <rect
              key={c.key}
              x={c.col * STEP}
              y={c.row * STEP}
              width={CELL}
              height={CELL}
              rx={2}
              fill={c.count === 0 ? '#1e293b' : interp(0.15 + 0.85 * (c.count / max))}
            >
              <title>{`${c.key} — ${c.count.toLocaleString()} plays`}</title>
            </rect>
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

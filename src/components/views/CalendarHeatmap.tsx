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
const YEAR_HEADER = 26; // room above each strip for the year + month labels
const YEAR_GAP = 12; // breathing space between year strips
const STRIP_CELL_H = 7 * STEP;
// Vertical pitch from one year strip's row 0 to the next's.
const STRIP_PITCH = STRIP_CELL_H + YEAR_GAP + YEAR_HEADER;

/** Mon=0 … Sun=6 from a JS getDay() (0=Sun). */
const mondayRow = (jsDay: number) => (jsDay + 6) % 7;

interface Cell {
  col: number;
  row: number;
  key: string;
  count: number;
}

interface YearBlock {
  year: number;
  cells: Cell[];
  months: { col: number; label: string }[];
  cols: number;
}

export function CalendarHeatmap({ data, size, palette }: CalendarProps) {
  const { byDay, max, firstMs, lastMs } = data;
  const interp = useMemo(() => interpolatorFor(palette), [palette]);

  const layout = useMemo(() => {
    if (!Number.isFinite(firstMs)) {
      return { years: [] as YearBlock[], totalCols: 0 };
    }
    // Walk local days by calendar arithmetic (not fixed-ms steps) so DST
    // transitions (23h/25h days) can't shift a date into the wrong column or
    // drop a day. Each calendar year becomes its own horizontal strip: week
    // columns reset at Jan 1 (Monday-anchored) and strips stack vertically.
    const years: YearBlock[] = [];
    let current: YearBlock | null = null;
    let lastLabeledMonth = -1;

    const first = new Date(firstMs);
    const firstMidnight = new Date(
      first.getFullYear(),
      first.getMonth(),
      first.getDate(),
    ).getTime();
    let cursor = new Date(firstMidnight);
    while (cursor.getTime() <= lastMs) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      const day = cursor.getDate();

      // A new strip starts at each calendar year; reset its column origin and
      // month-label tracker.
      if (!current || current.year !== y) {
        current = { year: y, cells: [], months: [], cols: 0 };
        years.push(current);
        lastLabeledMonth = -1;
      }

      const key = `${y}-${pad2(m + 1)}-${pad2(day)}`;
      // Week column *within this year*: count weeks from the Monday of the
      // week containing Jan 1, so Jan 1 lands at column 0 and a new year's
      // strip always starts flush at the left.
      const jan1Midnight = Date.UTC(y, 0, 1);
      const yearFirstColShift = mondayRow(new Date(jan1Midnight).getDay());
      const offsetDays = Math.round((cursor.getTime() - jan1Midnight) / DAY_MS);
      const col = Math.floor((offsetDays + yearFirstColShift) / 7);
      const row = mondayRow(cursor.getDay());
      if (col + 1 > current.cols) current.cols = col + 1;

      // Month label at the first cell of each new month within this strip.
      if (m !== lastLabeledMonth) {
        current.months.push({ col, label: MONTH_LABELS[m]! });
        lastLabeledMonth = m;
      }

      current.cells.push({ col, row, key, count: byDay.get(key) ?? 0 });
      cursor = new Date(y, m, day + 1);
    }

    const totalCols = years.reduce((mx, yr) => Math.max(mx, yr.cols), 0);
    return { years, totalCols };
  }, [byDay, firstMs, lastMs]);

  if (!Number.isFinite(firstMs)) return <Empty />;

  const margin = { top: 24, right: 16, bottom: 8, left: 36 };
  const gridW = layout.totalCols * STEP;
  const svgW = margin.left + gridW + margin.right;
  // First strip's row 0 sits at margin.top + YEAR_HEADER (room for its labels);
  // each subsequent strip adds STRIP_PITCH. Total height ends after the last
  // strip's cells + bottom margin.
  const svgH =
    margin.top +
    YEAR_HEADER +
    Math.max(0, layout.years.length - 1) * STRIP_PITCH +
    STRIP_CELL_H +
    margin.bottom;

  return (
    <div className="h-full w-full overflow-auto p-4">
      <svg width={Math.max(svgW, size.width)} height={Math.max(svgH, 0)}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* weekday labels (Mon/Wed/Fri), aligned to the first strip */}
          {[0, 2, 4].map((row) => (
            <text
              key={row}
              x={-8}
              y={YEAR_HEADER + row * STEP + CELL / 2}
              dy="0.32em"
              textAnchor="end"
              className="fill-slate-400 text-[10px]"
            >
              {WEEKDAY_LABELS[row]}
            </text>
          ))}
          {layout.years.map((yr, yi) => {
            const stripTop = YEAR_HEADER + yi * STRIP_PITCH;
            return (
              <g key={yr.year} transform={`translate(0,${stripTop})`}>
                {/* year label */}
                <text
                  x={0}
                  y={-20}
                  className="fill-slate-300 text-[11px] font-semibold"
                >
                  {yr.year}
                </text>
                {/* month labels */}
                {yr.months.map((mo, i) => (
                  <text
                    key={`${mo.label}-${i}`}
                    x={mo.col * STEP}
                    y={-7}
                    textAnchor="start"
                    className="fill-slate-500 text-[10px]"
                  >
                    {mo.label}
                  </text>
                ))}
                {/* day cells */}
                {yr.cells.map((c) => (
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
            );
          })}
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

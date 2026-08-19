// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Sessions: how long you stay.
 *
 * Consecutive plays separated by less than the chosen gap count as one sitting,
 * which turns a flat stream of scrobbles into blocks you can count and measure —
 * how many plays a typical sitting runs to, and when sittings tend to start.
 *
 * The gap is a control, not a constant, because a scrobble records only when a
 * track *started*: with no durations, a long track and a short break look
 * identical from here, so where a session ends is a judgement call.
 */
import { useMemo } from 'react';
import { interpolatorFor } from '../../utils/colors';
import type { SessionsProps } from './viewProps';

/**
 * Bar heights are computed in pixels, not percentages: the columns are
 * bottom-aligned flex items, so their height is content-based, and a percentage
 * height against an auto-height parent resolves to zero — every bar would
 * collapse. These budgets are the `h-40` (160px) panel minus the label rows and
 * the flex gaps above and below the bar.
 */
const BAR_AREA_LABELLED = 118; // value label above + axis label below
const BAR_AREA_PLAIN = 132; // axis label below only
/** Keep a non-zero count visible even when it rounds to nothing. */
const MIN_BAR = 2;

export function Sessions({ data, palette }: SessionsProps) {
  const interp = useMemo(() => interpolatorFor(palette), [palette]);

  if (!data.count) {
    return (
      <div className="flex h-full w-full items-center justify-center text-slate-500">
        No scrobbles in range yet.
      </div>
    );
  }

  const {
    gapMinutes,
    count,
    totalPlays,
    meanPlays,
    medianPlays,
    medianMinutes,
    lengthBins,
    startHours,
    longest,
  } = data;

  const binMax = Math.max(1, ...lengthBins.map((b) => b.count));
  const hourMax = Math.max(1, ...startHours);
  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  const fmtTime = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="h-full w-full overflow-auto p-4">
      <p className="mb-3 text-xs text-slate-500">
        A session ends after {gapMinutes} minutes of silence (adjustable in the
        panel). {totalPlays.toLocaleString()} plays in range fall into{' '}
        {count.toLocaleString()} sittings.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <Tile label="Sessions" value={count.toLocaleString()} />
        <Tile label="Median plays" value={medianPlays.toLocaleString()} />
        <Tile label="Mean plays" value={meanPlays.toFixed(1)} />
        <Tile
          label="Median length"
          value={
            medianMinutes >= 60
              ? `${Math.floor(medianMinutes / 60)}h ${Math.round(medianMinutes % 60)}m`
              : `${Math.round(medianMinutes)}m`
          }
        />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Session length distribution */}
        <div className="min-w-0 flex-1 rounded-md border border-slate-800 bg-slate-900/60 p-3">
          <h3 className="mb-3 text-xs font-medium text-slate-300">
            Session length (plays)
          </h3>
          <div className="flex h-40 items-end gap-1.5">
            {lengthBins.map((b, i) => (
              <div
                key={b.label}
                className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                title={`${b.count.toLocaleString()} sessions of ${b.label} play${b.label === '1' ? '' : 's'} (${Math.round((b.count / count) * 100)}%)`}
              >
                <span className="text-[9px] text-slate-500">
                  {b.count ? b.count.toLocaleString() : ''}
                </span>
                <div
                  className="w-full rounded-t"
                  style={{
                    height: b.count
                      ? `${Math.max(MIN_BAR, (b.count / binMax) * BAR_AREA_LABELLED)}px`
                      : 0,
                    backgroundColor: interp(
                      0.2 + (0.7 * i) / Math.max(1, lengthBins.length - 1),
                    ),
                  }}
                />
                <span className="text-[10px] text-slate-500">{b.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Session start hour */}
        <div className="min-w-0 flex-1 rounded-md border border-slate-800 bg-slate-900/60 p-3">
          <h3 className="mb-3 text-xs font-medium text-slate-300">
            When sessions start (your local time)
          </h3>
          <div className="flex h-40 items-end gap-0.5">
            {startHours.map((c, hr) => (
              <div
                key={hr}
                className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                title={`${String(hr).padStart(2, '0')}:00 — ${c.toLocaleString()} sessions started`}
              >
                <div
                  className="w-full rounded-t"
                  style={{
                    height: c
                      ? `${Math.max(MIN_BAR, (c / hourMax) * BAR_AREA_PLAIN)}px`
                      : 0,
                    backgroundColor: interp(0.2 + 0.7 * (c / hourMax)),
                  }}
                />
                <span className="text-[9px] text-slate-600">
                  {hr % 6 === 0 ? hr : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {longest && (
        <div className="mt-4 rounded-md border border-slate-800 bg-slate-900/60 p-3">
          <h3 className="mb-1 text-xs font-medium text-slate-300">Longest sitting</h3>
          <p className="text-sm text-slate-300">
            {longest.plays.toLocaleString()} plays on {fmtDate(longest.startMs)},{' '}
            {fmtTime(longest.startMs)} → {fmtTime(longest.endMs)}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Mostly {longest.topArtist} — {Math.round(longest.topShare * 100)}% of
            that session's plays.
          </p>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[7rem] flex-1 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2">
      <div className="text-lg text-slate-100">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

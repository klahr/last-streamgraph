// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Retention: how long your enthusiasms last.
 *
 * One row per discovery year. The bar is that year's **half-life** — the age by
 * which half the plays those artists would ever give you had already happened —
 * and the sparkline beside it is the decay shape the half-life summarises.
 *
 * This replaced a cohort heatmap, for a reason worth recording. That grid put
 * age on x and discovery year on y and encoded each cell's play share as
 * brightness, normalised *per row* — so its own legend had to tell you that
 * brightness compares along a row and never between rows. A grid's whole
 * affordance is comparing cells anywhere in it, so the chart spent its legend
 * forbidding the one thing it invited. Worse, plays always pile up near a
 * debut, so every row read as "bright left, dark right" and the actual signal —
 * that some years held on far longer than others — survived only as a subtle
 * difference in how far the glow reached. Meanwhile the half-life, the one
 * number that answers the question outright, sat in a text column at the edge.
 *
 * So the encodings swapped places. The half-life became the bar, on one shared
 * scale, which makes the comparison the heatmap couldn't: read the bars down
 * the page and the trend in your own taste is the shape of the column. The
 * decay shape stayed, as a per-row sparkline — no information lost, since it
 * was per-row normalised in the grid too, and now on a shared x axis so a
 * cohort that kept going is visibly longer than one that stopped.
 *
 * Reads the whole history and ignores the date-range filter, which would
 * otherwise chop the right-hand side off every row and bias every half-life
 * short.
 */
import { useMemo } from 'react';
import { interpolatorFor } from '../../utils/colors';
import type { RetentionCohort } from '../../utils/analytics';
import type { RetentionProps } from './viewProps';

/**
 * Decay sparkline canvas, in real pixels rather than a scaled logical unit.
 *
 * An earlier draft drew these into a wide viewBox squashed down with
 * `preserveAspectRatio="none"`, and kept the strokes readable through the
 * squash with `vector-effect: non-scaling-stroke`. That pairing is a
 * rasterisation trap: under a non-uniform transform the renderer recomputes
 * stroke geometry segment by segment, and eleven cohorts of a hundred-odd
 * points each was enough to wedge Chrome's compositor for minutes. Drawing 1:1
 * costs nothing and avoids the whole problem.
 */
const SPARK_W = 200;
const SPARK_H = 28;
/** Cumulative share a shared decay axis has to contain to be worth its width. */
const SPARK_COVERAGE = 0.9;

const months = (n: number) => (n === 1 ? '1 month' : `${n} months`);
/** "5y" when it lands on a year, "19 mo" when a short history cuts it short. */
const span = (m: number) => (m % 12 === 0 ? `${m / 12}y` : `${m} mo`);

export function Retention({ data, palette }: RetentionProps) {
  const interp = useMemo(() => interpolatorFor(palette), [palette]);
  const { cohorts, maxAge } = data;

  if (!cohorts.length) {
    return (
      <div className="flex h-full w-full items-center justify-center px-8 text-center text-slate-500">
        Not enough history yet to group artists into discovery cohorts.
      </div>
    );
  }

  const mature = cohorts.filter((c) => !c.halfLifeCensored);

  // The sparklines share an x axis, but sharing the *full* one is useless: a
  // decade-wide box spends nine tenths of itself on a flat tail and squeezes
  // every curve into the first sliver. Cut it where the most persistent cohort
  // has delivered SPARK_COVERAGE of its plays, rounded up to a whole year.
  const ninetieth = (c: RetentionCohort) => {
    let run = 0;
    for (let i = 0; i < c.shares.length; i++) {
      run += c.shares[i]!;
      if (run >= SPARK_COVERAGE) return i;
    }
    return c.shares.length - 1;
  };
  const sparkMonths = Math.min(
    maxAge,
    Math.ceil(Math.max(24, ...cohorts.map(ninetieth)) / 12) * 12,
  );
  // Bars share one scale, including the censored floors so a young cohort's
  // "at least this long" bar is drawn to the same ruler as everyone else's.
  const scaleMonths = Math.max(12, ...cohorts.map((c) => c.halfLifeMonths));
  // Round the axis up to a whole year so the gridlines land on anniversaries.
  const axisMax = Math.ceil(scaleMonths / 12) * 12;
  const ticks = Array.from({ length: axisMax / 12 + 1 }, (_, i) => i * 12);

  return (
    <div className="h-full w-full overflow-auto p-4">
      <p className="mb-1 text-xs text-slate-500">
        Group every artist by the year you first heard them, then ask how long
        that year's batch held your attention. The bar is the cohort's{' '}
        <span className="text-slate-400">half-life</span>: the age by which half
        of all the plays it ever gave you had already happened. Longer bar = that
        year's discoveries stayed with you longer.
      </p>
      <p className="mb-4 text-[11px] text-slate-600">
        Reads all history and ignores the date filter — a ranged slice would cut
        the tail off every cohort and make every one of these look shorter.
      </p>

      <Summary mature={mature} total={cohorts.length} />

      <div className="mt-4 sm:min-w-[620px]">
        <Header ticks={ticks} axisMax={axisMax} sparkMonths={sparkMonths} />
        {cohorts.map((c, i) => (
          <Row
            key={c.year}
            c={c}
            axisMax={axisMax}
            sparkMonths={sparkMonths}
            color={interp(0.25 + (0.6 * i) / Math.max(1, cohorts.length - 1))}
          />
        ))}
      </div>

      <p className="mt-4 max-w-3xl text-[11px] text-slate-600">
        A hollow bar marked <span className="text-slate-500">≥</span> is a cohort
        still too young to place: a half-life can never exceed the time you've
        watched, so a batch discovered eight months ago cannot report one longer
        than eight however loyal it turns out to be. Read those as floors that
        can only grow, and don't compare them with the solid bars — taking them
        at face value would show a tidy trend of ever-flightier taste that is
        purely an artifact of the calendar.
      </p>
    </div>
  );
}

/** The one sentence worth reading before the rows themselves. */
function Summary({
  mature,
  total,
}: {
  mature: RetentionCohort[];
  total: number;
}) {
  if (mature.length < 2) {
    return (
      <p className="rounded-md border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-400">
        {mature.length === 1
          ? `Only the ${mature[0]!.year} cohort is old enough to have a settled half-life — the rest are still unfolding.`
          : 'No cohort has been watched long enough yet for a settled half-life. The bars below are floors, not measurements.'}
      </p>
    );
  }

  const sorted = [...mature].sort((a, b) => a.halfLifeMonths - b.halfLifeMonths);
  const shortest = sorted[0]!;
  const longest = sorted[sorted.length - 1]!;
  // Oldest against newest among the settled cohorts — the only pair that can
  // speak to a direction without the censored rows faking one.
  const first = mature[0]!;
  const last = mature[mature.length - 1]!;
  const drift = last.halfLifeMonths - first.halfLifeMonths;
  const direction =
    Math.abs(drift) <= 1
      ? `about as long as ${first.year}'s did`
      : drift < 0
        ? `${months(Math.abs(drift))} shorter than ${first.year}'s`
        : `${months(drift)} longer than ${first.year}'s`;

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-300">
      <p>
        Your {last.year} discoveries half-faded in{' '}
        <span className="font-medium text-slate-100">
          {months(last.halfLifeMonths)}
        </span>{' '}
        — {direction}.
      </p>
      <p className="mt-1 text-slate-500">
        Across {mature.length} settled {mature.length === 1 ? 'cohort' : 'cohorts'}{' '}
        of {total}, {longest.year} held on longest ({months(longest.halfLifeMonths)}
        ) and {shortest.year} shortest ({months(shortest.halfLifeMonths)}).
      </p>
    </div>
  );
}

function Header({
  ticks,
  axisMax,
  sparkMonths,
}: {
  ticks: number[];
  axisMax: number;
  sparkMonths: number;
}) {
  return (
    <div className="flex items-end gap-3 pb-1 text-[9px] uppercase tracking-wide text-slate-600">
      <span className="w-10 shrink-0" />
      <div className="relative h-4 flex-1">
        {ticks.map((m) => (
          <span
            key={m}
            className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${(m / axisMax) * 100}%` }}
          >
            {m === 0 ? 'debut' : `${m / 12}y`}
          </span>
        ))}
      </div>
      <span
        className="hidden shrink-0 border-l border-transparent pl-3 text-right sm:inline"
        style={{ width: SPARK_W + 13 }}
      >
        decay · first {span(sparkMonths)}
      </span>
      <span className="hidden w-24 shrink-0 text-right sm:inline">artists</span>
    </div>
  );
}

function Row({
  c,
  axisMax,
  sparkMonths,
  color,
}: {
  c: RetentionCohort;
  axisMax: number;
  sparkMonths: number;
  color: string;
}) {
  const pct = Math.min(100, (c.halfLifeMonths / axisMax) * 100);
  const label = c.halfLifeCensored
    ? `≥${c.halfLifeMonths} mo`
    : c.halfLifeMonths === 0
      ? 'debut mo.'
      : `${c.halfLifeMonths} mo`;

  return (
    <div className="flex items-center gap-3 border-t border-slate-800/70 py-1.5">
      <span className="w-10 shrink-0 text-right text-[11px] text-slate-400">
        {c.year}
      </span>

      <div className="relative h-5 flex-1">
        {/* Anniversary gridlines, behind the bar. */}
        {Array.from({ length: axisMax / 12 + 1 }, (_, i) => (
          <span
            key={i}
            className="absolute inset-y-0 w-px bg-slate-800"
            style={{ left: `${((i * 12) / axisMax) * 100}%` }}
          />
        ))}
        <div
          className="absolute inset-y-0 left-0 rounded-sm"
          style={{
            width: `${Math.max(pct, 0.6)}%`,
            background: c.halfLifeCensored ? 'transparent' : color,
            border: c.halfLifeCensored ? `1px dashed ${color}` : undefined,
            opacity: c.halfLifeCensored ? 0.65 : 1,
          }}
          title={
            c.halfLifeCensored
              ? `The ${c.year} cohort has only been watched for ${c.fullyObservedMonths} months, so its half-life can't be placed yet — half its plays so far came by month ${c.halfLifeMonths}, and that figure can only grow. Not comparable with the solid bars.`
              : `Half of the ${c.year} cohort's plays had happened by month ${c.halfLifeMonths}.`
          }
        />
        <span
          className={`absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-1.5 text-[10px] ${
            c.halfLifeCensored ? 'italic text-slate-600' : 'text-slate-400'
          }`}
          style={{ left: `${Math.max(pct, 0.6)}%` }}
        >
          {label}
        </span>
      </div>

      {/* Its own axis, not a continuation of the bar's — hence the rule. */}
      <div className="hidden shrink-0 border-l border-slate-800 pl-3 sm:block">
        <Spark c={c} sparkMonths={sparkMonths} color={color} />
      </div>

      <span className="hidden w-24 shrink-0 text-right text-[10px] text-slate-600 sm:inline">
        {c.artists.toLocaleString()} · {c.total.toLocaleString()} plays
      </span>
    </div>
  );
}

/**
 * The cohort's decay shape: plays by age, as a share of everything it gave you.
 *
 * Height is scaled to this row's own peak — a big cohort and a small one then
 * show their shapes at the same size, which is the only way the shapes are
 * comparable at all. The x axis *is* shared across rows, so where a curve stops
 * is meaningful: a short trace is a cohort that hasn't been watched long, not
 * one that was abandoned, and the dashed rule marks exactly where observation
 * ran out.
 */
function Spark({
  c,
  sparkMonths,
  color,
}: {
  c: RetentionCohort;
  sparkMonths: number;
  color: string;
}) {
  const last = Math.min(c.fullyObservedMonths, sparkMonths);
  const series = c.shares.slice(0, last + 1);
  const peak = Math.max(...series, 1e-9);
  const x = (age: number) => (age / sparkMonths) * SPARK_W;
  const y = (v: number) => SPARK_H - (v / peak) * (SPARK_H - 2);
  const runsOut = c.fullyObservedMonths < sparkMonths;

  const tip =
    `${c.year}: ${c.total.toLocaleString()} plays from ${c.artists.toLocaleString()} artists. ` +
    (runsOut
      ? `Watched ${months(c.fullyObservedMonths)} past the last debut, so the trace stops there — the rest hasn't happened yet, it isn't a gap.`
      : `Watched well past this window.`);

  return (
    <svg width={SPARK_W} height={SPARK_H} className="shrink-0">
      <title>{tip}</title>
      <line x1={0} x2={SPARK_W} y1={SPARK_H - 0.5} y2={SPARK_H - 0.5} stroke="#1e293b" />
      {series.length > 1 ? (
        <>
          <path
            d={
              `M ${x(0)} ${SPARK_H} ` +
              series.map((v, age) => `L ${x(age)} ${y(v)}`).join(' ') +
              ` L ${x(series.length - 1)} ${SPARK_H} Z`
            }
            fill={color}
            fillOpacity={0.4}
          />
          <path
            d={series.map((v, age) => `${age ? 'L' : 'M'} ${x(age)} ${y(v)}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={1.25}
          />
        </>
      ) : (
        // A cohort whose newest artist debuted this month has exactly one
        // observed column. Drawn as a stub rather than left blank, so the row
        // reads as "nothing to see yet" instead of as a rendering failure.
        <rect x={0} y={2} width={3} height={SPARK_H - 2} fill={color} fillOpacity={0.5} />
      )}
      {runsOut && (
        <line
          x1={x(last)}
          x2={x(last)}
          y1={0}
          y2={SPARK_H}
          stroke="#64748b"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}
    </svg>
  );
}

// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Seasonal: which of your music belongs to a time of year.
 *
 * The subject here is the *ranking*, not the calendar. An earlier version led
 * with a coxcomb of raw plays per calendar month, which turned out to be mostly
 * an artifact: months differ in length, and an account that opened mid-year has
 * lived through some months one more time than others. Feed that chart
 * perfectly flat listening and it still draws a 1.3x summer bump. So the wedges
 * are gone and every number on this view is a *lift* — a month's share of one
 * artist's plays over that month's share of all your plays, which puts the
 * calendar on both sides of the division where it cancels.
 *
 * Each card is one artist/genre/album (per Group-by) with its twelve monthly
 * lifts drawn around a 1x baseline: up means over-represented that month, down
 * means under. Cards are ranked by concentration times per-year agreement, so a
 * single hot summer loses to a habit that comes back — see {@link seasonal}.
 */
import { useMemo, useState } from 'react';
import { hcl } from 'd3';
import { interpolatorFor } from '../../utils/colors';
import { SEASONS, SEASON_OF_MONTH } from '../../utils/analytics';
import type { SeasonalKey } from '../../utils/analytics';
import type { SeasonalProps } from './viewProps';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/** Logical canvas for a card's 12-bar lift chart; cards scale it via viewBox. */
const CHART_W = 300;
const CHART_H = 66;
/** Room under the bars for the month initials. */
const AXIS_H = 12;
/** Card bars run +-this many doublings from the 1x baseline: 0.25x .. 4x. */
const LOG_RANGE = 2;
/**
 * The year strip scales to its own range, but never magnifies less than this
 * much deviation — a year within 10% of flat should look flat, not dramatic.
 */
const FLAT_YEAR_FLOOR = Math.log2(1.1);
/** CIE lightness floor for palette-coloured text on the card background. */
const MIN_TEXT_LIGHTNESS = 62;
/**
 * Cap on unranked search hits drawn at once. The ranking itself is shown whole
 * — every entry in it is seasonal by construction, so there is nothing to spare
 * the reader — but a one-letter query can match a thousand library entries, and
 * rendering those is neither useful nor fast.
 */
const MAX_HITS = 60;
/**
 * Candidate play thresholds. Only the ones that would actually cut the current
 * list are offered, so a small library isn't handed a "1000+" button that
 * empties the view and a large one isn't stuck choosing between 0 and 25.
 */
const PLAY_STEPS = [25, 50, 100, 250, 500, 1000, 2500, 5000];

/** Where a lift sits on the bar chart: -1 (<=0.25x) .. 0 (1x) .. +1 (>=4x). */
const liftOffset = (lift: number) => {
  if (!(lift > 0)) return -1;
  return Math.max(-1, Math.min(1, Math.log2(lift) / LOG_RANGE));
};

/**
 * The same hue, floored to a lightness that survives being set in 12px on the
 * card background. Bars can use a palette colour raw — a dark viridis purple
 * still reads as a shape — but a headline in it does not, and January lands
 * exactly on that end of most palettes.
 */
const readable = (c: string) => {
  const col = hcl(c);
  if (!(col.l >= MIN_TEXT_LIGHTNESS)) col.l = MIN_TEXT_LIGHTNESS;
  return col.formatHex();
};

/** "Jun–Aug" for the three months centred on `m`. */
const windowLabel = (m: number) => `${SHORT[(m + 11) % 12]}–${SHORT[(m + 1) % 12]}`;

/** "1 artist" / "3 artists", so the footnotes read as prose at either count. */
const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function Seasonal({ data, palette, groupBy, hasGenres }: SeasonalProps) {
  const interp = useMemo(() => interpolatorFor(palette), [palette]);
  const { months, coverage, keys, others, unprofiled, oneYearOnly, notSeasonal, playFloor, total } =
    data;

  // Hooks run before the empty-state guards below, which return early.
  const [query, setQuery] = useState('');
  const [season, setSeason] = useState<number | null>(null);
  const [minPlays, setMinPlays] = useState(0);
  const reset = () => {
    setQuery('');
    setSeason(null);
    setMinPlays(0);
  };

  const q = query.trim().toLowerCase();

  const visible = useMemo(
    () =>
      keys.filter(
        (k) =>
          k.plays >= minPlays &&
          (season === null || SEASON_OF_MONTH[k.peakMonth] === season) &&
          (q === '' || k.key.toLowerCase().includes(q)),
      ),
    [keys, q, season, minPlays],
  );

  // Typing a name searches everything synced, not just what ranked. The chips
  // are for slicing the ranking; the search box is for "I know I have this,
  // where did it go" — and answering that with a blank result reads like the
  // sync dropped the artist rather than the metric declining to rank it.
  const hits = useMemo(
    () => (q === '' ? [] : others.filter((k) => k.key.toLowerCase().includes(q))),
    [others, q],
  );

  // Only genre grouping depends on the rate-limited tag fetch; artists and
  // albums are in the scrobbles already and draw immediately.
  if (groupBy === 'genre' && !hasGenres) {
    return (
      <Message text="Genres are still being tagged — this fills in as they arrive, or switch Group-by to Artists or Albums." />
    );
  }
  if (total === 0) return <Message text="No scrobbles in range yet." />;

  const [one, many] =
    groupBy === 'genre'
      ? (['genre', 'genres'] as const)
      : groupBy === 'album'
        ? (['album', 'albums'] as const)
        : (['artist', 'artists'] as const);

  return (
    <div className="h-full w-full overflow-auto p-4">
      <p className="mb-3 text-xs text-slate-500">
        Which {many} belong to a time of year. Every bar is a{' '}
        <span className="text-slate-400">ratio, not a count</span>: that month's
        share of the {one}'s plays over the same month's share of{' '}
        <em>all</em> your plays. Above the line means played more than usual
        that month — and because your own listening is the denominator, a short
        February and a mid-year account start cancel out instead of showing up
        as a season. Ranked by how tightly the year clusters and how many
        separate years agree, so one hot summer doesn't outrank a habit.
      </p>

      <YearStrip months={months} coverage={coverage} interp={interp} total={total} />

      {keys.length > 0 && (
        <FilterBar
          keys={keys}
          many={many}
          query={query}
          onQuery={setQuery}
          season={season}
          onSeason={setSeason}
          minPlays={minPlays}
          onMinPlays={setMinPlays}
          matched={visible.length}
          hits={hits.length}
          ofTotal={keys.length}
        />
      )}

      {keys.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          {notSeasonal > 0
            ? `Nothing here is seasonal. ${plural(notSeasonal, one, many)} cleared the ${playFloor.toLocaleString()}-play bar across enough years, but none peaks a quarter above its usual with two years agreeing on when. Your listening doesn't track the calendar — which is itself an answer.`
            : oneYearOnly > 0
              ? `Nothing recurs yet. ${plural(oneYearOnly, one, many)} had the plays but turned up in only one calendar year, and a season needs the same name coming back the next year.`
              : `No ${many} reach the ${playFloor.toLocaleString()} plays needed to read a yearly shape from. Try a wider range.`}
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-3">
            {visible.map((k) => (
              <div key={k.key} className="w-full sm:w-[340px]">
                <Card k={k} interp={interp} />
              </div>
            ))}
            {visible.length === 0 && hits.length === 0 && (
              <p className="text-sm text-slate-500">
                Nothing matches{q ? ` “${query.trim()}”` : ' this filter'}
                {q && unprofiled > 0
                  ? `, and ${unprofiled.toLocaleString()} ${many} are played too little to look up.`
                  : '.'}{' '}
                <button
                  onClick={reset}
                  className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
                >
                  Clear it
                </button>{' '}
                to see all {keys.length}.
              </p>
            )}
          </div>

          {hits.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-[11px] text-slate-500">
                {visible.length > 0 ? 'Also in your library' : 'In your library'}, but
                not seasonal enough to rank — showing{' '}
                {Math.min(hits.length, MAX_HITS).toLocaleString()}
                {hits.length > MAX_HITS && ` of ${hits.length.toLocaleString()}`}:
              </p>
              <div className="flex flex-wrap gap-3">
                {hits.slice(0, MAX_HITS).map((k) => (
                  <div key={k.key} className="w-full sm:w-[340px]">
                    <Card k={k} interp={interp} muted playFloor={playFloor} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {keys.length > 0 && (
        <p className="mt-3 text-[11px] text-slate-600">
          {`Needs ${playFloor.toLocaleString()} plays to qualify — half a percent of your listening, so a name played a handful of times a year can't top the list on shape alone.`}
          {(oneYearOnly > 0 || notSeasonal > 0) && ' Of those that cleared it, '}
          {oneYearOnly > 0 &&
            `${plural(oneYearOnly, one, many)} appeared in only one calendar year`}
          {oneYearOnly > 0 && notSeasonal > 0 && ', and '}
          {notSeasonal > 0 &&
            `${plural(notSeasonal, one, many)} had a year too flat, or years that disagree on when it peaks`}
          {(oneYearOnly > 0 || notSeasonal > 0) && '.'}
        </p>
      )}
    </div>
  );
}

/**
 * Name / season / play-count filters over the ranked list.
 *
 * The ranking answers "what is seasonal for me", but a long answer is hard to
 * read, and its tail is where thin keys sit — a name you played twenty times
 * that happened to land in one part of the year is technically ranked and
 * practically noise. These cut it down along the three axes people actually
 * ask about: a name they have in mind, a season they want the music for, and
 * how much a key has to matter before it counts.
 *
 * Filtering is view-local and deliberately not part of {@link VizConfig}: it is
 * a way of reading this list, not a property of the data, and a shared link
 * should show the reader the whole ranking rather than the sharer's search box.
 */
function FilterBar({
  keys,
  many,
  query,
  onQuery,
  season,
  onSeason,
  minPlays,
  onMinPlays,
  matched,
  hits,
  ofTotal,
}: {
  keys: SeasonalKey[];
  many: string;
  query: string;
  onQuery: (v: string) => void;
  season: number | null;
  onSeason: (v: number | null) => void;
  minPlays: number;
  onMinPlays: (v: number) => void;
  matched: number;
  hits: number;
  ofTotal: number;
}) {
  // Only seasons that something actually peaks in, and only thresholds that
  // would actually cut the list: a button that can only ever return nothing is
  // worse than no button.
  const present = new Set(keys.map((k) => SEASON_OF_MONTH[k.peakMonth]!));
  const maxPlays = Math.max(...keys.map((k) => k.plays));
  const steps = PLAY_STEPS.filter((v) => v < maxPlays).slice(-3);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={`Search all ${many}…`}
        aria-label={`Search all ${many}`}
        className="w-40 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-200 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none"
      />

      <Chips
        label="Peaks in"
        options={[
          { value: null, label: 'Any' },
          ...SEASONS.map((sn, i) => ({ value: i, label: sn.name })).filter((o) =>
            present.has(o.value),
          ),
        ]}
        value={season}
        onChange={onSeason}
      />

      {steps.length > 0 && (
        <Chips
          label="At least"
          options={[
            { value: 0, label: 'Any' },
            ...steps.map((v) => ({ value: v, label: `${v.toLocaleString()}+` })),
          ]}
          value={minPlays}
          onChange={onMinPlays}
        />
      )}

      <span className="text-slate-500">
        {matched === ofTotal
          ? `${ofTotal.toLocaleString()} ranked`
          : `${matched.toLocaleString()} of ${ofTotal.toLocaleString()} ranked`}
        {hits > 0 && ` · ${hits.toLocaleString()} more in your library`}
      </span>
    </div>
  );
}

/** A labelled row of mutually exclusive chips, in the app's segmented style. */
function Chips<T extends string | number | null>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-slate-500">{label}</span>
      <div className="flex overflow-hidden rounded border border-slate-700">
        {options.map((opt) => (
          <button
            key={String(opt.value)}
            onClick={() => onChange(opt.value)}
            className={`px-2 py-1 transition ${
              value === opt.value
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Your own year: how much busier or quieter each calendar month is than your
 * average day. This is the honest version of the month coxcomb this view used
 * to lead with — dividing by the days actually observed in each month removes
 * both the short-February dip and the bulge a month gets from having come
 * round one extra time.
 *
 * Drawn against a baseline rather than from zero, and on the same log scale as
 * the cards, because the question is deviation. From zero, a flat year renders
 * as twelve identical full-height bars and looks like an ornament; here it
 * renders flat, which is what it means. This rate is also the exact denominator
 * every card's lift divides by, so it belongs at the top of the view.
 *
 * Laid out in CSS rather than SVG, unlike the fixed-width card charts: this one
 * spans the pane, and an SVG wide enough to stretch to it would either
 * letterbox at its natural size or, with preserveAspectRatio="none", smear the
 * month labels sideways.
 */
function YearStrip({
  months,
  coverage,
  interp,
  total,
}: {
  months: number[];
  coverage: number[];
  interp: (t: number) => string;
  total: number;
}) {
  const days = coverage.reduce((a, b) => a + b, 0);
  const mean = days > 0 ? total / days : 0;
  const rates = months.map((v, m) => (coverage[m]! > 0 ? v / coverage[m]! : 0));
  const ratios = rates.map((r) => (mean > 0 ? r / mean : 0));
  const live = ratios.filter((r) => r > 0);
  const spread = live.length ? Math.max(...live) / Math.min(...live) : 1;

  // Unlike the cards, this strip sets its own vertical scale. A year's months
  // typically sit within ±40% of each other while a seasonal artist swings by
  // 170%, so the cards' fixed ±4× axis would render every year as a flat line.
  // The floor is what stops the reverse mistake: without it, dividing by a tiny
  // peak would inflate a couple of percent of noise into a dramatic season.
  const devs = ratios.map((r, m) =>
    coverage[m]! === 0 ? null : r > 0 ? Math.log2(r) : -Infinity,
  );
  const peak = Math.max(
    FLAT_YEAR_FLOOR,
    ...devs.filter((d): d is number => d !== null && Number.isFinite(d)).map(Math.abs),
  );

  const PLOT = 44;
  const mid = PLOT / 2;

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="shrink-0 text-xs font-medium text-slate-300">Your year</span>
        <span className="text-right text-[10px] text-slate-500">
          plays/day against your {mean.toFixed(1)}/day average ·{' '}
          {spread < 1.1
            ? 'a flat year'
            : `busiest month ${spread.toFixed(1)}× the quietest`}
        </span>
      </div>
      <div className="relative" style={{ height: PLOT }}>
        <div className="flex h-full gap-[2px]">
          {devs.map((dev, m) => {
            const t = dev === null ? 0 : Math.max(-1, Math.min(1, dev / peak));
            const h = Math.abs(t) * mid;
            const up = t >= 0;
            return (
              <div
                key={m}
                className="relative flex-1"
                title={
                  coverage[m]! === 0
                    ? `${MONTHS[m]} — not in the selected range`
                    : `${MONTHS[m]} — ${months[m]!.toLocaleString()} plays over ` +
                      `${coverage[m]!.toLocaleString()} days = ${rates[m]!.toFixed(1)}/day, ` +
                      `${ratios[m]!.toFixed(2)}× your average`
                }
              >
                {dev !== null && (
                  <div
                    className="absolute inset-x-0 rounded-[1px]"
                    style={{
                      top: up ? mid - h : mid,
                      height: Math.max(h, 1),
                      background: up ? interp(m / 11) : '#475569',
                      opacity: up ? 1 : 0.7,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-500/80"
          style={{ top: mid }}
        />
      </div>
      <div className="mt-1 flex gap-[2px]">
        {INITIALS.map((c, m) => (
          <div key={m} className="flex-1 text-center text-[9px] text-slate-500">
            {c}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The 1x line, drawn over the bars so it stays readable through a tall one. */
function Baseline({ y }: { y: number }) {
  return (
    <line
      x1={0}
      x2={CHART_W}
      y1={y}
      y2={y}
      stroke="#64748b"
      strokeWidth={1}
      strokeDasharray="3 3"
      opacity={0.8}
    />
  );
}

/**
 * `muted` marks a card reached by search rather than by ranking. It still draws
 * the full profile — that profile is the answer to "why isn't this here?" — but
 * says plainly which test the key failed, so nobody reads its bars as a season
 * the metric endorsed.
 */
function Card({
  k,
  interp,
  muted = false,
  playFloor = 0,
}: {
  k: SeasonalKey;
  interp: (t: number) => string;
  muted?: boolean;
  playFloor?: number;
}) {
  const accent = readable(interp(k.peakMonth / 11));

  return (
    <div
      className={`rounded-md border p-2 ${
        muted
          ? 'border-dashed border-slate-800 bg-slate-900/30'
          : 'border-slate-800 bg-slate-900/60'
      }`}
    >
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span
          className={`truncate text-sm ${muted ? 'text-slate-400' : 'text-slate-200'}`}
          title={k.key}
        >
          {k.key}
        </span>
        <span
          className="shrink-0 text-xs font-medium"
          style={{ color: muted ? '#64748b' : accent }}
        >
          {k.peakLift.toFixed(1)}× {windowLabel(k.peakMonth)}
        </span>
      </div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-slate-500">
          {k.plays.toLocaleString()} plays · peaks in {MONTHS[k.peakMonth]}
        </span>
        {muted ? (
          <span className="shrink-0 text-[10px] italic text-slate-600">
            {whyNot(k, playFloor)}
          </span>
        ) : (
          <span
            className="shrink-0 text-[10px] text-slate-600"
            title={
              `${k.agreeingYears} of ${k.activeYears} calendar years peak within two ` +
              `months of ${MONTHS[k.peakMonth]}. Concentration ${(k.strength * 100).toFixed(0)}%.`
            }
          >
            {k.agreeingYears}/{k.activeYears} years agree
          </span>
        )}
      </div>
      <LiftChart k={k} interp={interp} />
    </div>
  );
}

/** The one-phrase reason a searched key isn't in the ranking. */
function whyNot(k: SeasonalKey, playFloor: number): string {
  switch (k.reason) {
    case 'thin':
      return `under ${playFloor.toLocaleString()} plays`;
    case 'one-year':
      return k.activeYears === 0 ? 'one burst only' : 'only one year';
    case 'flat':
      return k.agreeingYears < 2 ? 'years disagree' : 'too flat';
    default:
      return '';
  }
}

/**
 * Twelve monthly lifts around a 1x baseline, on a log scale so that 2x up and
 * 0.5x down are the same size — an artist you play twice as much in July as
 * usual and one you play half as much are equally far from ordinary, and a
 * linear axis would flatten the second into nothing.
 */
function LiftChart({ k, interp }: { k: SeasonalKey; interp: (t: number) => string }) {
  const plot = CHART_H - AXIS_H;
  const mid = plot / 2;
  const w = CHART_W / 12;

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} width="100%" height={CHART_H}>
      {k.lift.map((lift, m) => {
        const t = liftOffset(lift);
        const h = Math.abs(t) * mid;
        const up = t >= 0;
        return (
          <g key={m}>
            <rect
              x={m * w + 1}
              y={up ? mid - h : mid}
              width={w - 2}
              height={Math.max(h, 0.8)}
              fill={up ? interp(m / 11) : '#475569'}
              fillOpacity={up ? 1 : 0.7}
              rx={1}
            >
              <title>
                {`${MONTHS[m]} — ${k.byMonth[m]!.toLocaleString()} plays, ` +
                  (lift > 0 ? `${lift.toFixed(2)}× usual` : 'never')}
              </title>
            </rect>
            <text
              x={m * w + w / 2}
              y={CHART_H - 2}
              textAnchor="middle"
              className="fill-slate-600 text-[8px]"
            >
              {INITIALS[m]}
            </text>
          </g>
        );
      })}
      <Baseline y={mid} />
    </svg>
  );
}

function Message({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-8 text-center text-slate-500">
      {text}
    </div>
  );
}

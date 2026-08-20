// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Seasonal radial chart ("coxcomb" / polar bar): 12 wedges, one per month,
 * arranged clockwise from the top (Jan at 12 o'clock). Each wedge's outer
 * radius encodes that month's total play count (summed across years), using a
 * sqrt scale so the *area* of each wedge reads proportionally to its value.
 *
 * Around the wedges sits a ring of four season arcs, each labelled with that
 * season's *signature* — the artist, genre or album (per Group-by) that takes a
 * bigger share of the season than it takes of your listening overall. Ranking
 * seasons by raw play count would just name your all-time favourite four times;
 * see {@link seasonal} for the lift metric this leans on. The band's width is
 * deliberately uniform — season volume is already in the wedges it encloses.
 */
import { useMemo } from 'react';
import { arc } from 'd3';
import { interpolatorFor } from '../../utils/colors';
import { SEASONS } from '../../utils/analytics';
import type { SeasonalSignature } from '../../utils/analytics';
import type { SeasonalProps } from './viewProps';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Band geometry, outward from the wedge tips. */
const BAND_GAP = 26;
const BAND_WIDTH = 14;
const LABEL_GAP = 9;
/** Horizontal room reserved for the two side labels, so names aren't slivers. */
const SIDE_ROOM = 112;
/** Vertical room for a three-line label stacked above or below the band. */
const STACK_ROOM = 3 * 13 + 6;
/** Below this the band would crowd out the coxcomb, so it isn't drawn at all. */
const MIN_RING_RADIUS = 70;

/** Rough advance width per character, as a fraction of font size. */
const CHAR_W = 0.58;

/** Fit to the room actually available; the full text stays in the tooltip. */
const truncate = (s: string, px: number, size: number) => {
  const max = Math.floor(px / (size * CHAR_W));
  if (max < 2) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const pct = (share: number) => `${Math.round(share * 100)}%`;

/** "2.4× usual" for a genuine signature, plain honesty when it's just the top key. */
const liftLabel = (sig: SeasonalSignature) =>
  sig.distinctive ? `${sig.lift.toFixed(1)}× usual` : 'most played';

export function SeasonalRadial({
  data,
  size,
  palette,
  groupBy,
  hasGenres,
}: SeasonalProps) {
  const interp = useMemo(() => interpolatorFor(palette), [palette]);
  const { months: counts, monthSignatures, seasons } = data;

  // Only genre grouping depends on the rate-limited tag fetch; artists and
  // albums are in the scrobbles already and draw immediately.
  if (groupBy === 'genre' && !hasGenres) {
    return <Message text="Genres are still being tagged — this fills in as they arrive, or switch Group-by to Artists or Albums." />;
  }

  const max = Math.max(0, ...counts);
  if (max === 0) return <Message text="No scrobbles in range yet." />;

  const innerR = 26;
  const cx = size.width / 2;
  const cy = size.height / 2;

  // Radii, inside out: hub, month wedges, month labels, season band, season
  // labels. The band's labels sit *outside* the circle, and there are only two
  // of each — so the room they need is taken off the width and the height
  // separately, rather than from the smaller of the two. Squeezing the coxcomb
  // a little beats a signature name clipped by the pane edge.
  const ringR = Math.min(
    cx - SIDE_ROOM - LABEL_GAP - BAND_GAP - BAND_WIDTH,
    cy - STACK_ROOM - LABEL_GAP - BAND_GAP - BAND_WIDTH,
  );
  // A very small pane (or a narrow share poster) drops the band entirely and
  // gives the space back to the wedges; the coxcomb alone still reads.
  const showSeasons = ringR >= MIN_RING_RADIUS;
  const maxR = showSeasons
    ? ringR
    : Math.max(innerR + 1, Math.min(cx, cy) - 40);
  const monthLabelR = maxR + 13;
  const bandInner = maxR + BAND_GAP;
  const bandOuter = bandInner + BAND_WIDTH;

  // Equal angular slices, like d3.scaleBand: 2π/12 per month, clockwise from top.
  const slice = (2 * Math.PI) / 12;

  // sqrt scaling: area ∝ value. r = sqrt(lerp of value²-ish) mapped to [innerR, maxR].
  const radiusFor = (v: number) => innerR + (maxR - innerR) * Math.sqrt(v / max);

  // Color by month index across the palette (t = i/11) — gives a smooth
  // seasonal gradient that reads as a calendar cycle, which suits this view
  // better than magnitude-based shading.
  const arcGen = arc<{ inner: number; outer: number; start: number; end: number }>()
    .innerRadius((d) => d.inner)
    .outerRadius((d) => d.outer)
    .startAngle((d) => d.start)
    .endAngle((d) => d.end)
    .padAngle(0.01)
    .cornerRadius(2);

  return (
    <div className="h-full w-full overflow-hidden p-4">
      <svg width={size.width} height={size.height}>
        <g transform={`translate(${cx},${cy})`}>
          {counts.map((v, i) => {
            const start = i * slice;
            const end = start + slice;
            const mid = start + slice / 2;
            const outer = radiusFor(v);
            const d = arcGen({ inner: innerR, outer, start, end }) ?? '';
            // SVG angle 0 points up (-y); rotate by mid clockwise for the label.
            const lx = Math.sin(mid) * monthLabelR;
            const ly = -Math.cos(mid) * monthLabelR;
            const sig = monthSignatures[i];
            return (
              <g key={i}>
                <path d={d} fill={interp(i / 11)} stroke="#0f172a" strokeWidth={1}>
                  <title>
                    {`${MONTHS[i]} — ${v.toLocaleString()} plays` +
                      (sig
                        ? `\n${sig.key} — ${pct(sig.share)} of the month, ${liftLabel(sig)}`
                        : '')}
                  </title>
                </path>
                <text
                  x={lx}
                  y={ly}
                  dy="0.32em"
                  textAnchor="middle"
                  className="fill-slate-400 text-[11px]"
                >
                  {MONTH_LABELS[i]}
                </text>
              </g>
            );
          })}

          {showSeasons &&
            seasons.map(({ plays, signature }, i) => {
              const season = SEASONS[i]!;
              // The arc starts at its first month and spans three; winter's start
              // index (December) simply runs past 12 o'clock, which d3 handles.
              const start = season.monthIndices[0]! * slice;
              const end = start + 3 * slice;
              const d =
                arcGen({ inner: bandInner, outer: bandOuter, start, end }) ?? '';
              return (
                <g key={`season-${i}`}>
                  <path
                    d={d}
                    fill={interp(season.monthIndices[1]! / 11)}
                    fillOpacity={plays ? 0.55 : 0.15}
                    stroke="#0f172a"
                    strokeWidth={1}
                  >
                    <title>
                      {`${season.name} (${season.months}) — ${plays.toLocaleString()} plays` +
                        (signature
                          ? `\n${signature.key} — ${signature.plays.toLocaleString()} plays, ` +
                            `${pct(signature.share)} of the season, ${liftLabel(signature)}`
                          : '')}
                    </title>
                  </path>
                  <SeasonLabel
                    mid={start + 1.5 * slice}
                    radius={bandOuter}
                    halfWidth={cx}
                    heading={`${season.name} · ${season.months}`}
                    plays={plays}
                    signature={signature}
                  />
                </g>
              );
            })}
        </g>
      </svg>
    </div>
  );
}

/**
 * The two-or-three line block naming a season's signature, placed just outside
 * its arc. Anchoring follows the arc's midpoint: side labels run outward from
 * the ring and are centred vertically, top/bottom labels stack away from it.
 */
function SeasonLabel({
  mid,
  radius,
  halfWidth,
  heading,
  plays,
  signature,
}: {
  mid: number;
  radius: number;
  /** Half the pane width — the label's own room, measured from the centre. */
  halfWidth: number;
  heading: string;
  plays: number;
  signature: SeasonalSignature | null;
}) {
  const lines: { text: string; size: number; className: string }[] = [
    {
      text: heading,
      size: 10,
      className: 'fill-slate-400 text-[10px] uppercase tracking-wide',
    },
    signature
      ? {
          text: signature.key,
          size: 12,
          className: 'fill-slate-100 text-[12px] font-semibold',
        }
      : {
          // In-app a season with plays always has a signature; a link shared
          // before the ring existed carries the months only (see shareSnapshot).
          text: plays ? 'no signature in link' : 'no plays',
          size: 11,
          className: 'fill-slate-500 text-[11px]',
        },
  ];
  if (signature) {
    lines.push({
      text: liftLabel(signature),
      size: 10,
      className: 'fill-slate-400 text-[10px]',
    });
  }

  const sin = Math.sin(mid);
  const cos = Math.cos(mid);
  const x = sin * radius;
  const y = -cos * radius;
  const lh = 13;
  // A near-vertical midpoint reads better centred above/below the ring than
  // pushed out sideways, where the text would sit over the wedges.
  const vertical = Math.abs(sin) < 0.4;
  const anchor = vertical ? 'middle' : sin > 0 ? 'start' : 'end';
  const tx = vertical ? x : x + (sin > 0 ? LABEL_GAP : -LABEL_GAP);

  // Room between the anchor and the pane edge the text runs toward. A centred
  // label runs both ways, so it gets twice the nearer side.
  const room = vertical
    ? 2 * (halfWidth - Math.abs(tx)) - 8
    : halfWidth - Math.abs(tx) - 4;

  const positions = lines.map((_, i) => {
    if (vertical) {
      return cos > 0
        ? y - LABEL_GAP - (lines.length - 1 - i) * lh // above the ring
        : y + LABEL_GAP + 9 + i * lh; // below the ring
    }
    return y + (i - (lines.length - 1) / 2) * lh;
  });

  return (
    <g>
      <title>{signature ? `${heading} — ${signature.key}` : heading}</title>
      {lines.map((line, i) => (
        <text
          key={i}
          x={tx}
          y={positions[i]}
          dy="0.32em"
          textAnchor={anchor}
          className={line.className}
        >
          {truncate(line.text, room, line.size)}
        </text>
      ))}
    </g>
  );
}

function Message({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-8 text-center text-slate-500">
      {text}
    </div>
  );
}

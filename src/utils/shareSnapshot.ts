// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Static, self-contained snapshots of a single view, encoded into a URL.
 *
 * There is no backend to store anything in (the deploy is `serve dist`), so a
 * shared chart has to travel inside its own link. Two consequences shape this
 * module:
 *
 * - **Only the view's own payload travels.** {@link AnalyticsViewResult} is
 *   already the minimal projection each view needs to draw — top-12 genres, a
 *   cohort grid, twelve forecast series — so a snapshot carries that and never
 *   the underlying scrobbles. There is no way to reconstruct a listening
 *   history from one.
 * - **It rides in the fragment**, after the `#`, which browsers never send to
 *   the server. Someone else's self-hosted instance can serve a snapshot link
 *   without the snapshot appearing in their access logs. A query string would.
 *
 * The username is deliberately *not* included. The existing `/username` share
 * link means "go fetch this person's whole history live"; a snapshot must mean
 * only "here is this one chart", so it is served from {@link SHARE_PATH} with
 * no identity attached beyond an optional free-text label the sharer types.
 */
import type { GroupBy, PaletteId, View } from '../types';
import type { AnalyticsViewResult } from '../hooks/useAnalytics';
import { SEASONS } from './analytics';
import type { DailyCounts, RetentionData, SeasonalData } from './analytics';

/** Views that can travel in a link — everything the analytics worker computes. */
export type SnapshotView = AnalyticsViewResult['view'];

/**
 * Bumped whenever a payload shape changes in a way older links can't satisfy.
 * Without this, adding one field to a cohort or a forecast series turns every
 * link ever shared into a render crash that looks like link corruption.
 */
export const SNAPSHOT_VERSION = 1;

export interface Snapshot {
  view: SnapshotView;
  /** The view's own analytics payload — see {@link AnalyticsViewResult}. */
  payload: unknown;
  palette: PaletteId;
  /** Display params some views need beyond the payload itself. */
  groupBy: GroupBy;
  topN: number;
  hasGenres: boolean;
  /** Range the snapshot was taken over, for the caption. */
  from: number;
  to: number;
  /** Optional title the sharer typed. Empty when they didn't. */
  label: string;
  /** When the snapshot was taken, so the poster can say it isn't live. */
  made: number;
}

/**
 * Cap on the encoded fragment. Browsers themselves swallow far more, but links
 * get pasted into chat clients and mail, which truncate silently — a link that
 * *nearly* fits is worse than one that openly doesn't, so oversized snapshots
 * are refused here and offered as an image instead.
 */
export const MAX_FRAGMENT_CHARS = 8000;

/** Significant digits kept on non-integer numbers. */
const SIG_DIGITS = 5;

/* ----------------------------- payload trims ----------------------------- */

/**
 * Per-view size trims. Anything derivable from what's already in the payload
 * is dropped on the way out and rebuilt on the way in — it costs a line here
 * and saves a large fraction of the link.
 */
const TRIMS: Partial<
  Record<SnapshotView, { pack: (p: never) => unknown; unpack: (p: never) => unknown }>
> = {
  // `byDay` is a Map, and JSON.stringify turns a Map into `{}` — the calendar
  // would decode to a silently empty year rather than an error. Entries also
  // happen to be smaller than an object.
  calendar: {
    pack: (d: DailyCounts) => ({ ...d, byDay: [...d.byDay] }),
    unpack: (d: Omit<DailyCounts, 'byDay'> & { byDay: [string, number][] }) => ({
      ...d,
      byDay: new Map(d.byDay),
    }),
  },
  // Links shared before the season ring existed carry a bare 12-number array.
  // Upgrading them here keeps every old link alive; bumping SNAPSHOT_VERSION
  // for this would have invalidated every link for every view instead. Such a
  // link plots its months as it always did — the signatures simply aren't in
  // it, and the ring says so rather than inventing them.
  seasonal: {
    pack: (d: SeasonalData) => d,
    unpack: (d: SeasonalData | number[]) => {
      if (!Array.isArray(d)) return d;
      const seasons = SEASONS.map((_, i) => ({
        plays: SEASONS[i]!.monthIndices.reduce((a, m) => a + (d[m] ?? 0), 0),
        signature: null,
      }));
      return {
        months: d,
        monthSignatures: d.map(() => null),
        seasons,
        total: d.reduce((a, b) => a + b, 0),
      };
    },
  },
  // `shares` is exactly months[i] / total — a full parallel array of floats,
  // and the single biggest thing in a retention payload.
  retention: {
    pack: (d: RetentionData) => ({
      ...d,
      cohorts: d.cohorts.map(({ shares: _shares, ...rest }) => rest),
    }),
    unpack: (d: RetentionData) => ({
      ...d,
      cohorts: d.cohorts.map((c) => ({
        ...c,
        shares: c.months.map((v) => (c.total ? v / c.total : 0)),
      })),
    }),
  },
};

const packPayload = (view: SnapshotView, payload: unknown): unknown =>
  TRIMS[view] ? TRIMS[view]!.pack(payload as never) : payload;

const unpackPayload = (view: SnapshotView, payload: unknown): unknown =>
  TRIMS[view] ? TRIMS[view]!.unpack(payload as never) : payload;

/* ------------------------------- encoding -------------------------------- */

/**
 * Round non-integers on the way into JSON. Play counts are integers and pass
 * through untouched; a share of 0.043478260869565216 becomes 0.043478, which
 * is well past the precision any pixel can show.
 */
const roundFloats = (_key: string, value: unknown): unknown =>
  typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value)
    ? Number(value.toPrecision(SIG_DIGITS))
    : value;

function toBase64Url(bytes: Uint8Array): string {
  // Chunked so a large payload can't blow the argument limit on apply().
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, transform: TransformStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Encode a snapshot to a `<version>.<base64url>` fragment. `deflate-raw` is
 * used bare rather than via a library — these payloads are mostly repeated
 * keys and runs of zeros, which it crushes, and it ships in the browser.
 */
export async function encodeSnapshot(snapshot: Snapshot): Promise<string> {
  const json = JSON.stringify(
    { ...snapshot, payload: packPayload(snapshot.view, snapshot.payload) },
    roundFloats,
  );
  const deflated = await pipe(
    new TextEncoder().encode(json),
    new CompressionStream('deflate-raw'),
  );
  return `${SNAPSHOT_VERSION}.${toBase64Url(deflated)}`;
}

export type DecodeResult =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; reason: 'empty' | 'version' | 'corrupt' };

/**
 * Decode a fragment back to a snapshot. Every failure is a named reason rather
 * than a throw, because the three cases want different words in front of the
 * reader: nothing to show, a link from a newer/older build, and a mangled
 * paste are not the same problem.
 */
export async function decodeSnapshot(fragment: string): Promise<DecodeResult> {
  const raw = fragment.replace(/^#/, '').trim();
  if (!raw) return { ok: false, reason: 'empty' };

  const dot = raw.indexOf('.');
  if (dot < 1) return { ok: false, reason: 'corrupt' };
  if (Number(raw.slice(0, dot)) !== SNAPSHOT_VERSION) {
    return { ok: false, reason: 'version' };
  }

  try {
    const inflated = await pipe(
      fromBase64Url(raw.slice(dot + 1)),
      new DecompressionStream('deflate-raw'),
    );
    const parsed = JSON.parse(new TextDecoder().decode(inflated)) as Snapshot;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.view !== 'string') {
      return { ok: false, reason: 'corrupt' };
    }
    return {
      ok: true,
      snapshot: {
        ...parsed,
        payload: unpackPayload(parsed.view, parsed.payload),
      },
    };
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
}

/** True for views a link can carry; the streamgraph draws from another path. */
export function isSnapshotView(view: View): view is SnapshotView {
  return view !== 'streamgraph';
}

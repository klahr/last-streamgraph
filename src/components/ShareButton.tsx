// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * "Share" control for the current view: copies a self-contained snapshot link,
 * or downloads the chart as a PNG.
 *
 * The panel states plainly what a link contains before you send one. Aggregate
 * listening data is still personal data, and a share button that hides what it
 * packs is asking the user to trust something they can't see.
 */
import { useEffect, useRef, useState } from 'react';
import {
  MAX_FRAGMENT_CHARS,
  encodeSnapshot,
  type Snapshot,
} from '../utils/shareSnapshot';
import { shareUrlFor } from '../utils/shareUrl';
import { downloadBlob, soleSvg, svgToPng } from '../utils/svgExport';

/** Matches the app shell, so an exported PNG isn't transparent. */
const PNG_BACKGROUND = '#020617';

interface Props {
  /** Builds the snapshot for the current view, or null when it can't travel. */
  buildSnapshot: (label: string) => Snapshot | null;
  /** The chart container, for the PNG path. */
  chartRef: React.RefObject<HTMLDivElement | null>;
  /** Used for the download filename and the panel heading. */
  viewLabel: string;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'copied' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

export function ShareButton({ buildSnapshot, chartRef, viewLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  /** Encoded length of the current snapshot, or null while it's unknown. */
  const [chars, setChars] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const canSnapshot = buildSnapshot('') !== null;
  const canPng = open && soleSvg(chartRef.current) !== null;
  const tooLarge = chars != null && chars > MAX_FRAGMENT_CHARS;

  // Measure the link as soon as the panel opens, so "too large" is visible
  // before the user tries rather than after.
  useEffect(() => {
    if (!open) return;
    let live = true;
    const snapshot = buildSnapshot('');
    if (!snapshot) {
      setChars(null);
      return;
    }
    void encodeSnapshot(snapshot).then((fragment) => {
      if (live) setChars(fragment.length);
    });
    return () => {
      live = false;
    };
  }, [open, buildSnapshot]);

  // Escape closes, and so does a click anywhere outside the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    // Deferred to the capture-free bubble phase on the *next* tick, so the
    // click that opened the panel doesn't immediately close it.
    const id = setTimeout(() => window.addEventListener('click', onClick), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
      clearTimeout(id);
    };
  }, [open]);

  const copyLink = async () => {
    const snapshot = buildSnapshot(label.trim());
    if (!snapshot) return;
    setStatus({ kind: 'working' });
    try {
      const fragment = await encodeSnapshot(snapshot);
      setChars(fragment.length);
      if (fragment.length > MAX_FRAGMENT_CHARS) {
        setStatus({ kind: 'idle' });
        return;
      }
      await navigator.clipboard.writeText(shareUrlFor(fragment));
      setStatus({ kind: 'copied' });
    } catch (e) {
      setStatus({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Could not build the link.',
      });
    }
  };

  const savePng = async () => {
    const svg = soleSvg(chartRef.current);
    if (!svg) return;
    setStatus({ kind: 'working' });
    try {
      const blob = await svgToPng(svg, { background: PNG_BACKGROUND });
      const slug = viewLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      downloadBlob(blob, `last-streamgraph-${slug || 'chart'}.png`);
      setStatus({ kind: 'saved' });
    } catch (e) {
      setStatus({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Could not export the image.',
      });
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => {
          setOpen((v) => !v);
          setStatus({ kind: 'idle' });
        }}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" />
          <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
        </svg>
        Share
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 z-40 mt-1 w-80 rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl"
        >
          <p className="mb-2 text-sm text-slate-200">Share “{viewLabel}”</p>

          <input
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 60))}
            placeholder="Add a title (optional)"
            className="mb-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-600 focus:outline-none"
          />

          <div className="flex gap-2">
            <button
              onClick={copyLink}
              disabled={!canSnapshot || tooLarge || status.kind === 'working'}
              className="flex-1 rounded bg-sky-600 px-2 py-1.5 text-sm text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
            >
              {status.kind === 'copied' ? 'Copied!' : 'Copy link'}
            </button>
            <button
              onClick={savePng}
              disabled={!canPng || status.kind === 'working'}
              className="flex-1 rounded border border-slate-700 px-2 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-600"
            >
              {status.kind === 'saved' ? 'Saved!' : 'Save PNG'}
            </button>
          </div>

          <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-slate-500">
            {!canSnapshot ? (
              <p>
                This view can&apos;t travel in a link yet — save it as an image
                instead.
              </p>
            ) : tooLarge ? (
              <p className="text-amber-500">
                This chart&apos;s data is too big for a link
                ({(chars! / 1000).toFixed(1)}k of {MAX_FRAGMENT_CHARS / 1000}k).
                Narrow the date range, or save it as an image.
              </p>
            ) : (
              <p>
                The link holds only what this chart draws — no username, no API
                key, and nothing about the rest of your library. It never
                reaches a server: everything after the <code>#</code> stays in
                the browser.
              </p>
            )}
            {!canPng && (
              <p>Image export needs a single chart; this view draws several.</p>
            )}
            {status.kind === 'error' && (
              <p className="text-red-400">{status.message}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

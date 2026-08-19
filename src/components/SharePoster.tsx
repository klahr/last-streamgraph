// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * What someone sees when they open a shared link.
 *
 * Deliberately not the app: no sidebar, no tabs, no controls, and — the part
 * that matters — no network. Everything drawn here comes out of the URL
 * fragment, so a snapshot renders identically forever, with no Last.fm account,
 * no API key and no IndexedDB behind it.
 */
import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useResizeObserver } from '../hooks/useResizeObserver';
import { renderAnalyticsView } from './views/renderAnalyticsView';
import { labelFor, VIEW_DESCRIPTIONS } from '../viewMeta';
import { decodeSnapshot, type Snapshot } from '../utils/shareSnapshot';
import type { AnalyticsViewResult } from '../hooks/useAnalytics';
import { snapshotFacts } from '../utils/snapshotFacts';

export function SharePoster({ fragment }: { fragment: string }) {
  const [state, setState] = useState<
    { phase: 'loading' } | { phase: 'ok'; snapshot: Snapshot } | { phase: 'bad'; reason: string }
  >({ phase: 'loading' });

  useEffect(() => {
    let live = true;
    void decodeSnapshot(fragment).then((result) => {
      if (!live) return;
      if (result.ok) {
        setState({ phase: 'ok', snapshot: result.snapshot });
      } else {
        setState({ phase: 'bad', reason: REASONS[result.reason] });
      }
    });
    return () => {
      live = false;
    };
  }, [fragment]);

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-slate-950 text-slate-100">
      <Aurora />
      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-10 sm:py-16">
        {state.phase === 'loading' && <Centered>Unpacking snapshot…</Centered>}
        {state.phase === 'bad' && <Broken reason={state.reason} />}
        {state.phase === 'ok' && (
          <Boundary
            fallback={
              <Broken reason="This snapshot was made by a different version of the app, so it can't be drawn here." />
            }
          >
            <Poster snapshot={state.snapshot} />
          </Boundary>
        )}
      </div>
    </div>
  );
}

const REASONS: Record<'empty' | 'version' | 'corrupt', string> = {
  empty: 'This link has no chart attached to it.',
  version:
    'This link was made by a different version of the app. Ask for a fresh one.',
  corrupt:
    'This link is damaged — it was probably cut short somewhere between there and here.',
};

/* -------------------------------- poster --------------------------------- */

function Poster({ snapshot }: { snapshot: Snapshot }) {
  const [chartRef, size] = useResizeObserver<HTMLDivElement>();
  const result = useMemo(
    () => ({ view: snapshot.view, payload: snapshot.payload }) as AnalyticsViewResult,
    [snapshot],
  );
  const facts = useMemo(() => snapshotFacts(snapshot), [snapshot]);
  const title = snapshot.label.trim() || labelFor(snapshot.view);

  return (
    <>
      <header className="mb-8">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.2em] text-sky-400/80">
          Last Streamgraph
        </p>
        <h1 className="bg-gradient-to-br from-white via-slate-100 to-slate-400 bg-clip-text text-4xl font-semibold leading-tight text-transparent sm:text-6xl">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-400">
          {VIEW_DESCRIPTIONS[snapshot.view]}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          {fmtRange(snapshot.from, snapshot.to)}
        </p>
      </header>

      {facts.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {facts.map((f) => (
            <div
              key={f.label}
              className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
            >
              <div className="text-lg font-semibold text-slate-100">{f.value}</div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                {f.label}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="relative rounded-2xl border border-slate-800 bg-slate-900/50 p-2 shadow-2xl ring-1 ring-white/5 backdrop-blur-sm">
        {/* The chart gets a fixed, generous box: the views size themselves from
            their container, and a poster wants a stable shape, not the app's
            fill-the-window behaviour. */}
        <div ref={chartRef} className="h-[62vh] min-h-[380px] w-full">
          {size.width > 0 &&
            renderAnalyticsView({
              result,
              size,
              palette: snapshot.palette,
              groupBy: snapshot.groupBy,
              topN: snapshot.topN,
              hasGenres: snapshot.hasGenres,
            })}
        </div>
      </div>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800/80 pt-6">
        <p className="text-xs text-slate-500">
          A static snapshot taken {fmtDate(snapshot.made)} — not live data.
        </p>
        <a
          href="/"
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"
        >
          Chart your own listening →
        </a>
      </footer>
    </>
  );
}

/* -------------------------------- chrome --------------------------------- */

/** Slow colour wash behind the poster. Purely decorative, hidden from AT. */
function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute -left-40 -top-40 h-[36rem] w-[36rem] rounded-full bg-sky-500/20 blur-[120px]" />
      <div className="absolute -right-32 top-1/3 h-[30rem] w-[30rem] rounded-full bg-fuchsia-500/15 blur-[120px]" />
      <div className="absolute -bottom-40 left-1/4 h-[28rem] w-[28rem] rounded-full bg-emerald-500/10 blur-[120px]" />
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center text-slate-500">
      {children}
    </div>
  );
}

function Broken({ reason }: { reason: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <p className="text-2xl font-medium text-slate-200">Nothing to show</p>
      <p className="max-w-md text-sm text-slate-500">{reason}</p>
      <a
        href="/"
        className="mt-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"
      >
        Chart your own listening →
      </a>
    </div>
  );
}

/**
 * Catches a render throw from a payload that decoded cleanly but doesn't match
 * what the current views expect — the exact failure a schema change causes in
 * links already out in the world.
 */
class Boundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/* ------------------------------ formatting ------------------------------- */

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

const fmtMonth = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });

const fmtRange = (from: number, to: number) =>
  `${fmtMonth(from)} — ${fmtMonth(to)}`;

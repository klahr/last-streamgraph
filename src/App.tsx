// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * App shell: owns persisted credentials + viz config, wires the data hooks to
 * the control panel and the streamgraph, and lays out the responsive chart area.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { Streamgraph } from './components/Streamgraph';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useScrobbleData } from './hooks/useScrobbleData';
import { useProcessedData } from './hooks/useProcessedData';
import { useGenreEnrichment } from './hooks/useGenreEnrichment';
import { useAnalytics } from './hooks/useAnalytics';
import { useResizeObserver } from './hooks/useResizeObserver';
import { buildColorMap } from './utils/colors';
import { usernameFromPath, syncUsernameToPath } from './utils/shareUrl';
import { hostApiKey } from './utils/runtimeConfig';
import { renderAnalyticsView } from './components/views/renderAnalyticsView';
import { ShareButton } from './components/ShareButton';
import { VIEWS, VIEW_DESCRIPTIONS, labelFor, shareTitleFor } from './viewMeta';
import { isSnapshotView, type Snapshot } from './utils/shareSnapshot';
import type {
  Credentials,
  RangeSelection,
  Resolution,
  View,
  VizConfig,
} from './types';

const BUCKET_NOUN: Record<Resolution, string> = {
  weekly: 'weeks',
  monthly: 'months',
  yearly: 'years',
};

const DAY_MS = 86_400_000;
const DEFAULT_RANGE: RangeSelection = { preset: 'all', from: null, to: null };

/** Resolve a {@link RangeSelection} to concrete [from, to] epoch-ms bounds. */
function resolveRange(
  range: RangeSelection,
  minMs: number,
  maxMs: number,
): { from?: number; to?: number } {
  switch (range.preset) {
    case 'month':
      return { from: maxMs - 31 * DAY_MS, to: maxMs };
    case 'year':
      return { from: maxMs - 365 * DAY_MS, to: maxMs };
    // Calendar year to date. Anchored to the newest scrobble rather than the
    // wall clock, like every other preset here, so a history that stops short
    // of today still yields its final year instead of an empty window.
    case 'thisyear':
      return { from: new Date(new Date(maxMs).getFullYear(), 0, 1).getTime(), to: maxMs };
    case '5years':
      return { from: maxMs - 5 * 365 * DAY_MS, to: maxMs };
    case 'custom':
      return { from: range.from ?? minMs, to: range.to ?? maxMs };
    case 'all':
    default:
      return {};
  }
}

const DEFAULT_CONFIG: VizConfig = {
  resolution: 'monthly',
  mode: 'absolute',
  topN: 100,
  othersMode: 'group',
  palette: 'viridis',
  groupBy: 'artist',
  forecastFilter: '',
  sessionGapMin: 30,
};

const DEFAULT_CREDS: Credentials = { apiKey: '', username: '' };

export default function App() {
  const [creds, setCreds] = useLocalStorage<Credentials>(
    'lsg.creds',
    DEFAULT_CREDS,
  );
  const [storedConfig, setConfig] = useLocalStorage<VizConfig>(
    'lsg.config',
    DEFAULT_CONFIG,
  );
  // Merge with defaults so a config persisted before a field existed still
  // gets a sensible value for any newly-added field.
  const config = useMemo(
    () => ({ ...DEFAULT_CONFIG, ...storedConfig }),
    [storedConfig],
  );
  const [range, setRange] = useLocalStorage<RangeSelection>(
    'lsg.range',
    DEFAULT_RANGE,
  );
  const [view, setView] = useLocalStorage<View>('lsg.view', 'streamgraph');

  // On small screens the settings panel becomes a slide-in drawer toggled by
  // the hamburger; on large screens it's always-visible and this is ignored.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Credential fields bind to a non-persisted DRAFT; nothing commits to
  // `creds` (which the sync hooks watch) until the user hits Apply. This stops
  // an auto-sync kicking off on every keystroke while typing a username. The
  // draft re-seeds from `creds` when the latter changes out-of-band (share-URL
  // path user, or a full resync clearing the cache).
  const [draftCreds, setDraftCreds] = useState<Credentials>(creds);
  useEffect(() => {
    setDraftCreds(creds);
  }, [creds]);
  const applyCreds = () => setCreds(draftCreds);

  // Shareable links carry the username in the URL path (e.g. /klarre908). On
  // first load that wins over the stored username; the API key is never in the
  // URL, so the viewer still uses their own key from localStorage.
  const appliedPathUser = useRef(false);
  useEffect(() => {
    if (appliedPathUser.current) return;
    appliedPathUser.current = true;
    const pathUser = usernameFromPath();
    if (pathUser && pathUser !== creds.username) {
      setCreds({ ...creds, username: pathUser });
    }
    // Mount only: the URL is read once; later changes flow username → URL below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the address bar in sync with the active username so it's always a
  // copy-paste-able share link.
  useEffect(() => {
    syncUsernameToPath(creds.username);
  }, [creds.username]);

  // A deployment can bake in a read-only API key (see public/config.js) so
  // visitors only need a username. When present it overrides whatever key is in
  // localStorage, and the API-key field is hidden in the panel. The committed
  // `creds` never holds the host key; it's injected here into `effectiveCreds`,
  // which is what the sync hooks actually consume.
  const hostKey = hostApiKey();
  const hostManagedKey = !!hostKey;
  const effectiveCreds = useMemo(
    () => (hostKey ? { ...creds, apiKey: hostKey } : creds),
    [creds, hostKey],
  );
  // The key the user is effectively applying with: the host key when present
  // (the field is hidden and `creds`/draft never holds it), else the draft key.
  const effectiveApiKey = hostManagedKey ? hostKey : draftCreds.apiKey;

  const hasCreds =
    !!effectiveCreds.apiKey.trim() && !!effectiveCreds.username.trim();
  const { scrobbles, progress, sync } = useScrobbleData(
    hasCreds ? effectiveCreds : null,
  );

  // Full time span of the cached history (epoch ms), for the date-range control.
  const span = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const s of scrobbles) {
      if (s.uts < min) min = s.uts;
      if (s.uts > max) max = s.uts;
    }
    return scrobbles.length
      ? { minMs: min * 1000, maxMs: max * 1000 }
      : { minMs: 0, maxMs: 0 };
  }, [scrobbles]);

  const { from, to } = resolveRange(range, span.minMs, span.maxMs);

  // Genre enrichment runs when genres are needed. The sunburst no longer
  // forces it — it only keys by genre under genre grouping, which the first
  // clause already covers.
  const needGenres = config.groupBy === 'genre' || view === 'forecast';
  const genre = useGenreEnrichment(
    hasCreds ? effectiveCreds : null,
    scrobbles,
    needGenres,
  );

  const { data, processing } = useProcessedData(scrobbles, {
    resolution: config.resolution,
    topN: config.topN,
    othersMode: config.othersMode,
    groupBy: config.groupBy,
    genreMap: genre.genreMap,
    from,
    to,
  });

  const [chartRef, size] = useResizeObserver<HTMLDivElement>();
  const colorMap = useMemo(
    () => buildColorMap(data.keys, config.palette),
    [data.keys, config.palette],
  );

  // Auxiliary views compute in a Web Worker; filter at the same bucket
  // granularity as the streamgraph so a mid-month `to` shows the full last
  // month in both. The worker holds the full dataset and filters per-request.
  const {
    result: analyticsResult,
    processing: analyticsProcessing,
    error: analyticsError,
  } = useAnalytics(scrobbles, genre.genreMap, {
    view,
    resolution: config.resolution,
    topN: config.topN,
    groupBy: config.groupBy,
    forecastFilter: config.forecastFilter,
    sessionGapMin: config.sessionGapMin,
    from,
    to,
  });

  const hasGenres = Object.keys(genre.genreMap).length > 0;

  const renderView = () => {
    if (view === 'streamgraph') {
      return (
        <Streamgraph
          data={data}
          size={size}
          mode={config.mode}
          palette={config.palette}
          resolution={config.resolution}
        />
      );
    }
    // Every other view draws from the analytics worker's union, through the
    // same renderer the shared-snapshot poster uses.
    if (analyticsResult?.view !== view) return null;
    return renderAnalyticsView({
      result: analyticsResult,
      size,
      palette: config.palette,
      groupBy: config.groupBy,
      topN: config.topN,
      hasGenres,
    });
  };

  /**
   * Package the current view for a share link. Returns null when this view
   * can't travel — the streamgraph draws from a different pipeline, and a view
   * still computing has nothing to send.
   */
  const buildSnapshot = useCallback(
    (label: string): Snapshot | null => {
      if (!isSnapshotView(view)) return null;
      if (analyticsResult?.view !== view) return null;
      return {
        view,
        payload: analyticsResult.payload,
        palette: config.palette,
        groupBy: config.groupBy,
        topN: config.topN,
        hasGenres,
        // An unbounded range means "everything", so the caption reports the
        // span the data actually covers rather than an open interval.
        from: from ?? span.minMs,
        to: to ?? span.maxMs,
        label,
        made: Date.now(),
      };
    },
    [
      view,
      analyticsResult,
      config.palette,
      config.groupBy,
      config.topN,
      hasGenres,
      from,
      to,
      span.minMs,
      span.maxMs,
    ],
  );

  const patchConfig = (patch: Partial<VizConfig>) =>
    setConfig((prev) => ({ ...DEFAULT_CONFIG, ...prev, ...patch }));

  // One honest "is the app working?" signal spanning the worker recompute,
  // background sync, and genre tagging — surfaced as a top progress bar so
  // filter changes and first-open never look frozen.
  const syncing = progress.phase === 'syncing';
  const busy = syncing || processing || analyticsProcessing || genre.progress.running;
  const busyMessage = syncing
    ? progress.message || 'Loading…'
    : genre.progress.running
      ? genre.progress.message || 'Tagging genres…'
      : 'Updating chart…';

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Backdrop behind the mobile drawer; absent on large screens. */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <ControlPanel
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        view={view}
        creds={draftCreds}
        onCredsChange={setDraftCreds}
        onApplyCreds={applyCreds}
        canApply={
          (draftCreds.username.trim() !== creds.username.trim() ||
            (!hostManagedKey &&
              draftCreds.apiKey.trim() !== creds.apiKey.trim())) &&
          !!effectiveApiKey.trim() &&
          !!draftCreds.username.trim()
        }
        hostManagedKey={!!hostKey}
        config={config}
        onConfigChange={patchConfig}
        progress={progress}
        cachedCount={scrobbles.length}
        visibleArtists={data.keys.length}
        onSync={sync}
        range={range}
        onRangeChange={setRange}
        spanMs={span}
        effectiveRange={{ from, to }}
        genreProgress={genre.progress}
        genreMissing={genre.missingCount}
        onRefetchGenres={genre.enrich}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {/* View tabs (with the hamburger that opens the settings drawer) */}
        <div className="flex items-center gap-1 border-b border-slate-800 px-3 py-2">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open settings"
            className="mr-1 shrink-0 rounded p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 lg:hidden"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="flex items-center gap-1 overflow-x-auto">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={`shrink-0 rounded px-3 py-1.5 text-sm transition ${
                  view === v.id
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="ml-auto pl-2">
            <ShareButton
              buildSnapshot={buildSnapshot}
              chartRef={chartRef}
              viewLabel={labelFor(view)}
              defaultLabel={shareTitleFor(view, creds.username)}
            />
          </div>
        </div>

        <div className="border-b border-slate-800 px-6 py-1.5">
          <p className="text-xs text-slate-500">{VIEW_DESCRIPTIONS[view]}</p>
        </div>

        {view === 'streamgraph' && (
          <div className="border-b border-slate-800 px-6 py-2">
            <p className="text-xs text-slate-500">
              {config.mode === 'absolute' ? 'Absolute plays' : 'Relative share'} ·{' '}
              {config.resolution} · by {config.groupBy} ·{' '}
              {data.grandTotal.toLocaleString()} plays across {data.matrix.length}{' '}
              {BUCKET_NOUN[config.resolution]}
            </p>
          </div>
        )}

        <div ref={chartRef} className="relative min-h-0 flex-1" aria-busy={busy}>
          {!hasCreds ? (
            <EmptyState hostManagedKey={!!hostKey} />
          ) : analyticsError && view !== 'streamgraph' ? (
            <ErrorState message={analyticsError} />
          ) : view !== 'streamgraph' &&
              analyticsResult?.view !== view ? (
            <LoadingState message={busyMessage} />
          ) : busy && scrobbles.length === 0 ? (
            <LoadingState message={busyMessage} />
          ) : (
            renderView()
          )}
        </div>

        {view === 'streamgraph' && data.keys.length > 0 && (
          <Legend keys={data.keys} colorMap={colorMap} totals={data.totals} />
        )}
      </main>
    </div>
  );
}

function EmptyState({ hostManagedKey }: { hostManagedKey: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-slate-500">
      <p className="text-lg text-slate-300">
        {hostManagedKey
          ? 'Enter a Last.fm username'
          : 'Add your Last.fm API key & username'}
      </p>
      <p className="max-w-sm text-sm">
        {hostManagedKey
          ? 'Type a username in the panel on the left to fetch and visualize that listening history. Everything is cached locally in your browser.'
          : 'Enter your credentials in the panel on the left to fetch and visualize your listening history. Everything is cached locally in your browser.'}
      </p>
    </div>
  );
}

/** Centered placeholder shown on first open while the cache hydrates / first
 * sync runs and there is nothing to draw yet. */
function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

/** View couldn't be computed (e.g. a worker error). Shown instead of a stuck spinner. */
function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-slate-500">
      <p className="text-sm text-red-400">Couldn't render this view.</p>
      <p className="max-w-sm text-xs text-slate-500">{message}</p>
    </div>
  );
}

function Legend({
  keys,
  colorMap,
  totals,
}: {
  keys: string[];
  colorMap: Record<string, string>;
  totals: Record<string, number>;
}) {
  return (
    <div className="flex max-h-24 flex-wrap gap-x-4 gap-y-1 overflow-y-auto border-t border-slate-800 px-6 py-3 text-xs">
      {keys.map((key) => (
        <span key={key} className="flex items-center gap-1.5 text-slate-400">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: colorMap[key] }}
          />
          <span className="text-slate-300">{key}</span>
          <span className="text-slate-600">
            {(totals[key] ?? 0).toLocaleString()}
          </span>
        </span>
      ))}
    </div>
  );
}

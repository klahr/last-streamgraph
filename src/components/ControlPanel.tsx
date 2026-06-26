// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Configuration sidebar: credentials, time resolution, stream mode, artist
 * limit, color palette, and sync controls. Pure presentational component —
 * all state lives in App and is threaded down via props.
 */
import type {
  Credentials,
  GenreProgress,
  GroupBy,
  RangePreset,
  RangeSelection,
  Resolution,
  StreamMode,
  SyncProgress,
  VizConfig,
  View,
} from '../types';
import { PALETTES } from '../utils/colors';

interface Props {
  /** Drawer open state (small screens only; always visible on large). */
  open: boolean;
  /** Close the drawer (small screens). */
  onClose: () => void;
  /** Active view, used to show only the controls relevant to it. */
  view: View;
  creds: Credentials;
  onCredsChange: (creds: Credentials) => void;
  /** Commit the draft credentials (triggers sync). */
  onApplyCreds: () => void;
  /** Whether Apply is enabled (dirty + valid). */
  canApply: boolean;
  /** Host baked in the API key (config.js); hide the key field when true. */
  hostManagedKey: boolean;
  config: VizConfig;
  onConfigChange: (patch: Partial<VizConfig>) => void;
  progress: SyncProgress;
  cachedCount: number;
  visibleArtists: number;
  onSync: () => void;
  range: RangeSelection;
  onRangeChange: (range: RangeSelection) => void;
  spanMs: { minMs: number; maxMs: number };
  effectiveRange: { from?: number; to?: number };
  genreProgress: GenreProgress;
  genreMissing: number;
  onRefetchGenres: () => void;
}

const ARTIST_LIMITS = [10, 20, 50, 100];

const RANGE_PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: '5years', label: '5 yrs' },
  { id: 'year', label: '1 yr' },
  { id: 'month', label: '1 mo' },
];

export function ControlPanel({
  open,
  onClose,
  view,
  creds,
  onCredsChange,
  onApplyCreds,
  canApply,
  hostManagedKey,
  config,
  onConfigChange,
  progress,
  cachedCount,
  visibleArtists,
  onSync,
  range,
  onRangeChange,
  spanMs,
  effectiveRange,
  genreProgress,
  genreMissing,
  onRefetchGenres,
}: Props) {
  const syncing = progress.phase === 'syncing';
  const unit =
    config.groupBy === 'genre'
      ? 'genres'
      : config.groupBy === 'album'
        ? 'albums'
        : 'artists';

  // Each control is shown only on the views it actually affects, so the panel
  // never presents a knob that's silently inert on the current view.
  const showResolution = view === 'streamgraph' || view === 'rankbump';
  const showGroupBy =
    view === 'streamgraph' || view === 'sunburst' || view === 'forecast';
  const showStreamMode = view === 'streamgraph';
  const showTopN =
    view === 'streamgraph' || view === 'rankbump' || view === 'network';
  // The forecast view replaces the Top-N slider with a regex filter.
  const showForecastFilter = view === 'forecast';
  // Red border on an invalid regex; empty/valid are neutral.
  const forecastFilterValid = (() => {
    const f = config.forecastFilter.trim();
    if (!f) return true;
    try { new RegExp(f); return true; } catch { return false; }
  })();
  // `topN` means "top N per interval" only on the streamgraph; on the aux
  // views it's a flat line/node count, so label it honestly per view.
  const topNTitle =
    view === 'streamgraph'
      ? `Top ${config.topN} per interval`
      : view === 'rankbump'
        ? `Top ${config.topN} ranked`
        : `Top ${config.topN} artists`;

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex h-full w-80 max-w-[85vw] shrink-0 transform flex-col gap-6 overflow-y-auto border-r border-slate-800 bg-slate-900 p-5 text-slate-200 transition-transform duration-300 ease-in-out lg:static lg:max-w-none lg:translate-x-0 lg:transition-none ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <img
            src="/icon.svg"
            alt=""
            width={32}
            height={32}
            className="mt-0.5 shrink-0 rounded-lg"
          />
          <div>
          <h1 className="text-lg font-semibold text-slate-100">
            Last Streamgraph
          </h1>
          <p className="text-xs text-slate-500">
            Your Last.fm history as a flowing stream.
          </p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close settings"
          className="-mr-1 shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 lg:hidden"
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
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </header>

      {/* Credentials */}
      <Section title="Last.fm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canApply) onApplyCreds();
          }}
          className="contents"
        >
          {!hostManagedKey && (
            <Field label="API Key">
              <input
                type="password"
                autoComplete="off"
                value={creds.apiKey}
                onChange={(e) =>
                  onCredsChange({ ...creds, apiKey: e.target.value })
                }
                placeholder="32-char API key"
                className={inputCls}
              />
            </Field>
          )}
          <Field label="Username">
            <input
              type="text"
              autoComplete="off"
              value={creds.username}
              onChange={(e) =>
                onCredsChange({ ...creds, username: e.target.value })
              }
              placeholder="last.fm username"
              className={inputCls}
            />
          </Field>
          <div className="flex items-center justify-between gap-2">
            {!hostManagedKey && (
              <a
                href="https://www.last.fm/api/account/create"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-sky-400 hover:underline"
              >
                Get an API key →
              </a>
            )}
          </div>
          <button
            type="submit"
            disabled={!canApply}
            className="rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apply
          </button>
        </form>
      </Section>

      {/* Time resolution (streamgraph + rankbump only — forecast buckets
          monthly internally; the calendar views are resolution-agnostic) */}
      {showResolution && (
        <Section title="Resolution">
          <SegmentedControl<Resolution>
            value={config.resolution}
            onChange={(v) => onConfigChange({ resolution: v })}
            options={[
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
              { value: 'yearly', label: 'Yearly' },
            ]}
          />
        </Section>
      )}

      {/* Date range */}
      <Section title="Date range">
        <div className="flex gap-1.5">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => onRangeChange({ preset: p.id, from: null, to: null })}
              className={`flex-1 rounded border px-1.5 py-1 text-xs transition ${
                range.preset === p.id
                  ? 'border-sky-500 bg-sky-500/20 text-sky-300'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {spanMs.maxMs > spanMs.minMs && (
          <DateRangeSlider
            minMs={spanMs.minMs}
            maxMs={spanMs.maxMs}
            from={effectiveRange.from ?? spanMs.minMs}
            to={effectiveRange.to ?? spanMs.maxMs}
            onChange={(from, to) => onRangeChange({ preset: 'custom', from, to })}
          />
        )}
        <p className="text-xs text-slate-500">
          {fmtMonth(effectiveRange.from ?? spanMs.minMs)} —{' '}
          {fmtMonth(effectiveRange.to ?? spanMs.maxMs)}
        </p>
      </Section>

      {/* Group by (streamgraph / sunburst / forecast — the only views whose
          grouping key changes what's plotted) */}
      {showGroupBy && (
        <Section title="Group by">
          <SegmentedControl<GroupBy>
            value={config.groupBy}
            onChange={(v) => onConfigChange({ groupBy: v })}
            options={[
              { value: 'artist', label: 'Artists' },
              { value: 'genre', label: 'Genres' },
              { value: 'album', label: 'Albums' },
            ]}
          />
          {config.groupBy === 'genre' && (
            <GenreStatus
              progress={genreProgress}
              missing={genreMissing}
              onRefetch={onRefetchGenres}
            />
          )}
        </Section>
      )}

      {/* Stream mode (streamgraph only — absolute vs relative share) */}
      {showStreamMode && (
        <Section title="Stream mode">
          <SegmentedControl<StreamMode>
            value={config.mode}
            onChange={(v) => onConfigChange({ mode: v })}
            options={[
              { value: 'absolute', label: 'Absolute' },
              { value: 'relative', label: 'Relative %' },
            ]}
          />
        </Section>
      )}

      {/* Top-N count: per interval on the streamgraph, a flat card/line/node
          count on forecast/rank/network. The “Others” fold is streamgraph-only. */}
      {showTopN && (
        <Section title={topNTitle}>
          <input
            type="range"
            min={5}
            max={100}
            step={1}
            value={config.topN}
            onChange={(e) => onConfigChange({ topN: Number(e.target.value) })}
            className="w-full accent-sky-500"
          />
          <div className="mt-2 flex gap-2">
            {ARTIST_LIMITS.map((n) => (
              <button
                key={n}
                onClick={() => onConfigChange({ topN: n })}
                className={`flex-1 rounded border px-2 py-1 text-xs transition ${
                  config.topN === n
                    ? 'border-sky-500 bg-sky-500/20 text-sky-300'
                    : 'border-slate-700 text-slate-400 hover:border-slate-600'
                }`
              }
              >
                {n}
              </button>
            ))}
          </div>
          {view === 'streamgraph' && (
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={config.othersMode === 'group'}
                onChange={(e) =>
                  onConfigChange({
                    othersMode: e.target.checked ? 'group' : 'discard',
                  })
                }
                className="accent-sky-500"
              />
              Group the rest into “Others”
            </label>
          )}
        </Section>
      )}

      {/* Forecast filter: a regex over series names (empty → top 12 by plays). */}
      {showForecastFilter && (
        <Section title="Forecast filter">
          <input
            type="text"
            value={config.forecastFilter}
            onChange={(e) => onConfigChange({ forecastFilter: e.target.value })}
            placeholder="regex, e.g. ^metal | ^the "
            className={`w-full rounded border bg-slate-800 px-2 py-1.5 font-mono text-sm text-slate-100 outline-none focus:border-sky-500 ${
              forecastFilterValid ? 'border-slate-700' : 'border-red-500'
            }`}
          />
          <p className="text-xs text-slate-500">
            Empty = top 12 by plays. Matches series names case-insensitively.
          </p>
        </Section>
      )}

      {/* Palette */}
      <Section title="Palette">
        <select
          value={config.palette}
          onChange={(e) =>
            onConfigChange({ palette: e.target.value as VizConfig['palette'] })
          }
          className={inputCls}
        >
          {PALETTES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Section>

      {/* Sync */}
      <Section title="Sync">
        <button
          onClick={onSync}
          disabled={syncing}
          className="w-full rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : 'Sync new'}
        </button>
        <ProgressIndicator progress={progress} />
        <p className="mt-2 text-xs text-slate-500">
          {cachedCount.toLocaleString()} scrobbles cached · {visibleArtists}{' '}
          {unit} shown
        </p>
      </Section>

      <footer className="mt-auto pt-2 text-xs text-slate-500">
        <a
          href="https://git.sr.ht/~klahr/last-streamgraph"
          target="_blank"
          rel="noreferrer"
          className="text-slate-500 transition hover:text-slate-300"
        >
          Source code →
        </a>
        <p className="mt-1">
          Free software under{' '}
          <a
            href="https://www.gnu.org/licenses/gpl-3.0.html"
            target="_blank"
            rel="noreferrer"
            className="text-slate-500 underline-offset-2 transition hover:text-slate-300 hover:underline"
          >
            GPL-3.0-or-later
          </a>
        </p>
      </footer>
    </aside>
  );
}

const inputCls =
  'w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500';

/** Format an ETA (ms) as a compact "~Xm left" / "~Xs left" suffix, or ''. */
function formatEta(etaMs?: number): string {
  if (etaMs == null || !Number.isFinite(etaMs)) return '';
  if (etaMs < 1000) return ' ~<1s left';
  const s = Math.round(etaMs / 1000);
  if (s < 60) return ` ~${s}s left`;
  const m = Math.round(s / 60);
  if (m < 60) return ` ~${m}m left`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return ` ~${h}h ${remM}m left`;
}

/** Genre-enrichment status: progress bar while tagging, summary otherwise. */
function GenreStatus({
  progress,
  missing,
  onRefetch,
}: {
  progress: GenreProgress;
  missing: number;
  onRefetch: () => void;
}) {
  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      {progress.running && (
        <div className="h-1.5 w-full overflow-hidden rounded bg-slate-800">
          <div
            className="h-full bg-sky-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          {progress.running
            ? `${progress.message}${formatEta(progress.etaMs)}`
            : missing > 0
              ? `${missing.toLocaleString()} artists untagged`
              : 'All artists tagged.'}
        </span>
        {!progress.running && missing > 0 && (
          <button
            onClick={onRefetch}
            className="shrink-0 rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 transition hover:border-slate-600"
          >
            Fetch
          </button>
        )}
      </div>
    </div>
  );
}

/** Format epoch ms as "YYYY-MM" (UTC). */
function fmtMonth(ms: number): string {
  if (!Number.isFinite(ms) || ms === 0) return '—';
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Dual-thumb range slider over the history's time span. Two overlaid range
 * inputs (pointer events only on the thumbs) with a highlighted active track;
 * thumbs can't cross. Snaps to days.
 */
function DateRangeSlider({
  minMs,
  maxMs,
  from,
  to,
  onChange,
}: {
  minMs: number;
  maxMs: number;
  from: number;
  to: number;
  onChange: (from: number, to: number) => void;
}) {
  const DAY = 86_400_000;
  const pct = (v: number) => ((v - minMs) / (maxMs - minMs)) * 100;
  const lo = Math.max(minMs, Math.min(from, to));
  const hi = Math.min(maxMs, Math.max(from, to));
  return (
    <div className="dual-range relative h-5">
      <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded bg-slate-700" />
      <div
        className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-sky-500"
        style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
      />
      <input
        type="range"
        className="dual-range__input"
        min={minMs}
        max={maxMs}
        step={DAY}
        value={lo}
        aria-label="Range start"
        onChange={(e) => onChange(Math.min(Number(e.target.value), hi), hi)}
      />
      <input
        type="range"
        className="dual-range__input"
        min={minMs}
        max={maxMs}
        step={DAY}
        value={hi}
        aria-label="Range end"
        onChange={(e) => onChange(lo, Math.max(Number(e.target.value), lo))}
      />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex overflow-hidden rounded border border-slate-700">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 px-3 py-1.5 text-sm transition ${
            value === opt.value
              ? 'bg-sky-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ProgressIndicator({ progress }: { progress: SyncProgress }) {
  if (progress.phase === 'idle') return null;
  const pct =
    progress.totalPages > 0
      ? Math.round((progress.page / progress.totalPages) * 100)
      : progress.phase === 'done'
        ? 100
        : 0;
  const barColor =
    progress.phase === 'error'
      ? 'bg-red-500'
      : progress.phase === 'done'
        ? 'bg-emerald-500'
        : 'bg-sky-500';
  return (
    <div className="mt-3">
      <div className="h-1.5 w-full overflow-hidden rounded bg-slate-800">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p
        className={`mt-1 text-xs ${
          progress.phase === 'error' ? 'text-red-400' : 'text-slate-500'
        }`}
      >
        {progress.message}{formatEta(progress.etaMs)}
      </p>
    </div>
  );
}

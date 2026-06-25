/**
 * Configuration sidebar: credentials, time resolution, stream mode, artist
 * limit, color palette, and sync controls. Pure presentational component —
 * all state lives in App and is threaded down via props.
 */
import type {
  Credentials,
  Resolution,
  StreamMode,
  SyncProgress,
  VizConfig,
} from '../types';
import { PALETTES } from '../utils/colors';

interface Props {
  creds: Credentials;
  onCredsChange: (creds: Credentials) => void;
  config: VizConfig;
  onConfigChange: (patch: Partial<VizConfig>) => void;
  progress: SyncProgress;
  cachedCount: number;
  visibleArtists: number;
  onSync: () => void;
  onFullResync: () => void;
}

const ARTIST_LIMITS = [10, 20, 50, 100];

export function ControlPanel({
  creds,
  onCredsChange,
  config,
  onConfigChange,
  progress,
  cachedCount,
  visibleArtists,
  onSync,
  onFullResync,
}: Props) {
  const syncing = progress.phase === 'syncing';

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col gap-6 overflow-y-auto border-r border-slate-800 bg-slate-900 p-5 text-slate-200">
      <header>
        <h1 className="text-lg font-semibold text-slate-100">Last Streamgraph</h1>
        <p className="text-xs text-slate-500">
          Your Last.fm history as a flowing stream.
        </p>
      </header>

      {/* Credentials */}
      <Section title="Last.fm">
        <Field label="API Key">
          <input
            type="password"
            autoComplete="off"
            value={creds.apiKey}
            onChange={(e) => onCredsChange({ ...creds, apiKey: e.target.value })}
            placeholder="32-char API key"
            className={inputCls}
          />
        </Field>
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
        <a
          href="https://www.last.fm/api/account/create"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-sky-400 hover:underline"
        >
          Get an API key →
        </a>
      </Section>

      {/* Time resolution */}
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

      {/* Stream mode */}
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

      {/* Artist limit (per interval) */}
      <Section title={`Top ${config.topN} per interval`}>
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
              }`}
            >
              {n}
            </button>
          ))}
        </div>
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
      </Section>

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
        <div className="flex gap-2">
          <button
            onClick={onSync}
            disabled={syncing}
            className="flex-1 rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync new'}
          </button>
          <button
            onClick={onFullResync}
            disabled={syncing}
            className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-600 disabled:opacity-50"
            title="Clear cache and re-fetch everything"
          >
            Full
          </button>
        </div>
        <ProgressIndicator progress={progress} />
        <p className="mt-2 text-xs text-slate-500">
          {cachedCount.toLocaleString()} scrobbles cached · {visibleArtists}{' '}
          artists shown
        </p>
      </Section>
    </aside>
  );
}

const inputCls =
  'w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500';

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
        {progress.message}
      </p>
    </div>
  );
}

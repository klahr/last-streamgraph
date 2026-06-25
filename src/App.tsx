/**
 * App shell: owns persisted credentials + viz config, wires the data hooks to
 * the control panel and the streamgraph, and lays out the responsive chart area.
 */
import { useEffect, useMemo, useRef } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { Streamgraph } from './components/Streamgraph';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useScrobbleData } from './hooks/useScrobbleData';
import { useProcessedData } from './hooks/useProcessedData';
import { useGenreEnrichment } from './hooks/useGenreEnrichment';
import { useResizeObserver } from './hooks/useResizeObserver';
import { buildColorMap } from './utils/colors';
import { usernameFromPath, syncUsernameToPath } from './utils/shareUrl';
import { hostApiKey } from './utils/runtimeConfig';
import { Punchcard } from './components/views/Punchcard';
import { CalendarHeatmap } from './components/views/CalendarHeatmap';
import { SeasonalRadial } from './components/views/SeasonalRadial';
import { DiscoveryTimeline } from './components/views/DiscoveryTimeline';
import { RankBump } from './components/views/RankBump';
import { GenreSunburst } from './components/views/GenreSunburst';
import { ArtistNetwork } from './components/views/ArtistNetwork';
import { Forecast } from './components/views/Forecast';
import type { ViewProps } from './components/views/viewProps';
import type {
  Credentials,
  RangeSelection,
  Resolution,
  View,
  VizConfig,
} from './types';

const VIEWS: { id: View; label: string }[] = [
  { id: 'streamgraph', label: 'Streamgraph' },
  { id: 'forecast', label: '🔮 Forecast' },
  { id: 'punchcard', label: 'Punchcard' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'seasonal', label: 'Seasonal' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'rankbump', label: 'Rank' },
  { id: 'sunburst', label: 'Genres' },
  { id: 'network', label: 'Network' },
];

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
  // localStorage, and the API-key field is hidden in the panel.
  const hostKey = hostApiKey();
  const effectiveCreds = useMemo(
    () => (hostKey ? { ...creds, apiKey: hostKey } : creds),
    [creds, hostKey],
  );

  const hasCreds =
    !!effectiveCreds.apiKey.trim() && !!effectiveCreds.username.trim();
  const { scrobbles, progress, sync, fullResync } = useScrobbleData(
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

  // Genre enrichment runs when genres are needed: genre grouping, the sunburst,
  // or the forecast (which forecasts by genre when available).
  const needGenres =
    config.groupBy === 'genre' || view === 'sunburst' || view === 'forecast';
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

  // Auxiliary views aggregate raw scrobbles themselves; apply the date window
  // (scrobble-level) so they stay consistent with the streamgraph's range.
  const rangedScrobbles = useMemo(() => {
    if (from == null && to == null) return scrobbles;
    const lo = from ?? -Infinity;
    const hi = to ?? Infinity;
    return scrobbles.filter((s) => {
      const ms = s.uts * 1000;
      return ms >= lo && ms <= hi;
    });
  }, [scrobbles, from, to]);

  const viewProps: ViewProps = {
    scrobbles: rangedScrobbles,
    size,
    palette: config.palette,
    genreMap: genre.genreMap,
    resolution: config.resolution,
    topN: config.topN,
  };

  const renderView = () => {
    switch (view) {
      case 'streamgraph':
        return (
          <Streamgraph
            data={data}
            size={size}
            mode={config.mode}
            palette={config.palette}
            resolution={config.resolution}
          />
        );
      case 'punchcard':
        return <Punchcard {...viewProps} />;
      case 'calendar':
        return <CalendarHeatmap {...viewProps} />;
      case 'seasonal':
        return <SeasonalRadial {...viewProps} />;
      case 'discovery':
        return <DiscoveryTimeline {...viewProps} />;
      case 'rankbump':
        return <RankBump {...viewProps} />;
      case 'sunburst':
        return <GenreSunburst {...viewProps} />;
      case 'network':
        return <ArtistNetwork {...viewProps} />;
      case 'forecast':
        return <Forecast {...viewProps} />;
      default:
        return null;
    }
  };

  const patchConfig = (patch: Partial<VizConfig>) =>
    setConfig((prev) => ({ ...DEFAULT_CONFIG, ...prev, ...patch }));

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <ControlPanel
        creds={creds}
        onCredsChange={setCreds}
        hostManagedKey={!!hostKey}
        config={config}
        onConfigChange={patchConfig}
        progress={progress}
        cachedCount={scrobbles.length}
        visibleArtists={data.keys.length}
        onSync={sync}
        onFullResync={fullResync}
        range={range}
        onRangeChange={setRange}
        spanMs={span}
        effectiveRange={{ from, to }}
        genreProgress={genre.progress}
        genreMissing={genre.missingCount}
        onRefetchGenres={genre.enrich}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {/* View tabs */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-800 px-3 py-2">
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

        {view === 'streamgraph' && (
          <div className="border-b border-slate-800 px-6 py-2">
            <p className="text-xs text-slate-500">
              {config.mode === 'absolute' ? 'Absolute plays' : 'Relative share'} ·{' '}
              {config.resolution} · by {config.groupBy} ·{' '}
              {data.grandTotal.toLocaleString()} plays across {data.matrix.length}{' '}
              {BUCKET_NOUN[config.resolution]}
              {processing ? ' · updating…' : ''}
            </p>
          </div>
        )}

        <div ref={chartRef} className="relative min-h-0 flex-1">
          {!hasCreds ? <EmptyState hostManagedKey={!!hostKey} /> : renderView()}
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

/**
 * App shell: owns persisted credentials + viz config, wires the data hooks to
 * the control panel and the streamgraph, and lays out the responsive chart area.
 */
import { useMemo } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { Streamgraph } from './components/Streamgraph';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useScrobbleData } from './hooks/useScrobbleData';
import { useProcessedData } from './hooks/useProcessedData';
import { useGenreEnrichment } from './hooks/useGenreEnrichment';
import { useResizeObserver } from './hooks/useResizeObserver';
import { buildColorMap } from './utils/colors';
import type {
  Credentials,
  RangeSelection,
  Resolution,
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

  const hasCreds = !!creds.apiKey.trim() && !!creds.username.trim();
  const { scrobbles, progress, sync, fullResync } = useScrobbleData(
    hasCreds ? creds : null,
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

  // Genre enrichment (fetch artist tags) is active only in genre-grouped mode.
  const genre = useGenreEnrichment(
    hasCreds ? creds : null,
    scrobbles,
    config.groupBy === 'genre',
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

  const patchConfig = (patch: Partial<VizConfig>) =>
    setConfig((prev) => ({ ...DEFAULT_CONFIG, ...prev, ...patch }));

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <ControlPanel
        creds={creds}
        onCredsChange={setCreds}
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
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
          <div>
            <h2 className="text-sm font-medium text-slate-300">
              {config.mode === 'absolute' ? 'Absolute plays' : 'Relative share'}{' '}
              · {config.resolution}
            </h2>
            <p className="text-xs text-slate-500">
              {data.grandTotal.toLocaleString()} plays across{' '}
              {data.matrix.length} {BUCKET_NOUN[config.resolution]}
              {processing ? ' · updating…' : ''}
            </p>
          </div>
        </div>

        <div ref={chartRef} className="relative min-h-0 flex-1">
          {!hasCreds ? (
            <EmptyState />
          ) : (
            <Streamgraph
              data={data}
              size={size}
              mode={config.mode}
              palette={config.palette}
              resolution={config.resolution}
            />
          )}
        </div>

        {data.keys.length > 0 && (
          <Legend keys={data.keys} colorMap={colorMap} totals={data.totals} />
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-slate-500">
      <p className="text-lg text-slate-300">Add your Last.fm API key & username</p>
      <p className="max-w-sm text-sm">
        Enter your credentials in the panel on the left to fetch and visualize
        your listening history. Everything is cached locally in your browser.
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

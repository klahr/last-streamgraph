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
import { useResizeObserver } from './hooks/useResizeObserver';
import { buildColorMap } from './utils/colors';
import type { Credentials, Resolution, VizConfig } from './types';

const BUCKET_NOUN: Record<Resolution, string> = {
  weekly: 'weeks',
  monthly: 'months',
  yearly: 'years',
};

const DEFAULT_CONFIG: VizConfig = {
  resolution: 'monthly',
  mode: 'absolute',
  topN: 100,
  othersMode: 'group',
  palette: 'viridis',
};

const DEFAULT_CREDS: Credentials = { apiKey: '', username: '' };

export default function App() {
  const [creds, setCreds] = useLocalStorage<Credentials>(
    'lsg.creds',
    DEFAULT_CREDS,
  );
  const [config, setConfig] = useLocalStorage<VizConfig>(
    'lsg.config',
    DEFAULT_CONFIG,
  );

  const hasCreds = !!creds.apiKey.trim() && !!creds.username.trim();
  const { scrobbles, progress, sync, fullResync } = useScrobbleData(
    hasCreds ? creds : null,
  );

  const { data, processing } = useProcessedData(scrobbles, {
    resolution: config.resolution,
    topN: config.topN,
    othersMode: config.othersMode,
  });

  const [chartRef, size] = useResizeObserver<HTMLDivElement>();
  const colorMap = useMemo(
    () => buildColorMap(data.keys, config.palette),
    [data.keys, config.palette],
  );

  const patchConfig = (patch: Partial<VizConfig>) =>
    setConfig((prev) => ({ ...prev, ...patch }));

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

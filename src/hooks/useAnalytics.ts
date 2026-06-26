/**
 * Drives the auxiliary-view aggregations in a Web Worker, re-running
 * (debounced) whenever the view, filter window, top-N, resolution, dataset, or
 * genre map changes.
 *
 * The trimmed dataset and genre map are uploaded only when their reference
 * changes; pure config changes (view switch, top-N, range) send just a small
 * request object, so toggling never re-clones the data across the thread
 * boundary. Stale results are dropped by the client.
 */
import { useEffect, useRef, useState } from 'react';
import { AnalyticsClient, StaleRequestError } from '../workers/analyticsClient';
import type {
  GroupBy,
  Resolution,
  View,
} from '../types';
import type { Scrobble } from '../types';
import type {
  ForecastSeries,
  HierNode,
  NetworkData,
  RankData,
} from '../utils/analytics';
import type {
  DailyCounts,
  Discovery,
  Punchcard,
} from '../utils/analytics';

interface Options {
  view: View;
  resolution: Resolution;
  topN: number;
  groupBy: GroupBy;
  from?: number;
  to?: number;
}

/** The typed union a view renders from. */
export type AnalyticsViewResult =
  | { view: 'punchcard'; payload: Punchcard }
  | { view: 'calendar'; payload: DailyCounts }
  | { view: 'seasonal'; payload: number[] }
  | { view: 'discovery'; payload: Discovery[] }
  | { view: 'rankbump'; payload: RankData }
  | { view: 'sunburst'; payload: HierNode }
  | { view: 'network'; payload: NetworkData }
  | { view: 'forecast'; payload: ForecastSeries[] };

export function useAnalytics(
  scrobbles: Scrobble[],
  genreMap: Record<string, string>,
  opts: Options,
): { result: AnalyticsViewResult | null; processing: boolean } {
  const clientRef = useRef<AnalyticsClient | null>(null);
  const sentDataRef = useRef<Scrobble[] | null>(null);
  const sentGenresRef = useRef<Record<string, string> | null>(null);
  const [raw, setRaw] = useState<{ view: View; payload: unknown } | null>(null);
  const [processing, setProcessing] = useState(false);

  // Create the worker in an effect (see useProcessedData for the StrictMode
  // rationale) and tear it down on cleanup.
  useEffect(() => {
    const client = new AnalyticsClient();
    clientRef.current = client;
    return () => {
      client.terminate();
      clientRef.current = null;
      sentDataRef.current = null;
      sentGenresRef.current = null;
    };
  }, []);

  const { view, resolution, topN, from, to } = opts;

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    setProcessing(true);
    const handle = setTimeout(() => {
      if (sentDataRef.current !== scrobbles) {
        client.setData(
          scrobbles.map((s) => ({ artist: s.artist, uts: s.uts, album: s.album })),
        );
        sentDataRef.current = scrobbles;
      }
      if (sentGenresRef.current !== genreMap) {
        client.setGenres(genreMap);
        sentGenresRef.current = genreMap;
      }
      client
        .compute({ view, resolution, topN, from, to })
        .then((payload) => setRaw({ view, payload }))
        .catch((err) => {
          if (err instanceof StaleRequestError) return;
        })
        .finally(() => setProcessing(false));
    }, 120);
    return () => clearTimeout(handle);
  }, [scrobbles, genreMap, view, resolution, topN, from, to]);

  const result = raw as AnalyticsViewResult | null;
  return { result, processing };
}

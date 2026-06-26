// SPDX-License-Identifier: GPL-3.0-or-later
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
  forecastFilter: string;
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

export interface AnalyticsState {
  result: AnalyticsViewResult | null;
  processing: boolean;
  error: string | null;
}

/** Min gap between two dataset uploads to the worker (see useProcessedData). */
const UPLOAD_MIN_MS = 3000;

export function useAnalytics(
  scrobbles: Scrobble[],
  genreMap: Record<string, string>,
  opts: Options,
): AnalyticsState {
  const clientRef = useRef<AnalyticsClient | null>(null);
  const sentDataRef = useRef<Scrobble[] | null>(null);
  const sentGenresRef = useRef<Record<string, string> | null>(null);
  const lastUploadAtRef = useRef(0);
  const [raw, setRaw] = useState<{ view: View; payload: unknown } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create the worker in an effect (see useProcessedData for the StrictMode
  // rationale) and tear it down on cleanup.
  useEffect(() => {
    const client = new AnalyticsClient();
    clientRef.current = client;
    return () => {
      client.terminate();
      clientRef.current = null;
      // A recreated client has an empty worker dataset; force a re-upload.
      sentDataRef.current = null;
      sentGenresRef.current = null;
    };
  }, []);

  const { view, resolution, topN, groupBy, forecastFilter, from, to } = opts;

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    // The streamgraph view has its own pipeline; skip the per-view compute so
    // a streamgraph filter change doesn't briefly spin up a wasted analytics
    // request (its result would be null anyway). Keep the dataset/genre upload
    // path so a switch to an aux view is instant.
    const isAuxView = view !== 'streamgraph';
    if (isAuxView) {
      setProcessing(true);
      setError(null);
    }
    const handle = setTimeout(() => {
      // Re-upload data only when its reference changed AND enough time has
      // passed since the last upload — sync flushes produce a new array every
      // few seconds, each potentially huge; throttling bounds the clone cost.
      const now = Date.now();
      if (
        sentDataRef.current !== scrobbles &&
        now - lastUploadAtRef.current >= UPLOAD_MIN_MS
      ) {
        client.setData(
          scrobbles.map((s) => ({ artist: s.artist, uts: s.uts, album: s.album })),
        );
        sentDataRef.current = scrobbles;
        lastUploadAtRef.current = now;
      }
      if (sentGenresRef.current !== genreMap) {
        client.setGenres(genreMap);
        sentGenresRef.current = genreMap;
      }
      if (!isAuxView) return;
      client
        .compute({ view, resolution, topN, groupBy, forecastFilter, from, to })
        .then((payload) => {
          setRaw({ view, payload });
          setProcessing(false);
        })
        .catch((err) => {
          // A superseded request must not flip `processing` off: a newer
          // request is still in flight, and clearing it would flash the
          // BusyBar off mid-work.
          if (err instanceof StaleRequestError) return;
          setProcessing(false);
          setError(err instanceof Error ? err.message : String(err));
        });
    }, 120);
    return () => clearTimeout(handle);
  }, [scrobbles, genreMap, view, resolution, topN, groupBy, forecastFilter, from, to]);

  const result = raw as AnalyticsViewResult | null;
  return { result, processing, error };
}

/**
 * Run the scrobble-processing pipeline in a Web Worker, re-running (debounced)
 * whenever the scrobble set, genre map, or relevant config changes.
 *
 * The dataset and genre map are uploaded to the worker only when they actually
 * change; pure config changes (top-N, resolution, mode, group-by, date range)
 * send just a small config object, so toggling never re-clones the data across
 * the thread boundary. Stale results are dropped by the worker client.
 */
import { useEffect, useRef, useState } from 'react';
import { ProcessClient, StaleRequestError } from '../workers/processClient';
import type {
  GroupBy,
  OthersMode,
  ProcessedData,
  Resolution,
  Scrobble,
} from '../types';

interface Options {
  resolution: Resolution;
  topN: number;
  othersMode: OthersMode;
  groupBy: GroupBy;
  genreMap: Record<string, string>;
  from?: number;
  to?: number;
}

const EMPTY: ProcessedData = { keys: [], matrix: [], totals: {}, grandTotal: 0 };

export function useProcessedData(
  scrobbles: Scrobble[],
  opts: Options,
): { data: ProcessedData; processing: boolean } {
  const clientRef = useRef<ProcessClient | null>(null);
  const sentDataRef = useRef<Scrobble[] | null>(null);
  const sentGenresRef = useRef<Record<string, string> | null>(null);
  const [data, setData] = useState<ProcessedData>(EMPTY);
  const [processing, setProcessing] = useState(false);

  // Lazily create one worker for the component's lifetime.
  if (!clientRef.current) clientRef.current = new ProcessClient();
  useEffect(() => {
    const client = clientRef.current;
    return () => client?.terminate();
  }, []);

  const { resolution, topN, othersMode, groupBy, genreMap, from, to } = opts;

  useEffect(() => {
    const client = clientRef.current!;
    setProcessing(true);
    const handle = setTimeout(() => {
      // Re-upload data / genres only when their reference actually changed.
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
        .process({ resolution, topN, othersMode, groupBy, from, to })
        .then((result) => {
          setData(result);
          setProcessing(false);
        })
        .catch((err) => {
          if (err instanceof StaleRequestError) return; // newer request in flight
          setProcessing(false);
        });
    }, 120);
    return () => clearTimeout(handle);
  }, [scrobbles, genreMap, resolution, topN, othersMode, groupBy, from, to]);

  return { data, processing };
}

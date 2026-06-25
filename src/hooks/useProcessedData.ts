/**
 * Run the scrobble-processing pipeline in a Web Worker, re-running (debounced)
 * whenever the scrobble set or relevant config changes. Stale results are
 * dropped by the worker client, so dragging the artist-limit slider stays
 * smooth.
 */
import { useEffect, useRef, useState } from 'react';
import { ProcessClient, StaleRequestError } from '../workers/processClient';
import type {
  OthersMode,
  ProcessedData,
  Resolution,
  Scrobble,
} from '../types';

interface Options {
  resolution: Resolution;
  topN: number;
  othersMode: OthersMode;
  from?: number;
  to?: number;
}

const EMPTY: ProcessedData = { keys: [], matrix: [], totals: {}, grandTotal: 0 };

export function useProcessedData(
  scrobbles: Scrobble[],
  opts: Options,
): { data: ProcessedData; processing: boolean } {
  const clientRef = useRef<ProcessClient | null>(null);
  const [data, setData] = useState<ProcessedData>(EMPTY);
  const [processing, setProcessing] = useState(false);

  // Lazily create one worker for the component's lifetime.
  if (!clientRef.current) clientRef.current = new ProcessClient();
  useEffect(() => () => clientRef.current?.terminate(), []);

  const { resolution, topN, othersMode, from, to } = opts;

  useEffect(() => {
    const client = clientRef.current!;
    setProcessing(true);
    const handle = setTimeout(() => {
      client
        .process({ scrobbles, resolution, topN, othersMode, from, to })
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
  }, [scrobbles, resolution, topN, othersMode, from, to]);

  return { data, processing };
}

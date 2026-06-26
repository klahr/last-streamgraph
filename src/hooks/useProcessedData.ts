// SPDX-License-Identifier: GPL-3.0-or-later
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

/** Min gap between two full-dataset uploads to the worker. The scrobble array
 * gets a new reference on each sync flush, so without throttling a 200-page
 * sync re-clones the whole set ~20 times. Config-only changes are unaffected
 * (they never upload). The throttled upload still gives the chart a chance to
 * fill in during a long initial sync, just on a coarser cadence. */
const UPLOAD_MIN_MS = 3000;

export function useProcessedData(
  scrobbles: Scrobble[],
  opts: Options,
): { data: ProcessedData; processing: boolean } {
  const clientRef = useRef<ProcessClient | null>(null);
  const sentDataRef = useRef<Scrobble[] | null>(null);
  const sentGenresRef = useRef<Record<string, string> | null>(null);
  const lastUploadAtRef = useRef(0);
  const [data, setData] = useState<ProcessedData>(EMPTY);
  const [processing, setProcessing] = useState(false);

  // Create the worker in an effect (not via lazy ref init) and tear it down on
  // cleanup, nulling the ref. React's StrictMode double-mounts effects in dev,
  // so the first mount's cleanup terminates that worker and the second mount
  // creates a fresh one. Without nulling the ref, the second mount would keep
  // posting into the terminated worker and never receive a result (processing
  // would spin forever). Prod is unaffected, but dev must work too.
  useEffect(() => {
    const client = new ProcessClient();
    clientRef.current = client;
    return () => {
      client.terminate();
      clientRef.current = null;
      // A recreated client has an empty worker dataset; force a re-upload.
      sentDataRef.current = null;
      sentGenresRef.current = null;
    };
  }, []);

  const { resolution, topN, othersMode, groupBy, genreMap, from, to } = opts;

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    setProcessing(true);
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

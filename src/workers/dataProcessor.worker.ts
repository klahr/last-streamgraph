/// <reference lib="webworker" />
/**
 * Web Worker that runs the scrobble-processing pipeline off the main thread.
 *
 * Crucially, the dataset is sent **once** (a `data` message) and cached here,
 * so config changes (a `process` message) ship only a tiny config object — no
 * re-cloning the full scrobble array across the thread boundary on every
 * toggle. Per-resolution {@link Aggregation}s are memoized too, so changing
 * top-N or mode never re-scans all N scrobbles; only a fresh resolution (or a
 * new dataset) pays the scan.
 */
import {
  aggregate,
  buildFromAggregation,
  type Aggregation,
  type CountableScrobble,
} from '../utils/dataProcessor';
import type { OthersMode, ProcessedData, Resolution } from '../types';

export interface ProcessConfig {
  resolution: Resolution;
  topN: number;
  othersMode: OthersMode;
  from?: number;
  to?: number;
}

export type WorkerRequest =
  | { type: 'data'; scrobbles: CountableScrobble[] }
  | { type: 'process'; id: number; config: ProcessConfig };

export interface WorkerResponse {
  id: number;
  data?: ProcessedData;
  error?: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let dataset: CountableScrobble[] = [];
/** Memoized aggregations by resolution; cleared whenever the dataset changes. */
const aggCache = new Map<Resolution, Aggregation>();

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  if (msg.type === 'data') {
    dataset = msg.scrobbles;
    aggCache.clear();
    return;
  }

  // type === 'process'
  const { id, config } = msg;
  try {
    const { resolution, topN, othersMode, from, to } = config;
    // The full-resolution aggregation is cached; date range is applied at
    // bucket level during the (cheap) build, so a dragged range slider reuses
    // the cache instead of re-scanning all scrobbles.
    let agg: Aggregation | undefined = aggCache.get(resolution);
    if (!agg) {
      agg = aggregate(dataset, resolution);
      aggCache.set(resolution, agg);
    }
    const data = buildFromAggregation(agg, { topN, othersMode, from, to });
    ctx.postMessage({ id, data } satisfies WorkerResponse);
  } catch (err) {
    ctx.postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};

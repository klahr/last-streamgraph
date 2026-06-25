/// <reference lib="webworker" />
/**
 * Web Worker that runs the scrobble-processing pipeline off the main thread.
 *
 * The dataset is sent once (`data`), and the artist→genre map separately
 * (`genres`), so neither is re-cloned on a mere config change (`process`).
 * Per-(resolution, groupBy) {@link Aggregation}s are memoized — changing top-N,
 * date range, or mode never re-scans all N scrobbles; only a new resolution,
 * grouping, dataset, or genre map pays the scan.
 */
import {
  aggregate,
  buildFromAggregation,
  type Aggregation,
  type CountableScrobble,
} from '../utils/dataProcessor';
import { UNKNOWN_GENRE } from '../utils/genres';
import type { GroupBy, OthersMode, ProcessedData, Resolution } from '../types';

export interface ProcessConfig {
  resolution: Resolution;
  topN: number;
  othersMode: OthersMode;
  groupBy: GroupBy;
  from?: number;
  to?: number;
}

export type WorkerRequest =
  | { type: 'data'; scrobbles: CountableScrobble[] }
  | { type: 'genres'; map: Record<string, string> }
  | { type: 'process'; id: number; config: ProcessConfig };

export interface WorkerResponse {
  id: number;
  data?: ProcessedData;
  error?: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let dataset: CountableScrobble[] = [];
let genreMap: Record<string, string> = {};
/** Memoized aggregations keyed by `resolution|groupBy`. */
const aggCache = new Map<string, Aggregation>();

const genreOf = (artist: string) => genreMap[artist.toLowerCase()] ?? UNKNOWN_GENRE;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  if (msg.type === 'data') {
    dataset = msg.scrobbles;
    aggCache.clear();
    return;
  }
  if (msg.type === 'genres') {
    genreMap = msg.map;
    // Only genre-grouped aggregations depend on the map.
    for (const k of [...aggCache.keys()]) if (k.endsWith('|genre')) aggCache.delete(k);
    return;
  }

  // type === 'process'
  const { id, config } = msg;
  try {
    const { resolution, topN, othersMode, groupBy, from, to } = config;
    const cacheKey = `${resolution}|${groupBy}`;
    let agg = aggCache.get(cacheKey);
    if (!agg) {
      agg = aggregate(dataset, resolution, groupBy === 'genre' ? genreOf : undefined);
      aggCache.set(cacheKey, agg);
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

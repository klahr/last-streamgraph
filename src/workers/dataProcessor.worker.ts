/// <reference lib="webworker" />
/**
 * Web Worker that runs the (potentially heavy) scrobble-processing pipeline off
 * the main thread, so toggling config or resizing never blocks rendering.
 *
 * Protocol: post a {@link WorkerRequest}; receive a {@link WorkerResponse} tagged
 * with the same `id` so the client can correlate and drop stale results.
 */
import { processScrobbles } from '../utils/dataProcessor';
import type { ProcessedData, ProcessRequest } from '../types';

export interface WorkerRequest {
  id: number;
  payload: ProcessRequest;
}
export interface WorkerResponse {
  id: number;
  data?: ProcessedData;
  error?: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, payload } = e.data;
  try {
    const data = processScrobbles(payload);
    const res: WorkerResponse = { id, data };
    ctx.postMessage(res);
  } catch (err) {
    const res: WorkerResponse = {
      id,
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(res);
  }
};

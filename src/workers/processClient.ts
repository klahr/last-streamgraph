// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Promise-based client for the data-processing Web Worker.
 *
 * The dataset is uploaded once via {@link ProcessClient.setData}; subsequent
 * {@link ProcessClient.process} calls send only a small config object, so
 * config changes don't re-clone the (potentially huge) scrobble array across
 * the thread boundary.
 *
 * Each `process` carries a monotonic id; only the latest in-flight request
 * resolves — superseded ones reject with {@link StaleRequestError} the caller
 * can ignore. So rapid config changes (dragging the artist-limit slider) never
 * pile up work.
 */
import type { ProcessedData } from '../types';
import type {
  ProcessConfig,
  WorkerRequest,
  WorkerResponse,
} from './dataProcessor.worker';
import type { CountableScrobble } from '../utils/dataProcessor';

export class StaleRequestError extends Error {
  constructor() {
    super('superseded by a newer processing request');
    this.name = 'StaleRequestError';
  }
}

export class ProcessClient {
  private worker: Worker;
  private nextId = 1;
  private latestId = 0;
  private pending = new Map<
    number,
    { resolve: (d: ProcessedData) => void; reject: (e: Error) => void }
  >();

  constructor() {
    this.worker = new Worker(
      new URL('./dataProcessor.worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const { id, data, error } = e.data;
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      // Ignore everything but the most recent request.
      if (id !== this.latestId) {
        entry.reject(new StaleRequestError());
        return;
      }
      if (error) entry.reject(new Error(error));
      else if (data) entry.resolve(data);
    };
    this.worker.onerror = (e: ErrorEvent) => {
      // A worker load failure or uncaught throw leaves message-less: every
      // pending request's promise would hang (and `processing` spin forever).
      // Reject them all so callers fall back to the stale/error path.
      const err = new Error(e.message || 'data worker error');
      for (const [, entry] of this.pending) entry.reject(err);
      this.pending.clear();
    };
  }

  /** Upload the dataset to the worker (clears its per-resolution cache). */
  setData(scrobbles: CountableScrobble[]): void {
    this.worker.postMessage({ type: 'data', scrobbles } satisfies WorkerRequest);
  }

  /** Upload the artist→genre map (clears cached genre-grouped aggregations). */
  setGenres(map: Record<string, string>): void {
    this.worker.postMessage({ type: 'genres', map } satisfies WorkerRequest);
  }

  /** Process the already-uploaded dataset with the given config. */
  process(config: ProcessConfig): Promise<ProcessedData> {
    const id = this.nextId++;
    this.latestId = id;
    // Reject any still-pending older requests up front.
    for (const [pid, entry] of this.pending) {
      if (pid !== id) {
        entry.reject(new StaleRequestError());
        this.pending.delete(pid);
      }
    }
    return new Promise<ProcessedData>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'process', id, config } satisfies WorkerRequest);
    });
  }

  terminate(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}

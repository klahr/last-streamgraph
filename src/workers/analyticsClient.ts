// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Promise-based client for the analytics Web Worker.
 *
 * Mirrors {@link ProcessClient}: the trimmed dataset and genre map are uploaded
 * once, and each `compute` carries a monotonic id so superseded requests reject
 * with {@link StaleRequestError} (rapid view/filter switches never pile up).
 */
import type { CountableScrobble } from '../utils/dataProcessor';
import type { AnalyticsRequest, WorkerRequest, WorkerResponse } from './analytics.worker';

export class StaleRequestError extends Error {
  constructor() {
    super('superseded by a newer analytics request');
    this.name = 'StaleRequestError';
  }
}

export class AnalyticsClient {
  private worker: Worker;
  private nextId = 1;
  private latestId = 0;
  private pending = new Map<number, { resolve: (d: unknown) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('./analytics.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const { id, error } = e.data;
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (id !== this.latestId) {
        entry.reject(new StaleRequestError());
        return;
      }
      if (error) entry.reject(new Error(error));
      else entry.resolve(e.data.data!.payload);
    };
    this.worker.onerror = (e: ErrorEvent) => {
      const err = new Error(e.message || 'analytics worker error');
      for (const [, entry] of this.pending) entry.reject(err);
      this.pending.clear();
    };
  }

  setData(scrobbles: CountableScrobble[]): void {
    this.worker.postMessage({ type: 'data', scrobbles } satisfies WorkerRequest);
  }

  setGenres(map: Record<string, string>): void {
    this.worker.postMessage({ type: 'genres', map } satisfies WorkerRequest);
  }

  compute(request: AnalyticsRequest): Promise<unknown> {
    const id = this.nextId++;
    this.latestId = id;
    for (const [pid, entry] of this.pending) {
      if (pid !== id) {
        entry.reject(new StaleRequestError());
        this.pending.delete(pid);
      }
    }
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'compute', id, request } satisfies WorkerRequest);
    });
  }

  terminate(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}

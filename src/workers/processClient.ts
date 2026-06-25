/**
 * Promise-based client for the data-processing Web Worker.
 *
 * A single worker is reused for the app's lifetime. Each request carries a
 * monotonic id; only the latest in-flight request resolves — superseded ones
 * reject with a benign "stale" error the caller can ignore. This means rapid
 * config changes (dragging the artist-limit slider) never pile up work.
 */
import type { ProcessedData, ProcessRequest } from '../types';
import type { WorkerRequest, WorkerResponse } from './dataProcessor.worker';

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
  }

  process(payload: ProcessRequest): Promise<ProcessedData> {
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
      const msg: WorkerRequest = { id, payload };
      this.worker.postMessage(msg);
    });
  }

  terminate(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}

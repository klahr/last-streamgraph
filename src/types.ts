/**
 * Shared domain types for the Last Streamgraph app.
 */

/** A single play of a track, as persisted in IndexedDB. */
export interface Scrobble {
  /** Composite primary key: `${user}::${uts}::${artist}::${track}`. */
  id: string;
  /** Lowercased username this scrobble belongs to (enables multi-user caches). */
  user: string;
  artist: string;
  album: string;
  track: string;
  /** Play time as Unix epoch seconds (Last.fm `date.uts`). */
  uts: number;
}

export type Resolution = 'weekly' | 'monthly' | 'yearly';
export type StreamMode = 'absolute' | 'relative';
/** What to do with artists that fall outside the top-N. */
export type OthersMode = 'group' | 'discard';

export type PaletteId =
  | 'warm'
  | 'cool'
  | 'viridis'
  | 'turbo'
  | 'rainbow'
  | 'spectral';

/** User-tunable visualization configuration. */
export interface VizConfig {
  resolution: Resolution;
  mode: StreamMode;
  topN: number;
  othersMode: OthersMode;
  palette: PaletteId;
}

/** Last.fm credentials, persisted to localStorage. */
export interface Credentials {
  apiKey: string;
  username: string;
}

/**
 * Persisted, per-user sync watermarks. Last.fm serves plays newest-first, so a
 * single `newestUts` watermark only guards the *new* end of history — a partial
 * first sync leaves a gap at the *old* end. Tracking both ends plus a
 * completion flag makes sync fully resumable after an abort:
 *  - forward fill: fetch plays at/after `newestUts` (new since last visit);
 *  - backfill: fetch plays at/before `oldestUts` until exhausted.
 */
export interface SyncState {
  user: string;
  /** Highest cached uts (epoch seconds), or null if nothing cached. */
  newestUts: number | null;
  /** Lowest cached uts reached by backfill so far, or null. */
  oldestUts: number | null;
  /** True once backfill has walked all the way to the start of history. */
  backfillComplete: boolean;
}

/** Coarse machine state of the background sync. */
export type SyncPhase = 'idle' | 'syncing' | 'done' | 'error';

export interface SyncProgress {
  phase: SyncPhase;
  page: number;
  totalPages: number;
  fetched: number;
  message: string;
  error?: string;
}

/**
 * One time bucket's worth of per-artist counts, ready for `d3.stack()`.
 * Carries the bucket start as epoch ms plus a numeric count per artist key.
 */
export interface StackDatum {
  /** Bucket start time, epoch milliseconds. */
  date: number;
  /** Human label for the X axis (e.g. "2025-01" or "2025-W03"). */
  label: string;
  /** artist key -> scrobble count in this bucket. */
  [artist: string]: number | string;
}

/** Output of the processing pipeline; fully serializable for postMessage. */
export interface ProcessedData {
  /** Ordered artist keys (stacking order, largest total first). "Others" last. */
  keys: string[];
  /** Per-bucket count matrix. */
  matrix: StackDatum[];
  /** Total scrobbles per artist key over the whole range, for the legend. */
  totals: Record<string, number>;
  /** Grand total across all buckets/keys (post-filter). */
  grandTotal: number;
}

/** Request payload sent to the processing Web Worker. */
export interface ProcessRequest {
  scrobbles: Scrobble[];
  resolution: Resolution;
  topN: number;
  othersMode: OthersMode;
  /** Optional inclusive date range filter, epoch ms. */
  from?: number;
  to?: number;
}

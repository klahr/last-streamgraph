// SPDX-License-Identifier: GPL-3.0-or-later
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
/** Whether streams represent individual artists, their genres, or albums. */
export type GroupBy = 'artist' | 'genre' | 'album';

/** Which visualization is shown. */
export type View =
  | 'streamgraph'
  | 'obsessions'
  | 'novelty'
  | 'tenure'
  | 'genrehours'
  | 'albumdepth'
  | 'sessions'
  | 'punchcard'
  | 'calendar'
  | 'seasonal'
  | 'discovery'
  | 'rankbump'
  | 'sunburst'
  | 'network'
  | 'forecast';

/** Genre assigned to an artist (derived from Last.fm top tags), cached in IDB. */
export interface ArtistGenre {
  /** Lowercased artist name (primary key). */
  artist: string;
  /** Cleaned genre label, or "Unknown" when the artist has no usable tag. */
  genre: string;
}

export type PaletteId =
  | 'blue'
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
  /** Stream by individual artists or by their genre. */
  groupBy: GroupBy;
  /** Regex filter for the forecast view (empty = top-N by play count). */
  forecastFilter: string;
  /**
   * Silence (in minutes) that separates two listening sessions. Exposed as a
   * knob because scrobbles carry no track durations, so the boundary is a
   * judgement call rather than a fact.
   */
  sessionGapMin: number;
}

/** Progress of background genre enrichment (fetching artist tags). */
export interface GenreProgress {
  running: boolean;
  done: number;
  total: number;
  message: string;
  /** Estimated ms remaining, when a rate signal is available. */
  etaMs?: number;
}

/** Quick date-window presets plus a custom slider-defined window. */
export type RangePreset =
  | 'all'
  | 'month'
  | 'year'
  | 'thisyear'
  | '5years'
  | 'custom';

/** Persisted date-range selection. Custom bounds are epoch ms. */
export interface RangeSelection {
  preset: RangePreset;
  from: number | null;
  to: number | null;
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
  /** Estimated ms remaining, when a rate signal is available. */
  etaMs?: number;
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

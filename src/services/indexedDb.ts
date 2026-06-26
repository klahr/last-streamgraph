/**
 * IndexedDB persistence layer for raw scrobbles.
 *
 * One object store (`scrobbles`) keyed by a composite id, with secondary
 * indexes on `user` and `[user, uts]` so we can cheaply find the newest cached
 * scrobble per user (the incremental-sync watermark) and stream a user's full
 * history back in time order.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ArtistGenre, Scrobble, SyncState } from '../types';

const DB_NAME = 'last-streamgraph';
const DB_VERSION = 3;
const STORE = 'scrobbles';
const SYNC_STORE = 'sync_state';
const TAGS_STORE = 'artist_tags';

interface StreamgraphDB extends DBSchema {
  scrobbles: {
    key: string;
    value: Scrobble;
    indexes: {
      by_user: string;
      'by_user_uts': [string, number];
    };
  };
  sync_state: {
    key: string;
    value: SyncState;
  };
  artist_tags: {
    key: string;
    value: ArtistGenre;
  };
}

let dbPromise: Promise<IDBPDatabase<StreamgraphDB>> | null = null;

function getDB(): Promise<IDBPDatabase<StreamgraphDB>> {
  if (!dbPromise) {
    const p = openDB<StreamgraphDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('by_user', 'user');
          store.createIndex('by_user_uts', ['user', 'uts']);
        }
        if (oldVersion < 2) {
          db.createObjectStore(SYNC_STORE, { keyPath: 'user' });
        }
        if (oldVersion < 3) {
          db.createObjectStore(TAGS_STORE, { keyPath: 'artist' });
        }
      },
    });
    // Don't cache a rejection: a failed open (quota, blocked upgrade, corrupt
    // DB) would otherwise poison every subsequent getDB() for the page's life.
    // Dropping the cached promise lets the next call retry the open.
    p.catch(() => {
      if (dbPromise === p) dbPromise = null;
    });
    dbPromise = p;
  }
  return dbPromise;
}

/** Build the composite primary key for a scrobble. */
export function scrobbleId(
  user: string,
  uts: number,
  artist: string,
  track: string,
): string {
  return `${user}::${uts}::${artist}::${track}`;
}

/**
 * Persist a batch of scrobbles. `put` is idempotent on the composite key, so
 * re-fetching overlapping pages during sync never creates duplicates.
 */
export async function putScrobbles(scrobbles: Scrobble[]): Promise<void> {
  if (scrobbles.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(STORE, 'readwrite');
  await Promise.all([
    ...scrobbles.map((s) => tx.store.put(s)),
    tx.done,
  ]);
}

/**
 * Newest cached `uts` for a user, or `null` if nothing is cached.
 * Used as the `from` watermark for incremental sync.
 */
export async function getLatestUts(user: string): Promise<number | null> {
  const db = await getDB();
  // The by_user_uts index sorts by [user, uts]; walk the upper bound backwards.
  const range = IDBKeyRange.bound([user, -Infinity], [user, Infinity]);
  const cursor = await db
    .transaction(STORE)
    .store.index('by_user_uts')
    .openCursor(range, 'prev');
  return cursor ? cursor.value.uts : null;
}

/** Load every cached scrobble for a user, ascending by uts. */
export async function getAllScrobbles(user: string): Promise<Scrobble[]> {
  const db = await getDB();
  const range = IDBKeyRange.bound([user, -Infinity], [user, Infinity]);
  return db.getAllFromIndex(STORE, 'by_user_uts', range);
}

/** Count cached scrobbles for a user. */
export async function countScrobbles(user: string): Promise<number> {
  const db = await getDB();
  return db.countFromIndex(STORE, 'by_user', user);
}

/** Wipe a single user's cached history + sync state (forces a full re-sync). */
export async function clearUser(user: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE, 'readwrite');
  let cursor = await tx.store.index('by_user').openCursor(user);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
  await db.delete(SYNC_STORE, user);
}

/** Read a user's persisted sync watermarks (defaults if none stored yet). */
export async function getSyncState(user: string): Promise<SyncState> {
  const db = await getDB();
  const rec = await db.get(SYNC_STORE, user);
  return (
    rec ?? { user, newestUts: null, oldestUts: null, backfillComplete: false }
  );
}

/** Persist a user's sync watermarks (called after every page during sync). */
export async function putSyncState(state: SyncState): Promise<void> {
  const db = await getDB();
  await db.put(SYNC_STORE, state);
}

/**
 * All cached artist→genre mappings (artist names are lowercased keys). The
 * cache is global, not per-user — a band's genre is the same for everyone.
 */
export async function getAllArtistGenres(): Promise<Record<string, string>> {
  const db = await getDB();
  const all = await db.getAll(TAGS_STORE);
  const map: Record<string, string> = {};
  for (const rec of all) map[rec.artist] = rec.genre;
  return map;
}

/** Persist a batch of artist→genre records (idempotent on artist). */
export async function putArtistGenres(records: ArtistGenre[]): Promise<void> {
  if (records.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(TAGS_STORE, 'readwrite');
  await Promise.all([...records.map((r) => tx.store.put(r)), tx.done]);
}

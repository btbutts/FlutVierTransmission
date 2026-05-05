// PollService/src/db/index.ts
// Database singleton for the PollService SQLite database.
//
// Call initDb(dataDir, migrationsDir) exactly once at startup — after the data
// directory has been created and before calling startPollService() or handling
// any API requests. All other exports assume initDb() has been called.
//
// Uses better-sqlite3 (synchronous) so every DB operation in the poll tick is a
// plain function call with no async/await overhead.

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, lt } from 'drizzle-orm';
import { join } from 'node:path';

import * as schema from './schema.js';
import { geoCache, session, torrents } from './schema.js';
import type { GeoEntry, TorrentFull } from '../types.js';

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let _db: DrizzleDb | null = null;

function db(): DrizzleDb {
  if (!_db) throw new Error('[db] initDb() must be called before using the database');
  return _db;
}

/**
 * Open (or create) the SQLite database file and run any pending migrations.
 * This is synchronous — no await needed. Migrations are tracked in the
 * __drizzle_migrations table and are a no-op once applied.
 *
 * @param dataDir       Directory where pollservice.db is stored (must already exist).
 * @param migrationsDir Directory containing the generated SQL migration files.
 */
export function initDb(dataDir: string, migrationsDir: string): void {
  const sqlite = new Database(join(dataDir, 'pollservice.db'));
  _db = drizzle(sqlite, { schema });
  migrate(_db, { migrationsFolder: migrationsDir });
  console.log('[db] initialized:', join(dataDir, 'pollservice.db'));
}

const isDev = process.env.NODE_ENV === 'development';

// ── Torrents ──────────────────────────────────────────────────────────────────

/** Upsert the full list of torrents from a full-poll tick. Synchronous. */
export function upsertTorrents(list: TorrentFull[]): void {
  const now = Date.now();
  const d = db();
  for (const t of list) {
    d.insert(torrents)
      .values({ id: t.id, data: JSON.stringify(t), updatedAt: now })
      .onConflictDoUpdate({
        target: torrents.id,
        set: { data: JSON.stringify(t), updatedAt: now }
      })
      .run();
  }
  if (isDev) {
    console.log(`[db] write  torrents - ${list.length} row${list.length !== 1 ? 's' : ''}`);
  }
}

/** Load all torrent rows from the DB and deserialize them. Synchronous. */
export function loadTorrents(): TorrentFull[] {
  const rows = db().select().from(torrents).all();
  const result = rows.map((row) => JSON.parse(row.data) as TorrentFull);
  if (isDev) {
    console.log(`[db] read   torrents - ${result.length} row${result.length !== 1 ? 's' : ''}`);
  }
  return result;
}

// ── Session ───────────────────────────────────────────────────────────────────

/** Upsert the session-get response (single row keyed to 'current'). Synchronous. */
export function upsertSession(data: Record<string, unknown>): void {
  const now = Date.now();
  const serialized = JSON.stringify(data);
  db()
    .insert(session)
    .values({ key: 'current', data: serialized, updatedAt: now })
    .onConflictDoUpdate({
      target: session.key,
      set: { data: serialized, updatedAt: now }
    })
    .run();
  if (isDev) {
    console.log(`[db] write  session  - ${serialized.length} bytes`);
  }
}

/** Load the stored session row and deserialize it. Returns null if no row exists. Synchronous. */
export function loadSession(): Record<string, unknown> | null {
  const row = db().select().from(session).where(eq(session.key, 'current')).get();
  if (!row) {
    if (isDev) console.log('[db] read   session  - miss');
    return null;
  }
  if (isDev) console.log(`[db] read   session  - hit (${row.data.length} bytes)`);
  return JSON.parse(row.data) as Record<string, unknown>;
}

// ── Geo cache ─────────────────────────────────────────────────────────────────

// Must match GEO_TTL in types.ts and CACHE_TTL in src/lib/helpers.ts (48 hours).
const GEO_TTL = 48 * 60 * 60 * 1000;

/**
 * Look up a cached geo entry by IP. Returns null if the entry does not exist
 * or has expired (older than 48 hours). Synchronous.
 */
export function getGeoCacheEntry(ip: string): GeoEntry | null {
  const row = db().select().from(geoCache).where(eq(geoCache.ip, ip)).get();
  if (!row) {
    if (isDev) console.log(`[db] geo    ${ip} - miss`);
    return null;
  }
  if (Date.now() - row.cachedAt > GEO_TTL) {
    if (isDev) console.log(`[db] geo    ${ip} - expired`);
    return null;
  }
  if (isDev) console.log(`[db] geo    ${ip} - hit`);
  return {
    countryCode: row.countryCode,
    country:     row.country,
    city:        row.city,
    regionName:  row.regionName,
    cachedAt:    row.cachedAt
  };
}

/** Write or update a geo cache entry. Synchronous. */
export function upsertGeoCacheEntry(ip: string, entry: GeoEntry): void {
  db()
    .insert(geoCache)
    .values({ ip, ...entry })
    .onConflictDoUpdate({
      target: geoCache.ip,
      set: {
        countryCode: entry.countryCode,
        country:     entry.country,
        city:        entry.city,
        regionName:  entry.regionName,
        cachedAt:    entry.cachedAt
      }
    })
    .run();
  if (isDev) {
    console.log(`[db] geo    ${ip} - cached (${entry.country})`);
  }
}

/** Delete all geo_cache rows whose cachedAt timestamp has exceeded the 48-hour TTL. Synchronous. */
export function pruneExpiredGeoEntries(): void {
  const result = db()
    .delete(geoCache)
    .where(lt(geoCache.cachedAt, Date.now() - GEO_TTL))
    .run();
  if (isDev) {
    console.log(`[db] geo    prune - ${result.changes} expired row${result.changes !== 1 ? 's' : ''} deleted`);
  }
}

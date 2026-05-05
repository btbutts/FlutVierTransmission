// PollService/src/db/schema.ts
// Drizzle ORM table definitions for the PollService SQLite database.
//
// Three tables:
//   torrents   — full TorrentFull objects as JSON blobs, keyed by Transmission torrent ID.
//                Updated on full poll ticks (~20 s). JSON blob avoids schema churn from
//                deeply nested Transmission fields (files, trackers, trackerStats, etc.).
//   session    — single-row JSON blob holding the latest session-get response.
//                key is always the literal string 'current'.
//   geo_cache  — normalized IP geolocation entries for the 48-hour server-side geo cache.
//                Normalized (not a blob) because rows are looked up by IP primary key and
//                pruned with a WHERE cached_at < ? that JSON blobs cannot serve efficiently.

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const torrents = sqliteTable('torrents', {
  id:        integer('id').primaryKey(),       // Transmission torrent ID
  data:      text('data').notNull(),           // JSON-serialized TorrentFull
  updatedAt: integer('updated_at').notNull()   // Unix ms
});

export const session = sqliteTable('session', {
  key:       text('key').primaryKey(),         // always 'current'
  data:      text('data').notNull(),           // JSON-serialized session-get response
  updatedAt: integer('updated_at').notNull()   // Unix ms
});

export const geoCache = sqliteTable('geo_cache', {
  ip:          text('ip').primaryKey(),
  countryCode: text('country_code').notNull(),
  country:     text('country').notNull(),
  city:        text('city').notNull(),
  regionName:  text('region_name').notNull(),
  cachedAt:    integer('cached_at').notNull()  // Unix ms; TTL = 48 h (GEO_TTL in types.ts)
});

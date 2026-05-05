// PollService/src/geoLookup.ts
// Server-side IP geolocation lookup with DB-backed 48-hour cache.
//
// Uses the same ip-api.com endpoint as the client-side ipGeoLookup in
// src/lib/helpers.ts. When the PollService is active, the frontend calls
// POST /api/ipgeoinfo (see index.ts) instead of hitting ip-api directly,
// so the 45 req/min rate limit is managed server-side and shared across
// all connected browser tabs / clients.
//
// An in-flight deduplication map ensures that concurrent requests for the
// same IP share a single ip-api fetch rather than each issuing their own.

import { getGeoCacheEntry, upsertGeoCacheEntry } from './db/index.js';
import type { GeoEntry } from './types.js';

// Deduplicates concurrent in-flight requests for the same IP address.
const inFlight = new Map<string, Promise<GeoEntry | null>>();

/**
 * Resolve geolocation info for a single IP address.
 *
 * Order of resolution:
 *   1. Return immediately from the DB cache if a non-expired entry exists.
 *   2. If another in-flight request for the same IP is already running, share it.
 *   3. Fetch from ip-api.com, write the result to the DB cache, then return it.
 *
 * Returns null on any fetch / parse error or when ip-api reports failure.
 */
const isDev = process.env.NODE_ENV === 'development';

export async function resolveGeoInfo(ip: string): Promise<GeoEntry | null> {
  // DB cache hit — return immediately without touching ip-api.
  // getGeoCacheEntry logs hit/miss/expired in dev.
  const cached = getGeoCacheEntry(ip);
  if (cached) return cached;

  // Reuse an in-flight promise so N concurrent callers for the same IP
  // produce exactly one ip-api request.
  const existing = inFlight.get(ip);
  if (existing) {
    if (isDev) console.log(`[geoLookup] ${ip} - deduped (request already in-flight)`);
    return existing;
  }

  const promise = (async (): Promise<GeoEntry | null> => {
    try {
      if (isDev) console.log(`[geoLookup] ${ip} - fetching from ip-api`);
      const res = await fetch(`http://ip-api.com/json/${ip}`);
      if (!res.ok) {
        if (isDev) console.log(`[geoLookup] ${ip} - ip-api HTTP ${res.status}`);
        return null;
      }
      const json = (await res.json()) as Record<string, unknown>;
      if (json['status'] !== 'success') {
        if (isDev) console.log(`[geoLookup] ${ip} - ip-api status: ${String(json['status'])}`);
        return null;
      }

      const entry: GeoEntry = {
        countryCode: (json['countryCode'] as string) ?? '',
        country:     (json['country']     as string) ?? '',
        city:        (json['city']        as string) ?? '',
        regionName:  (json['regionName']  as string) ?? '',
        cachedAt:    Date.now()
      };

      // upsertGeoCacheEntry logs the write in dev.
      upsertGeoCacheEntry(ip, entry);
      return entry;
    } catch (err) {
      if (isDev) console.log(`[geoLookup] ${ip} - fetch error:`, err);
      return null;
    } finally {
      inFlight.delete(ip);
    }
  })();

  inFlight.set(ip, promise);
  return promise;
}

// src/lib/appstate.ts
// Client-side functions for reading from and writing to the server-side appstate endpoint.
// All writes are fire-and-forget — failures are silent and never block the UI.

import { get } from 'svelte/store';

import { bandwidthHistory, type BandwidthPoint } from './stores';
import type { GeoInfo } from './types';

// Must match CACHE_KEY in helpers.ts. Not imported from there to avoid a circular dependency
// (helpers.ts imports writeAppStateGeoEntry from this module).
const GEO_CACHE_KEY = 'ip_geo_cache';

// Five minutes of bandwidth samples at one sample per second.
const BW_HISTORY_LIMIT = 300;

// localStorage key for the "Store bandwidth utilization snapshot on server" UI preference.
// Must match bwServerPrefKey in SettingsModal.svelte.
const BW_SERVER_PREF_KEY = 'flutvierStoreBandwidthOnServer';

/** Returns true (default) when the user has opted in to server-side bandwidth persistence. */
function isBandwidthServerEnabled(): boolean {
  try {
    const stored = localStorage.getItem(BW_SERVER_PREF_KEY);
    return stored !== 'false'; // unset → default true; any value other than 'false' → true
  } catch {
    return true;
  }
}

// ── Startup: load persisted state into the live app ───────────────────────────

/**
 * Fetches the server-persisted appstate and merges it into the live app:
 *   - bandwidth history is prepended to the in-memory store so the graph
 *     immediately shows the previous five minutes of data on page load.
 *   - geo cache entries are merged into localStorage so getCachedGeoLookup
 *     picks them up without any additional changes to the lookup path.
 *
 * Call once at app startup (e.g. from +layout.svelte's $effect).
 * Safe to call before the first bandwidth poll — it merges, not replaces.
 */
export async function loadAppState(): Promise<void> {
  try {
    const res = await fetch('/api/appstate');
    if (!res.ok) return;

    const state = (await res.json()) as {
      bandwidth?: BandwidthPoint[];
      geoCache?: Record<string, GeoInfo>;
    };

    // Pre-populate bandwidth history from persisted data (only when server storage is enabled).
    if (isBandwidthServerEnabled() && Array.isArray(state.bandwidth) && state.bandwidth.length > 0) {
      const now = Date.now();
      const latestServerTs = state.bandwidth[state.bandwidth.length - 1].timestamp;
      const MAX_HISTORY_MS = 12 * 60 * 60 * 1000; // matches MAX_BW_HISTORY in stores.ts

      // Ignore data that falls entirely outside the 12-hour maximum history window.
      if (latestServerTs >= now - MAX_HISTORY_MS) {
        // The in-memory bandwidth store is index-based: aggData slices the last
        // N entries by position, not by timestamp. Without gap-filling, disk data
        // from a previous session would fill the current view window and display
        // stale values as if they were live. We prevent this by inserting one
        // zero-value entry per elapsed second between the last saved sample and
        // now, so the "current" portion of the graph correctly shows zeros until
        // live polls start arriving.
        const gapSeconds = Math.min(
          Math.round((now - latestServerTs) / 1000),
          43200 // cap at the 12-hour store limit
        );
        const gapFill: BandwidthPoint[] = Array.from({ length: gapSeconds }, (_, i) => ({
          download: 0,
          upload: 0,
          timestamp: latestServerTs + (i + 1) * 1000
        }));
        const lastGapTs = latestServerTs + gapSeconds * 1000;

        bandwidthHistory.update((current) => {
          // Preserve any live samples collected before this async call resolved.
          const liveNewer = current.filter((p) => p.timestamp > lastGapTs);
          return [...state.bandwidth!, ...gapFill, ...liveNewer];
        });
      }
    }

    // Merge server geo cache into localStorage so the existing synchronous
    // getCachedGeoLookup path continues to work unchanged.
    if (state.geoCache && typeof state.geoCache === 'object') {
      try {
        const raw = localStorage.getItem(GEO_CACHE_KEY);
        const localCache: Record<string, GeoInfo> = raw ? JSON.parse(raw) : {};
        for (const [ip, info] of Object.entries(state.geoCache)) {
          const local = localCache[ip];
          // Server entry wins if it's newer (most likely on a clean browser session).
          if (!local || info.cachedAt > local.cachedAt) {
            localCache[ip] = info;
          }
        }
        localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(localCache));
      } catch {
        // localStorage may be unavailable in some environments.
      }
    }
  } catch {
    // Server unreachable or returned malformed JSON — the app works fine without persistence.
  }
}

// ── Periodic writes ────────────────────────────────────────────────────────────

/**
 * Writes the most recent BW_HISTORY_LIMIT (300) bandwidth samples to the server.
 * Call every 60 seconds from +layout.svelte's setInterval, and on beforeunload
 * with keepalive=true so the browser delivers the request even as the page closes.
 * No-ops silently if the store is empty or the server is unreachable.
 */
export async function writeAppStateBandwidth(keepalive = false): Promise<void> {
  if (!isBandwidthServerEnabled()) return;
  const points = get(bandwidthHistory).slice(-BW_HISTORY_LIMIT);
  if (!points.length) return;
  try {
    await fetch('/api/appstate', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bandwidth: points }),
      keepalive
    });
  } catch {
    // Fire-and-forget.
  }
}

// ── On-demand geo write ────────────────────────────────────────────────────────

/**
 * Persists a single geo cache entry to the server immediately after it is
 * fetched from ip-api. Called by setCachedGeoLookup in helpers.ts.
 * No-ops silently if the server is unreachable.
 */
export async function writeAppStateGeoEntry(ip: string, info: GeoInfo): Promise<void> {
  try {
    await fetch('/api/appstate', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geoCache: { [ip]: info } })
    });
  } catch {
    // Fire-and-forget.
  }
}

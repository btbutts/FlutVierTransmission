// src/lib/appstate.ts
// Client-side functions for reading from and writing to the server-side appstate endpoint.
// All writes are fire-and-forget — failures are silent and never block the UI.

import { get } from 'svelte/store';

import { bandwidthHistory, serverAvailable, serverPollingAvailable, type BandwidthPoint } from './stores';
import type { GeoInfo } from './types';

// ── Companion base URL discovery ───────────────────────────────────────────────
//
// The PollService companion is almost never on the same origin as the page.
// (Transmission's built-in web server hosts the frontend on port 9091, but the
// companion runs on a different port.)  We resolve the companion's base URL via
// a three-step sequence on first use, then cache it for the session.
//
//   Step 1 — same-origin probe: GET /api/config with a 3-second timeout.
//            Succeeds when the companion itself is serving the frontend (e.g. the
//            user is connecting directly to port 19091).
//
//   Step 2 — POJO config file: read window.POLL_SERVICE_COMPANION_CONFIG.companionPort
//            written by install.sh into static/pollServiceCompanionConfig/pollServiceConf_001.js
//            and injected via <script src> in app.html before any framework code.
//            companionPort === 0 means the companion is not installed here; skip.
//
//   Step 3 — port-offset heuristic: companion port = current page port + 10000.
//            (Transmission default 9091 → companion 19091.)  If the result exceeds
//            65535, fall back to probing port 19091 directly.
//
// The resolved base URL is cached in _companionBase for the lifetime of the page.
// An empty string means discovery is still pending or has not been attempted.

let _discoveryPromise: Promise<string> | null = null;

async function discoverCompanionBase(): Promise<string> {
  // Step 1: same-origin probe.
  try {
    const res = await fetch('/api/config', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      return ''; // companion is same-origin; relative URLs work as-is
    }
  } catch {
    // not same-origin or timed out — continue
  }

  // Step 2: POJO config file.
  const configuredPort = window.POLL_SERVICE_COMPANION_CONFIG?.companionPort ?? 0;
  if (configuredPort > 0 && configuredPort <= 65535) {
    return `${window.location.protocol}//${window.location.hostname}:${configuredPort}`;
  }

  // Step 3: port-offset heuristic.
  const currentPort = parseInt(window.location.port, 10) || (window.location.protocol === 'https:' ? 443 : 80);
  const offsetPort = currentPort + 10000;
  const companionPort = offsetPort <= 65535 ? offsetPort : 19091;
  return `${window.location.protocol}//${window.location.hostname}:${companionPort}`;
}

/**
 * Returns the companion's base URL (e.g. "http://192.168.1.10:19091") or an
 * empty string when the companion is on the same origin.  Runs discovery at
 * most once per page load and caches the result.
 */
export function getCompanionBase(): Promise<string> {
  if (!_discoveryPromise) {
    _discoveryPromise = discoverCompanionBase();
  }
  return _discoveryPromise;
}

// Must match CACHE_KEY in helpers.ts. Not imported from there to avoid a circular dependency
// (helpers.ts imports writeAppStateGeoEntry from this module).
const GEO_CACHE_KEY = 'ip_geo_cache';

// One hour of bandwidth samples sent per periodic write (one sample per second).
// Keepalive writes (on beforeunload) are capped lower to stay within the browser's
// ~64 KB keepalive payload limit.
const BW_HISTORY_LIMIT = 3600;
const BW_KEEPALIVE_LIMIT = 600;

// localStorage key for the "Store bandwidth utilization snapshot on server" UI preference.
// Must match bwServerPrefKey in SettingsModal.svelte.
const BW_SERVER_PREF_KEY = 'flutvierStoreBandwidthOnServer';

/** Returns true only when the user has explicitly opted in to server-side bandwidth persistence. */
function isBandwidthServerEnabled(): boolean {
  try {
    const stored = localStorage.getItem(BW_SERVER_PREF_KEY);
    return stored === 'true'; // unset → default false; must explicitly opt in
  } catch {
    return false;
  }
}

// ── Server detection ──────────────────────────────────────────────────────────

/**
 * Probes /api/appstate to check whether the PollService companion is reachable,
 * then updates the serverAvailable store accordingly. Unlike loadAppState(), this
 * does not load or merge any persisted data — it is a lightweight re-check
 * intended for use after the user installs the companion without refreshing the page.
 */
export async function detectPollServiceHost(): Promise<void> {
  try {
    const base = await getCompanionBase();
    const res = await fetch(`${base}/api/appstate`);
    serverAvailable.set(res.ok);
    if (res.ok) {
      try {
        const pollRes = await fetch(`${base}/api/poll-status`);
        if (pollRes.ok) {
          const status = (await pollRes.json()) as { running?: boolean };
          serverPollingAvailable.set(status.running === true);
        } else {
          serverPollingAvailable.set(false);
        }
      } catch {
        serverPollingAvailable.set(false);
      }
    } else {
      serverPollingAvailable.set(false);
    }
  } catch {
    serverAvailable.set(false);
    serverPollingAvailable.set(false);
  }
}

// ── Startup: load persisted state into the live app ───────────────────────────

/**
 * Fetches the server-persisted appstate and merges it into the live app:
 *   - bandwidth history is prepended to the in-memory store so the graph
 *     immediately shows historical data on page load (up to the stored window).
 *   - geo cache entries are merged into localStorage so getCachedGeoLookup
 *     picks them up without any additional changes to the lookup path.
 *
 * Call once at app startup (e.g. from +layout.svelte's $effect).
 * Safe to call before the first bandwidth poll — it merges, not replaces.
 */
export async function loadAppState(): Promise<void> {
  try {
    const base = await getCompanionBase();
    const res = await fetch(`${base}/api/appstate`);
    if (!res.ok) {
      serverAvailable.set(false);
      serverPollingAvailable.set(false);
      return;
    }
    serverAvailable.set(true);

    // Check whether the server-side polling agent is running.
    try {
      const pollRes = await fetch(`${base}/api/poll-status`);
      if (pollRes.ok) {
        const status = (await pollRes.json()) as { running?: boolean };
        serverPollingAvailable.set(status.running === true);
      } else {
        serverPollingAvailable.set(false);
      }
    } catch {
      serverPollingAvailable.set(false);
    }

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
        // (now - GAP_BUFFER_S), so the "current" portion of the graph correctly
        // shows zeros until live polls start arriving.
        //
        // GAP_BUFFER_S: the gap fill intentionally stops 3 seconds before "now".
        // This prevents a spike-to-zero on page load: without the buffer, the last
        // gap-fill zero would land at exactly "now", immediately before the first
        // live poll (~1 s later), and the Catmull-Rom curve would draw a visible
        // dip to zero at the right edge of the graph.
        const GAP_BUFFER_S = 3;
        const rawGapSeconds = Math.round((now - latestServerTs) / 1000);
        const gapSeconds = Math.min(Math.max(0, rawGapSeconds - GAP_BUFFER_S), 43200);
        const gapFill: BandwidthPoint[] = Array.from({ length: gapSeconds }, (_, i) => ({
          download: 0,
          upload: 0,
          timestamp: latestServerTs + (i + 1) * 1000
        }));
        const lastGapTs = latestServerTs + gapSeconds * 1000;

        bandwidthHistory.update((current) => {
          // Preserve any live samples collected before this async call resolved.
          const liveNewer = current.filter((p) => p.timestamp > lastGapTs);
          const merged = [...state.bandwidth!, ...gapFill, ...liveNewer];
          return merged.length > 43200 ? merged.slice(-43200) : merged;
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
    serverAvailable.set(false);
    serverPollingAvailable.set(false);
    // Server unreachable or returned malformed JSON — the app works fine without persistence.
  }
}

// ── Periodic writes ────────────────────────────────────────────────────────────

/**
 * Writes recent bandwidth history to the server.
 *
 * Normal writes (keepalive=false): sends the last BW_HISTORY_LIMIT samples (1 hour).
 * The server merges these with older stored history rather than replacing it, so
 * the rolling 12-hour window accumulates across multiple writes and sessions.
 *
 * Keepalive writes (keepalive=true, on beforeunload): capped at BW_KEEPALIVE_LIMIT
 * to stay within the browser's ~64 KB keepalive payload limit.
 *
 * No-ops silently if the store is empty or the server is unreachable.
 */
export async function writeAppStateBandwidth(keepalive = false): Promise<void> {
  if (!get(serverAvailable) || !isBandwidthServerEnabled()) return;
  const limit = keepalive ? BW_KEEPALIVE_LIMIT : BW_HISTORY_LIMIT;
  const points = get(bandwidthHistory).slice(-limit);
  if (!points.length) return;
  try {
    const base = await getCompanionBase();
    await fetch(`${base}/api/appstate`, {
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
  if (!get(serverAvailable)) return;
  try {
    const base = await getCompanionBase();
    await fetch(`${base}/api/appstate`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geoCache: { [ip]: info } })
    });
  } catch {
    // Fire-and-forget.
  }
}

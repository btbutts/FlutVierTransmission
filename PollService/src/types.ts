// PollService/src/types.ts
// Shared type definitions and constants for the PollService companion server.
// Mirrors the shape of data that the SvelteKit client reads/writes via /api/appstate.

export interface BandwidthPoint {
  download: number; // bytes/sec
  upload: number; // bytes/sec
  timestamp: number; // Unix ms
}

export interface GeoEntry {
  countryCode: string;
  country: string;
  city: string;
  regionName: string;
  cachedAt: number; // Unix ms
}

export interface AppState {
  bandwidth: BandwidthPoint[];
  geoCache: Record<string, GeoEntry>;
}

// Twelve hours of bandwidth at one sample per second (rolling window).
// The client sends its history in chunks; the server merges and caps at this limit.
export const BW_LIMIT = 43200;

// 48-hour geo cache TTL in milliseconds.
// Must match CACHE_TTL in src/lib/helpers.ts and GEO_TTL in the original +server.ts.
export const GEO_TTL = 48 * 60 * 60 * 1000;

// ─── Poll Agent types ─────────────────────────────────────────────────────────

/** Minimal fields from the 1-second light poll (rateDownload / rateUpload / status). */
export interface TorrentQuickStats {
  id: number;
  rateDownload: number;
  rateUpload: number;
  status: number;
}

/**
 * Full torrent record returned by the 20-second full poll.
 * Contains all fields the client UI uses; unknown additional fields are accepted
 * so the server can forward the raw Transmission RPC response without transformation.
 */
export interface TorrentFull extends TorrentQuickStats {
  [key: string]: unknown;
}

/** Response shape for GET /api/poll-status. */
export interface PollStatus {
  running: boolean;
  lastPollAt: number;
}

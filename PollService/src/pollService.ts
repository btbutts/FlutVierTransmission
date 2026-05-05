// PollService/src/pollService.ts
// Server-side Transmission RPC polling service.
//
// Mirrors the cadence and field sets of the client-side poller
// (src/lib/PollAgent/poller.ts) so the data shape the client receives from
// /api/torrents is identical to what it would produce from direct RPC calls.
//
// Poll cadence:
//   Every tick (1 s):  light poll — id / rateDownload / rateUpload / status
//   Tick 1 + every 20th tick (20 s): full poll — all torrent fields + session-get
//
// Environment variables (set before calling startPollService):
//   TRANSMISSION_URL            — full RPC URL (default: http://localhost:9091/transmission/rpc)
//   POLLSERVICE_POLL_INTERVAL_MS — override tick interval in ms (default: 1000)

import { loadSession, loadTorrents, upsertSession, upsertTorrents } from './db/index.js';
import type { PollStatus, TorrentFull, TorrentQuickStats } from './types.js';

// ── SSE client management ─────────────────────────────────────────────────────

export interface SSEstruct {
  /** Serializes `data` and writes the SSE event frame. Returns bytes written (0 on error). */
  write(eventType: string, data: unknown): number;
}

const SSEclients = new Set<SSEstruct>();

/**
 * Register an SSE client and immediately push the current torrent and session
 * state so the client is populated without waiting for the next poll tick.
 */
export function addSseClient(client: SSEstruct): void {
  SSEclients.add(client);
  if (process.env.NODE_ENV === 'development') {
    console.log(
      `SSE /api/torrents connect (${SSEclients.size} client${SSEclients.size !== 1 ? 's' : ''})`
    );
  }
  client.write('torrents', Array.from(torrentMap.values()));
  if (Object.keys(sessionData).length > 0) {
    client.write('session', sessionData);
  }
}

/** Remove an SSE client (called when the HTTP connection closes). */
export function removeSseClient(client: SSEstruct): void {
  SSEclients.delete(client);
  if (process.env.NODE_ENV === 'development') {
    console.log(
      `SSE /api/torrents disconnect (${SSEclients.size} client${SSEclients.size !== 1 ? 's' : ''} remaining)`
    );
  }
}

// ── Field sets (mirror src/lib/PollAgent/db.ts) from frontend─────────────────

const QUICK_STATS_FIELDS = ['id', 'rateDownload', 'rateUpload', 'status'];

const FULL_INFO_FIELDS = [
  'id',
  'name',
  'status',
  'percentDone',
  'totalSize',
  'sizeWhenDone',
  'rateDownload',
  'rateUpload',
  'eta',
  'downloadDir',
  'files',
  'fileStats',
  'uploadedEver',
  'downloadedEver',
  'error',
  'errorString',
  'isPrivate',
  'addedDate',
  'doneDate',
  'queuePosition',
  'uploadRatio',
  'peersSendingToUs',
  'peersGettingFromUs',
  'trackers',
  'trackerStats'
];

// ── State ─────────────────────────────────────────────────────────────────────

let intervalId: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;
let sessionId = '';
let transmissionUrl = '';
let basicAuthHeader = '';

const torrentMap = new Map<number, TorrentFull>();
let sessionData: Record<string, unknown> = {};
let lastPollAt = 0;
let running = false;

// ── Transmission RPC client ───────────────────────────────────────────────────
// Handles the X-Transmission-Session-Id CSRF header and retries once on 409.

interface transmissionResponseRPC<T> {
  result: string;
  arguments: T;
}

async function rpcCall<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const body = JSON.stringify({ method, arguments: args });

  const makeRequest = async (sid: string): Promise<Response> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (sid) headers['X-Transmission-Session-Id'] = sid;
    if (basicAuthHeader) headers['Authorization'] = basicAuthHeader;
    return fetch(transmissionUrl, { method: 'POST', headers, body });
  };

  let res = await makeRequest(sessionId);

  if (res.status === 409) {
    sessionId = res.headers.get('X-Transmission-Session-Id') ?? '';
    if (!sessionId) throw new Error('[PollService] Failed to get Transmission session ID');
    res = await makeRequest(sessionId);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => 'no body');
    throw new Error(`[PollService] HTTP ${res.status}: ${text}`);
  }

  const data = (await res.json()) as transmissionResponseRPC<T>;
  if (data.result !== 'success') throw new Error(`[PollService] RPC error: ${data.result}`);
  return data.arguments;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startPollService(): void {
  if (intervalId) return;

  transmissionUrl = process.env.TRANSMISSION_URL ?? 'http://localhost:9091/transmission/rpc';
  const intervalMs = Number(process.env.POLLSERVICE_POLL_INTERVAL_MS ?? 1000);

  // Build the Basic Auth header once at startup.
  // In dev: reads VITE_-prefixed vars from the repo root .env (loaded by dotenv in index.ts).
  // In production: reads unprefixed vars set in the systemd service unit.
  // Prefers the unprefixed form so production deployments don't need VITE_ keys.
  const username =
    process.env.TRANSMISSION_USERNAME ?? process.env.VITE_TRANSMISSION_USERNAME ?? '';
  const password =
    process.env.TRANSMISSION_PASSWORD ?? process.env.VITE_TRANSMISSION_PASSWORD ?? '';
  if (username && password) {
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    basicAuthHeader = `Basic ${encoded}`;
  } else {
    basicAuthHeader = '';
  }

  tickCount = 0;
  running = true;

  // Warm-load from DB so the first GET/SSE response serves cached data
  // while the first Transmission poll is still in flight.
  const storedTorrents = loadTorrents();
  for (const t of storedTorrents) {
    torrentMap.set(t.id, t);
  }
  const storedSession = loadSession();
  if (storedSession) {
    sessionData = storedSession;
  }
  if (storedTorrents.length > 0) {
    console.log(`[pollService] warm-loaded ${storedTorrents.length} torrents from DB`);
  }

  intervalId = setInterval(async () => {
    tickCount++;
    const isFullPollTick = tickCount === 1 || tickCount % 20 === 0;

    try {
      if (isFullPollTick) {
        const [fullRes, sessionRes] = await Promise.all([
          rpcCall<{ torrents: TorrentFull[] }>('torrent-get', { fields: FULL_INFO_FIELDS }),
          rpcCall<Record<string, unknown>>('session-get')
        ]);

        for (const t of fullRes.torrents ?? []) {
          torrentMap.set(t.id, t);
        }
        sessionData = sessionRes;

        // Persist to DB on full-poll ticks only — rate fields (rateDownload,
        // rateUpload, status) are ephemeral and not worth writing every second.
        upsertTorrents(Array.from(torrentMap.values()));
        upsertSession(sessionData);
      } else {
        const quickRes = await rpcCall<{ torrents: TorrentQuickStats[] }>('torrent-get', {
          fields: QUICK_STATS_FIELDS
        });

        for (const qs of quickRes.torrents ?? []) {
          const existing = torrentMap.get(qs.id);
          if (existing) {
            torrentMap.set(qs.id, {
              ...existing,
              rateDownload: qs.rateDownload,
              rateUpload: qs.rateUpload,
              status: qs.status
            });
          }
        }
      }

      lastPollAt = Date.now();

      // Push updated data to all connected SSE clients.
      if (SSEclients.size > 0) {
        const isDev = process.env.NODE_ENV === 'development';
        const torrentList = Array.from(torrentMap.values());
        let torrentBytes = 0;
        for (const client of SSEclients) {
          torrentBytes = client.write('torrents', torrentList);
        }
        if (isDev) {
          const n = SSEclients.size;
          console.log(
            `SSE /api/torrents [torrents] - ${torrentBytes} (${n} client${n !== 1 ? 's' : ''})`
          );
        }
        if (isFullPollTick) {
          let sessionBytes = 0;
          for (const client of SSEclients) {
            sessionBytes = client.write('session', sessionData);
          }
          if (isDev) {
            const n = SSEclients.size;
            console.log(
              `SSE /api/torrents [session] - ${sessionBytes} (${n} client${n !== 1 ? 's' : ''})`
            );
          }
        }
      }
    } catch (err) {
      console.error('[PollService] tick failed:', err);
    }
  }, intervalMs);

  console.log(`[pollService] started — polling ${transmissionUrl} every ${intervalMs} ms`);
}

export function stopPollService(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    tickCount = 0;
    running = false;
    console.log('[pollService] stopped');
  }
}

export function getPollServiceState(): {
  torrents: TorrentFull[];
  session: Record<string, unknown>;
  pollStatus: PollStatus;
} {
  return {
    torrents: Array.from(torrentMap.values()),
    session: sessionData,
    pollStatus: { running, lastPollAt }
  };
}

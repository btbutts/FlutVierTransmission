// src/lib/PollAgent/pollServiceConnector.ts
// Client-side connector for the PollService server-side polling agent.
//
// Connection sequence:
//   1. connectPollService() — fetches /api/torrents and /api/session in
//      parallel (regular GETs) to populate stores immediately.
//   2. Opens a persistent SSE connection to /api/torrents with
//      Accept: text/event-stream. The server responds with
//      Content-Type: text/event-stream and pushes events in real time.
//   3. Two event types arrive on the stream:
//        torrents — JSON array of TorrentFull, pushed every ~1 s
//        session  — JSON session object, pushed every ~20 s (full poll tick)
//   4. Client processes events, updating all Svelte stores. No interval
//      polling is needed once SSE is established.
//
// Reconnection: on stream close or network error, the connector waits 3 s,
// re-fetches current state via GET, then re-establishes SSE.
//
// Table display cadence: tableDisplayTorrents is updated at most every 7 s to
// prevent sort-by-UL/DL reordering the table every second. An immediate push
// also fires when a previously-inactive torrent starts transferring.

import { getCompanionBase } from '../appstate';
import {
  bandwidthHistory,
  bandwidthLastPollTime,
  liveBandwidthRates,
  session,
  tableDisplayTorrents,
  torrents
} from '../stores';
import type { Torrent } from '../types';

const TABLE_DISPLAY_INTERVAL_MS = 7_000;
const RECONNECT_DELAY_MS = 3_000;
const BACKOFF_THRESHOLD = 10; // consecutive 304s before backing off
const BACKOFF_MS = 30_000;    // 30-second pause per backoff event

let sseAbortController: AbortController | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
// True between connectPollService() and disconnectPollService().
let active = false;

// ── 304 backoff state ─────────────────────────────────────────────────────────
// Applies to GET /api/torrents requests made during the initial fetch and after
// SSE reconnects. When the data hasn't changed the server returns 304 (correct
// ETag/caching behaviour). After BACKOFF_THRESHOLD consecutive 304s, reconnect
// attempts are delayed until the backoff window expires. A 200 clears the state.
let consecutive304s = 0;
let skipUntilMs = 0;

// ── Table display throttle ────────────────────────────────────────────────────
// Updated at most every 7 s to prevent sort-by-UL/DL from reordering rows
// every second. An immediate push fires when a previously-idle torrent
// starts transferring.

let lastTableDisplayMs = 0;
const prevInactiveIds = new Set<number>();

function maybeUpdateTableDisplay(list: Torrent[]): void {
  const now = Date.now();
  const intervalDue = now - lastTableDisplayMs >= TABLE_DISPLAY_INTERVAL_MS;
  const newlyActive = list.some(
    (t) => prevInactiveIds.has(t.id) && ((t.rateDownload ?? 0) > 0 || (t.rateUpload ?? 0) > 0)
  );
  if (intervalDue || newlyActive) {
    tableDisplayTorrents.set(list);
    lastTableDisplayMs = now;
  }
  // Rebuild inactive set for the next call.
  prevInactiveIds.clear();
  for (const t of list) {
    if ((t.rateDownload ?? 0) === 0 && (t.rateUpload ?? 0) === 0) {
      prevInactiveIds.add(t.id);
    }
  }
}

// ── Bandwidth store helpers ───────────────────────────────────────────────────

function updateBandwidthStores(list: Torrent[]): void {
  const now = Date.now();
  const dl = list.reduce((sum, t) => sum + (t.rateDownload ?? 0), 0);
  const ul = list.reduce((sum, t) => sum + (t.rateUpload ?? 0), 0);
  bandwidthHistory.update((history) => {
    const point = { download: dl, upload: ul, timestamp: now };
    const next = [...history, point];
    return next.length > 43200 ? next.slice(-43200) : next;
  });
  liveBandwidthRates.set({ download: dl, upload: ul });
  bandwidthLastPollTime.set(now);
}

// ── SSE event processing ──────────────────────────────────────────────────────

function handleSSEEvent(eventType: string, data: string): void {
  try {
    if (eventType === 'torrents') {
      const freshTorrents = JSON.parse(data) as Torrent[];
      updateBandwidthStores(freshTorrents);
      torrents.set(freshTorrents);
      maybeUpdateTableDisplay(freshTorrents);
    } else if (eventType === 'session') {
      const sessionData = JSON.parse(data) as Record<string, unknown>;
      session.set(sessionData);
    }
    // Unknown event types (e.g. 'heartbeat') are silently ignored.
  } catch (err) {
    console.error('[pollServiceConnector] SSE event parse failed:', err);
  }
}

async function consumeSSEStream(body: ReadableStream<Uint8Array>): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEventType = '';
  const dataLines: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE lines are '\n'-delimited; keep any incomplete trailing line in buffer.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line === '') {
          // Blank line — dispatch the buffered event, then reset.
          if (dataLines.length > 0) {
            handleSSEEvent(currentEventType, dataLines.join('\n'));
          }
          currentEventType = '';
          dataLines.length = 0;
        } else if (line.startsWith('event: ')) {
          currentEventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          dataLines.push(line.slice(6));
        }
        // Comment lines (start with ':') are ignored.
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Initial data fetch (regular GETs) ────────────────────────────────────────

async function doInitialFetch(): Promise<boolean> {
  try {
    const base = await getCompanionBase();
    const torrentRes = await fetch(`${base}/api/torrents`);

    if (torrentRes.status === 304) {
      // Data unchanged — the server's ETag matched the browser's cached copy.
      // Correct HTTP behaviour; back off if it keeps happening.
      consecutive304s++;
      if (consecutive304s >= BACKOFF_THRESHOLD) {
        skipUntilMs = Date.now() + BACKOFF_MS;
      }
      return false;
    }

    if (!torrentRes.ok) return false;

    // 200 response — reset backoff state.
    consecutive304s = 0;
    skipUntilMs = 0;

    // Parse torrents and fetch session in parallel now that we know torrents is fresh.
    const [freshTorrents, sessionRes] = await Promise.all([
      torrentRes.json() as Promise<Torrent[]>,
      fetch(`${base}/api/session`)
    ]);

    if (!sessionRes.ok) return false;

    const sessionData = (await sessionRes.json()) as Record<string, unknown>;

    updateBandwidthStores(freshTorrents);
    torrents.set(freshTorrents);

    // Force an immediate table display on initial load; reset the throttle timer
    // so SSE events inherit the correct baseline.
    tableDisplayTorrents.set(freshTorrents);
    lastTableDisplayMs = Date.now();
    prevInactiveIds.clear();
    for (const t of freshTorrents) {
      if ((t.rateDownload ?? 0) === 0 && (t.rateUpload ?? 0) === 0) {
        prevInactiveIds.add(t.id);
      }
    }

    session.set(sessionData);
    return true;
  } catch {
    return false;
  }
}

// ── SSE connection lifecycle ──────────────────────────────────────────────────

async function openSSE(): Promise<void> {
  if (!active) return;

  sseAbortController = new AbortController();

  try {
    const base = await getCompanionBase();
    const res = await fetch(`${base}/api/torrents`, {
      headers: { Accept: 'text/event-stream' },
      signal: sseAbortController.signal
    });

    if (!res.ok || !res.body) {
      throw new Error(`[pollServiceConnector] SSE connect failed: ${res.status}`);
    }

    // consumeSSEStream blocks until the stream closes (server or network).
    await consumeSSEStream(res.body);

    // Stream ended cleanly — schedule a reconnect.
    if (active) scheduleReconnect();
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    if (!isAbort && active) {
      console.error('[pollServiceConnector] SSE error:', err);
      scheduleReconnect();
    }
  }
}

function scheduleReconnect(): void {
  if (!active) return;
  // If a 304 backoff window is active, wait until it expires before retrying.
  // Otherwise use the standard RECONNECT_DELAY_MS.
  const delay = Math.max(RECONNECT_DELAY_MS, skipUntilMs - Date.now());
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    if (!active) return;
    doInitialFetch().then((ok) => {
      if (ok && active) openSSE();
      else if (active) scheduleReconnect();
    });
  }, delay);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function connectPollService(): void {
  if (active) return;
  active = true;

  lastTableDisplayMs = 0;
  prevInactiveIds.clear();
  consecutive304s = 0;
  skipUntilMs = 0;

  doInitialFetch().then((ok) => {
    if (ok && active) openSSE();
    else if (active) scheduleReconnect();
  });
}

export function disconnectPollService(): void {
  active = false;

  if (sseAbortController) {
    sseAbortController.abort();
    sseAbortController = null;
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  lastTableDisplayMs = 0;
  prevInactiveIds.clear();
  consecutive304s = 0;
  skipUntilMs = 0;
}

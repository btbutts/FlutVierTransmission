// PollService/src/index.ts
// Entry point for the FlutVier PollService companion server.
//
// Responsibilities:
//   - Serves the web-frontend static files from dist/web-frontend/ (same build output used in Mode A)
//   - Provides /api/appstate persistence (bandwidth history + geo cache)
//   - Provides /api/torrents, /api/session, /api/poll-status (Phase 4 polling agent)
//   - Serves 200.html as SPA fallback for all unmatched GET requests
//
// Environment variables:
//   PORT                         — listening port (default: 19091)
//   POLLSERVICE_BUILD_DIR        — path to web-frontend static files (default: ../web-frontend relative to this file)
//   POLLSERVICE_DATA_DIR         — path to data directory   (default: ../data relative to this file)
//   TRANSMISSION_URL             — Transmission RPC URL (default: http://localhost:9091/transmission/rpc)
//   POLLSERVICE_POLL_INTERVAL_MS — polling tick interval in ms (default: 1000)

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
// Load .env from the repo root (two levels above this file's runtime location).
// In dev (tsx running from PollService/src/): resolves to the repo root .env.
// In production (deployed to /opt/flutvier/pollservice/): no .env exists there,
// so dotenv silently no-ops and env vars come from the systemd service unit instead.
import dotenv from 'dotenv';
import express from 'express';
import morgan from 'morgan';

import { handleGetAppstate, handlePatchAppstate } from './appstate.js';
import { initDb } from './db/index.js';
import { resolveGeoInfo } from './geoLookup.js';
import {
  addSseClient,
  getPollServiceState,
  removeSseClient,
  startPollService,
  type SSEstruct
} from './pollService.js';
import type { AppState } from './types.js';

dotenv.config({ path: resolve(import.meta.dirname, '../../.env') });

// Resolve paths relative to the compiled output location.
//   Development (npm run build:pollservice):  dist/pollservice/ → dist/web-frontend/, dist/data/
//   Deployed (/opt/flutvier/pollservice/):    /opt/flutvier/pollservice/ → /opt/flutvier/web-frontend/, /opt/flutvier/data/
const BUILD_DIR = process.env.POLLSERVICE_BUILD_DIR ?? resolve(import.meta.dirname, '../web-frontend');
const DATA_DIR = process.env.POLLSERVICE_DATA_DIR ?? resolve(import.meta.dirname, '../data');
const PORT = Number(process.env.PORT ?? 19091);

// Ensure the data directory exists before accepting requests.
await mkdir(DATA_DIR, { recursive: true });

// Initialize the SQLite DB and run any pending migrations synchronously.
// POLLSERVICE_MIGRATIONS_DIR: set by the systemd unit in production;
// defaults to PollService/drizzle/ in dev (relative to this file's location).
const MIGRATIONS_DIR =
  process.env.POLLSERVICE_MIGRATIONS_DIR ?? resolve(import.meta.dirname, '../drizzle');
initDb(DATA_DIR, MIGRATIONS_DIR);

const app = express();

// The PATCH /api/appstate payload can carry up to BW_HISTORY_LIMIT (3600) bandwidth
// points × ~60 bytes each ≈ 216 KB — well above Express's 100 KB default. Set a
// generous limit so large bandwidth history writes never throw PayloadTooLargeError.
app.use(express.json({ limit: '4mb' }));

// ── Request logging (dev only) ────────────────────────────────────────────────
// morgan 'dev' format: colorized METHOD /path STATUS response-time ms - bytes
// Only enabled when NODE_ENV=development (set automatically by 'npm run dev').
// Production output goes to the systemd journal via stdout — kept minimal there.
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ── Static SPA files ──────────────────────────────────────────────────────────
// Serves HTML, CSS, JS, and other assets from the SPA build output.
// Registered before API routes so requests for static assets are resolved first.
app.use(express.static(BUILD_DIR));

// ── CORS for /api/* ───────────────────────────────────────────────────────────
// The web frontend is usually served by Transmission (port 9091) while the
// companion runs on a different port (e.g. 19091). Cross-origin requests are
// therefore expected and must be allowed for all /api/ routes.
app.use('/api', (_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// ── API routes ────────────────────────────────────────────────────────────────

// GET /api/config — lightweight endpoint used by the frontend as a same-origin
// probe during companion discovery. Also advertises the companion's runtime config.
app.get('/api/config', (_req, res) => {
  res.json({
    port: PORT,
    transmissionUrl: process.env.TRANSMISSION_URL ?? 'http://localhost:9091/transmission/rpc',
    pollIntervalMs: Number(process.env.POLLSERVICE_POLL_INTERVAL_MS ?? 1000)
  });
});

// GET /api/appstate — returns the full persisted state.
app.get('/api/appstate', async (_req, res) => {
  try {
    const state = await handleGetAppstate(DATA_DIR);
    res.json(state);
  } catch (err) {
    console.error('[appstate] GET failed:', err);
    res.status(500).json({ error: 'Failed to read appstate' });
  }
});

// PATCH /api/appstate — merges a partial update into the persisted state.
app.patch('/api/appstate', async (req, res) => {
  try {
    const result = await handlePatchAppstate(DATA_DIR, req.body as Partial<AppState>);
    res.json(result);
  } catch (err) {
    console.error('[appstate] PATCH failed:', err);
    res.status(500).json({ error: 'Failed to write appstate' });
  }
});

// ── Phase 4: Polling agent routes ─────────────────────────────────────────────

// GET /api/torrents — returns the latest cached torrent list, or opens an SSE
// stream when the client sends Accept: text/event-stream.
//
// SSE event types pushed over the stream:
//   torrents — JSON array of TorrentFull, sent on every poll tick (~1 s)
//   session  — JSON object of session data, sent on full poll ticks (~20 s)
//
// The current state is pushed immediately on connection so the client is
// populated without waiting for the next tick.
app.get('/api/torrents', (req, res) => {
  if (req.headers.accept?.includes('text/event-stream')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Prevent nginx/proxy buffering — events must arrive in real time.
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();

    const client: SSEstruct = {
      write(eventType: string, data: unknown): number {
        try {
          const payload = JSON.stringify(data);
          res.write(`event: ${eventType}\ndata: ${payload}\n\n`);
          return payload.length;
        } catch {
          // Write failed — client already disconnected; clean up immediately.
          removeSseClient(client);
          return 0;
        }
      }
    };

    addSseClient(client);

    req.on('close', () => {
      removeSseClient(client);
    });

    return;
  }

  const { torrents } = getPollServiceState();
  res.json(torrents);
});

// GET /api/session — returns the latest cached session data from the poll service.
// Session updates are also streamed via the /api/torrents SSE connection for
// clients that have upgraded to SSE mode.
app.get('/api/session', (_req, res) => {
  const { session } = getPollServiceState();
  res.json(session);
});

// GET /api/poll-status — returns whether the poll service is running and when it last polled.
app.get('/api/poll-status', (_req, res) => {
  const { pollStatus } = getPollServiceState();
  res.json(pollStatus);
});

// POST /api/ipgeoinfo — batch IP geolocation lookup with server-side DB cache.
// Body:     { ips: string[] }
// Response: { [ip: string]: GeoEntry }
//
// When serverPollingAvailable, the frontend calls this instead of hitting ip-api
// directly, so the 45 req/min ip-api rate limit is managed server-side and shared
// across all connected browser tabs and clients.
app.post('/api/ipgeoinfo', async (req, res) => {
  const body = req.body as { ips?: unknown };
  if (!Array.isArray(body.ips)) {
    res.status(400).json({ error: 'body.ips must be an array' });
    return;
  }
  const ips = (body.ips as unknown[]).filter((v): v is string => typeof v === 'string');
  const results = await Promise.all(
    ips.map(async (ip) => [ip, await resolveGeoInfo(ip)] as const)
  );
  const out: Record<string, unknown> = {};
  for (const [ip, info] of results) {
    if (info) out[ip] = info;
  }
  res.json(out);
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
// Must be registered after all API routes and express.static.
// Handles deep-link page refreshes by returning the SPA shell (200.html) for
// any GET request not already matched above.
app.use((req, res, next) => {
  if (req.method !== 'GET') {
    next();
    return;
  }
  res.sendFile(resolve(BUILD_DIR, '200.html'));
});

// ── Start poll service ──────────────────────────────────────────────────────────
// Must be called before app.listen so /api/poll-status immediately reflects
// running: true once the first client connects.
startPollService();

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FlutVier PollService running on http://0.0.0.0:${PORT}`);
  console.log(`  Static: ${BUILD_DIR}`);
  console.log(`  Data:   ${DATA_DIR}`);
});

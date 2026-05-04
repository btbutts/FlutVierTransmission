// PollService/src/index.ts
// Entry point for the FlutVier PollService companion server.
//
// Responsibilities (Phase 2):
//   - Serves the SPA static files from dist/spa/ (same build output used in Mode A)
//   - Provides /api/appstate persistence (bandwidth history + geo cache)
//   - Serves 200.html as SPA fallback for all unmatched GET requests
//
// Phase 4 will add /api/torrents, /api/session, and /api/poll-status once
// pollService.ts (the server-side polling agent) is implemented.
//
// Environment variables:
//   PORT                    — listening port (default: 19091)
//   POLLSERVICE_BUILD_DIR   — path to SPA static files (default: ../spa relative to this file)
//   POLLSERVICE_DATA_DIR    — path to data directory   (default: ../data relative to this file)

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import express from 'express';
import morgan from 'morgan';

import { handleGetAppstate, handlePatchAppstate } from './appstate.js';
import type { AppState } from './types.js';

// Resolve paths relative to the compiled output location.
//   Development (npm run build:pollservice):  dist/pollservice/ → dist/spa/, dist/data/
//   Deployed (/opt/flutvier/pollservice/):    /opt/flutvier/pollservice/ → /opt/flutvier/spa/, /opt/flutvier/data/
const BUILD_DIR =
  process.env.POLLSERVICE_BUILD_DIR ?? resolve(import.meta.dirname, '../spa');
const DATA_DIR =
  process.env.POLLSERVICE_DATA_DIR ?? resolve(import.meta.dirname, '../data');
const PORT = Number(process.env.PORT ?? 19091);

// Ensure the data directory exists before accepting requests.
await mkdir(DATA_DIR, { recursive: true });

const app = express();
app.use(express.json());

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

// ── API routes ────────────────────────────────────────────────────────────────

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

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FlutVier PollService running on http://0.0.0.0:${PORT}`);
  console.log(`  Static: ${BUILD_DIR}`);
  console.log(`  Data:   ${DATA_DIR}`);
});

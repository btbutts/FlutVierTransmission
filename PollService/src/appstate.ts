// PollService/src/appstate.ts
// Read/write logic for persisted application state (bandwidth history + geo cache).
//
// All functions are stateless and accept a dataDir path argument so they can be
// called from any context and tested independently of the running HTTP server.
// This is the direct port of the logic in src/routes/api/appstate/+server.ts,
// decoupled entirely from SvelteKit.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BW_LIMIT, GEO_TTL } from './types.js';
import type { AppState, GeoEntry } from './types.js';

const STATE_FILE = 'appstate.json';

export async function readState(dataDir: string): Promise<AppState> {
  try {
    const raw = await readFile(join(dataDir, STATE_FILE), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      bandwidth: Array.isArray(parsed.bandwidth) ? parsed.bandwidth : [],
      geoCache:
        parsed.geoCache && typeof parsed.geoCache === 'object' ? parsed.geoCache : {}
    };
  } catch {
    // File absent or unparseable — return a clean default state.
    return { bandwidth: [], geoCache: {} };
  }
}

export async function writeState(dataDir: string, state: AppState): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, STATE_FILE), JSON.stringify(state), 'utf-8');
}

// GET /api/appstate — returns the full persisted state.
export async function handleGetAppstate(dataDir: string): Promise<AppState> {
  return readState(dataDir);
}

// PATCH /api/appstate — merges a partial update into the persisted state.
// Accepted body shape (all fields optional):
//   { bandwidth?: BandwidthPoint[], geoCache?: Record<string, GeoEntry> }
//
// bandwidth: merged with stored history — server retains older data that predates
//   the client's earliest timestamp, then appends the client's points, capped at
//   BW_LIMIT. This preserves history from previous sessions across client reconnects.
// geoCache:  merged into the stored map; expired entries are pruned on each write.
export async function handlePatchAppstate(
  dataDir: string,
  body: Partial<AppState>
): Promise<{ ok: boolean }> {
  const state = await readState(dataDir);

  if (Array.isArray(body.bandwidth) && body.bandwidth.length > 0) {
    const clientData = body.bandwidth;
    const clientEarliestTs = clientData[0].timestamp;
    // Retain server history that predates the client's oldest point (previous sessions),
    // then append the client's data. This means repeated client writes accumulate history
    // rather than overwriting it, up to the BW_LIMIT rolling cap.
    const serverOlder = state.bandwidth.filter((p) => p.timestamp < clientEarliestTs);
    const merged = [...serverOlder, ...clientData];
    state.bandwidth = merged.length > BW_LIMIT ? merged.slice(-BW_LIMIT) : merged;
  }

  if (body.geoCache && typeof body.geoCache === 'object') {
    Object.assign(state.geoCache, body.geoCache);
    const now = Date.now();
    for (const ip of Object.keys(state.geoCache)) {
      if (now - (state.geoCache[ip] as GeoEntry).cachedAt > GEO_TTL) {
        delete state.geoCache[ip];
      }
    }
  }

  await writeState(dataDir, state);
  return { ok: true };
}

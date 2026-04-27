// src/routes/api/appstate/+server.ts
// Server-side persistence for bandwidth history and IP geo cache.
// Reads and writes ./data/appstate.json relative to the process working directory.
// All operations are atomic-safe enough for single-user, self-hosted use.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

// Five minutes of bandwidth at one sample per second.
const BW_LIMIT = 300;
// 48-hour geo cache TTL in milliseconds (matches CACHE_TTL in helpers.ts).
const GEO_TTL = 48 * 60 * 60 * 1000;

const DATA_DIR = join(process.cwd(), 'data');
const STATE_FILE = join(DATA_DIR, 'appstate.json');

interface BandwidthPoint {
  download: number;
  upload: number;
  timestamp: number;
}

interface GeoEntry {
  countryCode: string;
  country: string;
  city: string;
  regionName: string;
  cachedAt: number;
}

interface AppState {
  bandwidth: BandwidthPoint[];
  geoCache: Record<string, GeoEntry>;
}

async function readState(): Promise<AppState> {
  try {
    const raw = await readFile(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      bandwidth: Array.isArray(parsed.bandwidth) ? parsed.bandwidth : [],
      geoCache: parsed.geoCache && typeof parsed.geoCache === 'object' ? parsed.geoCache : {}
    };
  } catch {
    return { bandwidth: [], geoCache: {} };
  }
}

async function writeState(state: AppState): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state), 'utf-8');
}

// GET /api/appstate — returns the full persisted state.
export const GET: RequestHandler = async () => {
  const state = await readState();
  return json(state);
};

// PATCH /api/appstate — merges a partial update into the persisted state.
// Accepted body shape (all fields optional):
//   { bandwidth?: BandwidthPoint[], geoCache?: Record<string, GeoEntry> }
//
// bandwidth: replaces the stored array, capped at BW_LIMIT entries.
// geoCache: merged into the stored map; expired entries are pruned on each write.
export const PATCH: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as Partial<AppState>;
  const state = await readState();

  if (Array.isArray(body.bandwidth)) {
    // Keep only the most recent BW_LIMIT points.
    state.bandwidth = body.bandwidth.slice(-BW_LIMIT);
  }

  if (body.geoCache && typeof body.geoCache === 'object') {
    // Merge new entries, then prune anything older than GEO_TTL.
    Object.assign(state.geoCache, body.geoCache);
    const now = Date.now();
    for (const ip of Object.keys(state.geoCache)) {
      if (now - state.geoCache[ip].cachedAt > GEO_TTL) {
        delete state.geoCache[ip];
      }
    }
  }

  await writeState(state);
  return json({ ok: true });
};

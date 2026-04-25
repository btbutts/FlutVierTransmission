<script lang="ts">
import Icon, { addCollection } from '@iconify/svelte';
import data from '@iconify-json/flagpack/icons.json';

import {
  cancelHideSeedsTooltip,
  fetchTorrentPeers,
  hideSeedsTooltip,
  seedsTooltipStore
} from '$lib';
import type { Peer } from '$lib/types';

// Register the full flagpack icon set locally — no CDN requests needed
addCollection(data as Parameters<typeof addCollection>[0]);

interface GeoInfo {
  countryCode: string;
  country: string;
  city: string;
  regionName: string;
  cachedAt: number;
}

interface SeederEntry {
  address: string;
  geo: GeoInfo | null;
  loading: boolean;
}

const CACHE_KEY = 'ip_geo_cache';
const CACHE_TTL = 48 * 60 * 60 * 1000; // 48 hours ms

// Session-level peer cache keyed by torrentId — persists across open/close cycles
const seederCache = new Map<number, SeederEntry[]>();

let seederEntries = $state<SeederEntry[]>([]);
let activeTorrentId = $state<number | null>(null);

$effect(() => {
  const state = $seedsTooltipStore;
  if (!state) {
    seederEntries = [];
    activeTorrentId = null;
    return;
  }

  if (state.torrentId === activeTorrentId) {
    // Same torrent re-shown: restore cached entries (geo may have arrived since)
    const cached = seederCache.get(state.torrentId);
    if (cached) seederEntries = cached;
    return;
  }

  activeTorrentId = state.torrentId;
  const cached = seederCache.get(state.torrentId);
  if (cached) {
    seederEntries = cached;
  } else {
    seederEntries = [];
    loadPeers(state.torrentId);
  }
});

function getCachedGeo(ip: string): GeoInfo | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache: Record<string, GeoInfo> = JSON.parse(raw);
    const entry = cache[ip];
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > CACHE_TTL) return null;
    return entry;
  } catch {
    return null;
  }
}

function setCachedGeo(ip: string, info: GeoInfo) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const cache: Record<string, GeoInfo> = raw ? JSON.parse(raw) : {};
    cache[ip] = { ...info, cachedAt: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage may be unavailable
  }
}

async function lookupGeo(ip: string): Promise<GeoInfo | null> {
  const cached = getCachedGeo(ip);
  if (cached) return cached;
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== 'success') return null;
    const info: GeoInfo = {
      countryCode: json.countryCode ?? '',
      country: json.country ?? '',
      city: json.city ?? '',
      regionName: json.regionName ?? '',
      cachedAt: Date.now()
    };
    setCachedGeo(ip, info);
    return info;
  } catch {
    return null;
  }
}

async function loadPeers(torrentId: number) {
  let peers: Peer[];
  try {
    peers = await fetchTorrentPeers(torrentId);
  } catch {
    return;
  }

  const seeders = peers.filter((p) => p.isDownloadingFrom);

  const seen: Record<string, true> = {};
  const unique = seeders.filter((p) => {
    if (seen[p.address]) return false;
    seen[p.address] = true;
    return true;
  });

  const entries: SeederEntry[] = unique.map((p) => ({
    address: p.address,
    geo: getCachedGeo(p.address),
    loading: getCachedGeo(p.address) === null
  }));

  seederCache.set(torrentId, entries);
  if (torrentId === activeTorrentId) seederEntries = entries;

  // Async geo lookups — update entries as each result arrives
  unique.forEach(async (p, i) => {
    if (entries[i]?.geo !== null) return;
    const geo = await lookupGeo(p.address);
    const cached = seederCache.get(torrentId);
    if (cached?.[i]) {
      cached[i] = { ...cached[i], geo, loading: false };
      if (torrentId === activeTorrentId) {
        seederEntries = [...cached];
      }
    }
  });
}

function formatLocalTime(unixSeconds: number): string {
  if (!unixSeconds || unixSeconds <= 0) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(unixSeconds * 1000));
}
</script>

{#if $seedsTooltipStore}
  {@const state = $seedsTooltipStore}
  {@const bestTracker = (() => {
    if (!state.trackerStats?.length) return null;
    const succeeded = state.trackerStats.filter((t) => t.lastAnnounceSucceeded);
    const pool = succeeded.length > 0 ? succeeded : state.trackerStats;
    return pool.reduce((best, t) => (t.lastAnnounceTime > best.lastAnnounceTime ? t : best));
  })()}

  <div
    role="tooltip"
    class="fixed z-[9999] min-w-[240px] max-w-[340px] rounded-xl border border-gray-200/60 bg-white/95 p-3 text-xs shadow-2xl backdrop-blur-md dark:border-gray-700/60 dark:bg-gray-900/95 dark:text-gray-100"
    style="left: {Math.max(8, Math.min(state.x - 4, window.innerWidth - 352))}px; {state.above
      ? `bottom: ${window.innerHeight - state.y}px;`
      : `top: ${state.y}px;`}"
    onmouseenter={cancelHideSeedsTooltip}
    onmouseleave={hideSeedsTooltip}
  >
    <!-- Seeder counts -->
    <div class="space-y-0.5 text-gray-700 dark:text-gray-200">
      <div class="flex justify-between gap-4">
        <span class="text-gray-500 dark:text-gray-400">Connected Seeders:</span>
        <span class="font-medium">{state.seederCount}</span>
      </div>
      <div class="flex justify-between gap-4">
        <span class="text-gray-500 dark:text-gray-400">Max Available Seeders:</span>
        <span class="font-medium">{state.maxSeeders >= 0 ? state.maxSeeders : '—'}</span>
      </div>
    </div>

    <!-- Divider -->
    <div class="my-2 border-t border-gray-200/60 dark:border-gray-700/60"></div>

    <!-- Tracker announce info -->
    {#if bestTracker}
      <div class="space-y-0.5 text-gray-700 dark:text-gray-200">
        <div class="flex justify-between gap-4">
          <span class="text-gray-500 dark:text-gray-400">Confirmed by tracker:</span>
          <span
            class="font-medium {bestTracker.lastAnnounceSucceeded
              ? 'text-green-600 dark:text-green-400'
              : 'text-red-500 dark:text-red-400'}"
          >
            {bestTracker.lastAnnounceSucceeded ? 'Yes' : 'No'}
          </span>
        </div>
        <div class="flex justify-between gap-4">
          <span class="text-gray-500 dark:text-gray-400">Last Tracker Update:</span>
          <span class="font-medium">{formatLocalTime(bestTracker.lastAnnounceTime)}</span>
        </div>
        <div class="flex justify-between gap-4">
          <span class="text-gray-500 dark:text-gray-400">Next Tracker Update:</span>
          <span class="font-medium">{formatLocalTime(bestTracker.nextAnnounceTime)}</span>
        </div>
      </div>
    {:else}
      <div class="text-gray-500 dark:text-gray-400">No tracker data available.</div>
    {/if}

    <!-- Seeder peer list -->
    {#if seederEntries.length > 0}
      <div class="my-2 border-t border-gray-200/60 dark:border-gray-700/60"></div>
      <div class="space-y-2">
        {#each seederEntries as entry (entry.address)}
          <div class="flex items-start gap-2">
            <!-- Flag, top-aligned with the IP text via mt-[1px] -->
            <div class="mt-[1px] flex-shrink-0">
              {#if entry.geo?.countryCode}
                <Icon
                  icon={`flagpack:${entry.geo.countryCode.toLowerCase()}`}
                  width="20"
                  height="15"
                  style="border-radius: 1.5px;"
                />
              {:else}
                <div
                  class="h-[15px] w-[20px] rounded-sm bg-gray-200 dark:bg-gray-700 {entry.loading
                    ? 'animate-pulse'
                    : ''}"
                ></div>
              {/if}
            </div>
            <!-- IP + locality -->
            <div class="min-w-0 leading-snug text-gray-700 dark:text-gray-200">
              <div class="font-mono font-medium">{entry.address}</div>
              {#if entry.geo}
                {#if entry.geo.city || entry.geo.regionName}
                  <div class="text-gray-500 dark:text-gray-400">
                    {[entry.geo.city, entry.geo.regionName].filter(Boolean).join(', ')}
                  </div>
                {/if}
                {#if entry.geo.country}
                  <div class="text-gray-500 dark:text-gray-400">{entry.geo.country}</div>
                {/if}
              {:else if entry.loading}
                <div class="text-gray-400 italic dark:text-gray-500">Looking up location…</div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {:else if activeTorrentId !== null && seederEntries.length === 0}
      <div class="my-2 border-t border-gray-200/60 dark:border-gray-700/60"></div>
      <div class="text-gray-400 italic dark:text-gray-500">No active seeder connections.</div>
    {/if}
  </div>
{/if}

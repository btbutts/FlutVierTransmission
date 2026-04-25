<script lang="ts">
import Icon, { addCollection } from '@iconify/svelte';
import data from '@iconify-json/flagpack/icons.json';

import { fetchTorrentPeers } from '$lib';
import { InformationVariantCircleOutline } from '$lib/plugins';
import type { Peer, TrackerStat } from '$lib/types';

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

interface Props {
  torrentId: number;
  seederCount: number;
  maxSeeders: number;
  trackerStats: TrackerStat[];
}

let { torrentId, seederCount, maxSeeders, trackerStats }: Props = $props();

let showTooltip = $state(false);
let tooltipX = $state(0);
let tooltipY = $state(0);
let tooltipAbove = $state(true);
let iconEl = $state<HTMLButtonElement | null>(null);
let seederEntries = $state<SeederEntry[]>([]);
let peersRequested = $state(false);

const CACHE_KEY = 'ip_geo_cache';
const CACHE_TTL = 48 * 60 * 60 * 1000; // 48 hours in ms

// Pick the most informative tracker: prefer one that last announced successfully,
// then the one with the most recent lastAnnounceTime.
const bestTracker = $derived(
  (() => {
    if (!trackerStats || trackerStats.length === 0) return null;
    const succeeded = trackerStats.filter((t) => t.lastAnnounceSucceeded);
    const pool = succeeded.length > 0 ? succeeded : trackerStats;
    return pool.reduce((best, t) =>
      t.lastAnnounceTime > best.lastAnnounceTime ? t : best
    );
  })()
);

function formatLocalTime(unixSeconds: number): string {
  if (!unixSeconds || unixSeconds <= 0) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(unixSeconds * 1000));
}

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
    // localStorage may be unavailable (private browsing, etc.)
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

async function loadPeers() {
  let peers: Peer[];
  try {
    peers = await fetchTorrentPeers(torrentId);
  } catch {
    return;
  }

  const seeders = peers.filter((p) => p.isDownloadingFrom);

  // Deduplicate by address
  const seen: Record<string, true> = {};
  const unique = seeders.filter((p) => {
    if (seen[p.address]) return false;
    seen[p.address] = true;
    return true;
  });

  // Initialise entries immediately so the tooltip shows IPs right away
  seederEntries = unique.map((p) => ({
    address: p.address,
    geo: getCachedGeo(p.address),
    loading: !getCachedGeo(p.address)
  }));

  // Fire off geo lookups asynchronously; update each entry as results arrive
  unique.forEach(async (p, i) => {
    if (seederEntries[i]?.geo !== null) return; // already cached, skip fetch
    const geo = await lookupGeo(p.address);
    if (seederEntries[i]) {
      seederEntries[i] = { ...seederEntries[i], geo, loading: false };
    }
  });
}

function positionTooltip() {
  if (!iconEl) return;
  const rect = iconEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const estimatedHeight = 260;
  tooltipAbove = spaceBelow < estimatedHeight && rect.top > estimatedHeight;
  tooltipX = rect.left;
  tooltipY = tooltipAbove ? rect.top - 8 : rect.bottom + 8;
}

function handleMouseEnter() {
  positionTooltip();
  showTooltip = true;
  if (!peersRequested) {
    peersRequested = true;
    loadPeers();
  }
}

function handleMouseLeave() {
  showTooltip = false;
}
</script>

<!-- Info icon button — only this activates the tooltip -->
<button
  bind:this={iconEl}
  type="button"
  class="inline-flex cursor-default items-center text-current transition-colors hover:text-blue-500"
  aria-label="Seeder details"
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  onfocus={handleMouseEnter}
  onblur={handleMouseLeave}
>
  <InformationVariantCircleOutline class="h-[1.5em] w-[1.5em]" />
</button>

{#if showTooltip}
  <!-- Fixed-position tooltip: escapes table overflow:hidden -->
  <div
    role="tooltip"
    class="fixed z-[9999] min-w-[240px] max-w-[340px] rounded-xl border border-gray-200/60 bg-white/95 p-3 text-xs shadow-2xl backdrop-blur-md dark:border-gray-700/60 dark:bg-gray-900/95 dark:text-gray-100"
    style="left: {tooltipX}px; {tooltipAbove
      ? `bottom: ${window.innerHeight - tooltipY}px;`
      : `top: ${tooltipY}px;`} transform: translateX(-4px);"
    onmouseenter={() => (showTooltip = true)}
    onmouseleave={handleMouseLeave}
  >
    <!-- Seeder counts -->
    <div class="space-y-0.5 text-gray-700 dark:text-gray-200">
      <div class="flex justify-between gap-4">
        <span class="text-gray-500 dark:text-gray-400">Connected Seeders:</span>
        <span class="font-medium">{seederCount}</span>
      </div>
      <div class="flex justify-between gap-4">
        <span class="text-gray-500 dark:text-gray-400">Max Available Seeders:</span>
        <span class="font-medium">{maxSeeders >= 0 ? maxSeeders : '—'}</span>
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

    <!-- Seeder peers section -->
    {#if seederEntries.length > 0}
      <div class="my-2 border-t border-gray-200/60 dark:border-gray-700/60"></div>
      <div class="space-y-2">
        {#each seederEntries as entry (entry.address)}
          <div class="flex items-start gap-2">
            <!-- Flag icon, top-aligned with the IP text -->
            <div class="mt-[1px] flex-shrink-0">
              {#if entry.geo?.countryCode}
                <Icon
                  icon={`flagpack:${entry.geo.countryCode.toLowerCase()}`}
                  width="20"
                  height="15"
                  style="border-radius: 1.5px;"
                />
              {:else}
                <!-- Placeholder while loading or if geo failed -->
                <div
                  class="h-[15px] w-[20px] rounded-sm bg-gray-200 dark:bg-gray-700 {entry.loading
                    ? 'animate-pulse'
                    : ''}"
                ></div>
              {/if}
            </div>
            <!-- IP + locality info -->
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
    {:else if peersRequested}
      <div class="my-2 border-t border-gray-200/60 dark:border-gray-700/60"></div>
      <div class="text-gray-400 italic dark:text-gray-500">No active seeder connections.</div>
    {/if}
  </div>
{/if}

<script lang="ts">
import { SvelteMap } from 'svelte/reactivity';
import data from '@iconify-json/flagpack/icons.json';
import Icon, { addCollection } from '@iconify/svelte';
import {
  cancelHidePeersTooltip,
  fetchTorrentPeers,
  getCachedGeoLookup,
  hidePeersTooltip,
  ipGeoLookup,
  peersTooltipStore
} from '$lib';

import type { Peer, PeerEntry } from '$lib/types';

// Register the full flagpack icon set locally — no CDN requests needed
addCollection(data as Parameters<typeof addCollection>[0]);

// Session-level peer cache keyed by `${torrentId}:${mode}` — persists across open/close cycles
const peerEntryCache = new SvelteMap<string, PeerEntry[]>();

let peerEntries = $state<PeerEntry[]>([]);
// Composite key tracks which torrent + mode is currently active
let activeKey = $state<string | null>(null);

$effect(() => {
  const state = $peersTooltipStore;
  if (!state) {
    peerEntries = [];
    activeKey = null;
    return;
  }

  const key = `${state.torrentId}:${state.mode}`;

  if (key === activeKey) {
    // Same torrent + mode re-shown: restore cached entries (geo may have arrived since)
    const cached = peerEntryCache.get(key);
    if (cached) peerEntries = cached;
    return;
  }

  activeKey = key;
  const cached = peerEntryCache.get(key);
  if (cached) {
    peerEntries = cached;
  } else {
    peerEntries = [];
    loadPeers(state.torrentId, state.mode);
  }
});

async function loadPeers(torrentId: number, mode: 'seeders' | 'leechers') {
  let peers: Peer[];
  try {
    peers = await fetchTorrentPeers(torrentId);
  } catch {
    return;
  }

  // Seeders = peers sending data TO us (isDownloadingFrom); Leechers = peers we upload TO (isUploadingTo)
  const filtered =
    mode === 'seeders'
      ? peers.filter((p) => p.isDownloadingFrom)
      : peers.filter((p) => p.isUploadingTo);

  const seen: Record<string, true> = {};
  const unique = filtered.filter((p) => {
    if (seen[p.address]) return false;
    seen[p.address] = true;
    return true;
  });

  const entries: PeerEntry[] = unique.map((p) => ({
    address: p.address,
    geo: getCachedGeoLookup(p.address),
    loading: getCachedGeoLookup(p.address) === null
  }));

  const key = `${torrentId}:${mode}`;
  peerEntryCache.set(key, entries);
  if (key === activeKey) peerEntries = entries;

  // Async geo lookups — update entries as each result arrives
  unique.forEach(async (p, i) => {
    if (entries[i]?.geo !== null) return;
    const geo = await ipGeoLookup(p.address);
    const cached = peerEntryCache.get(key);
    if (cached?.[i]) {
      cached[i] = { ...cached[i], geo, loading: false };
      if (key === activeKey) {
        peerEntries = [...cached];
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

{#if $peersTooltipStore}
  {@const state = $peersTooltipStore}
  {@const isSeeders = state.mode === 'seeders'}
  {@const bestTracker = (() => {
    if (!state.trackerStats?.length) return null;
    const succeeded = state.trackerStats.filter((t) => t.lastAnnounceSucceeded);
    const pool = succeeded.length > 0 ? succeeded : state.trackerStats;
    return pool.reduce((best, t) => (t.lastAnnounceTime > best.lastAnnounceTime ? t : best));
  })()}

  <div
    role="tooltip"
    class="fixed z-[9999] max-w-[340px] min-w-[240px] rounded-xl border border-gray-200/60 bg-white/95 p-3 text-xs shadow-2xl backdrop-blur-md dark:border-gray-700/60 dark:bg-gray-900/95 dark:text-gray-100"
    style="left: {Math.max(8, Math.min(state.x - 4, window.innerWidth - 352))}px; {state.above
      ? `bottom: ${window.innerHeight - state.y}px;`
      : `top: ${state.y}px;`}"
    onmouseenter={cancelHidePeersTooltip}
    onmouseleave={hidePeersTooltip}
  >
    <!-- Peer counts -->
    <div class="space-y-0.5 text-gray-700 dark:text-gray-200">
      <div class="flex justify-between gap-4">
        <span class="text-gray-500 dark:text-gray-400">
          {isSeeders ? 'Connected Seeders:' : 'Connected Leechers:'}
        </span>
        <span class="font-medium">{state.activePeerCount}</span>
      </div>
      <div class="flex justify-between gap-4">
        <span class="text-gray-500 dark:text-gray-400">
          {isSeeders ? 'Max Available Seeders:' : 'Max Available Leechers:'}
        </span>
        <span class="font-medium">{state.maxPeerCount >= 0 ? state.maxPeerCount : '—'}</span>
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

    <!-- Peer list -->
    {#if peerEntries.length > 0}
      <div class="my-2 border-t border-gray-200/60 dark:border-gray-700/60"></div>
      <div class="space-y-2">
        {#each peerEntries as entry (entry.address)}
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
    {:else if activeKey !== null && peerEntries.length === 0}
      <div class="my-2 border-t border-gray-200/60 dark:border-gray-700/60"></div>
      <div class="text-gray-400 italic dark:text-gray-500">
        {isSeeders ? 'No active seeder connections.' : 'No active leecher connections.'}
      </div>
    {/if}
  </div>
{/if}

<script lang="ts">
  import { onMount } from 'svelte';
  import { refreshAll, torrents, isLoading, error } from '$lib/stores';
  //import type { Torrent } from '$lib/types';

  onMount(() => {
    refreshAll();
  });
</script>

<div class="p-8 max-w-7xl mx-auto">
  <h1 class="text-4xl font-bold mb-2">FlutVierTransmission</h1>
  <p class="text-gray-600 mb-8">Svelte 5 + TypeScript rewrite of Flood for Transmission</p>

  {#if $error}
    <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
      {$error}
      <button onclick={refreshAll} class="ml-4 underline">Retry</button>
    </div>
  {/if}

  <div class="flex justify-between items-center mb-6">
    <button 
      onclick={refreshAll}
      disabled={$isLoading}
      class="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
    >
      {$isLoading ? 'Refreshing...' : 'Refresh Torrents'}
    </button>
    <div class="text-sm text-gray-500">
      {$torrents.length} torrents loaded
    </div>
  </div>

  {#if $torrents.length === 0}
    <p class="text-gray-500">No torrents found. Add one using the toolbar (coming soon).</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="min-w-full border-collapse border border-gray-300">
        <thead>
          <tr class="bg-gray-100">
            <th class="border p-3 text-left">Name</th>
            <th class="border p-3 text-right">Progress</th>
            <th class="border p-3 text-right">Size</th>
            <th class="border p-3 text-right">Down</th>
            <th class="border p-3 text-right">Up</th>
          </tr>
        </thead>
        <tbody>
          {#each $torrents as torrent (torrent.id)}
            <tr class="border-b hover:bg-gray-50">
              <td class="border p-3">{torrent.name}</td>
              <td class="border p-3 text-right">{(torrent.percentDone * 100).toFixed(1)}%</td>
              <td class="border p-3 text-right">{(torrent.totalSize / (1024*1024*1024)).toFixed(2)} GB</td>
              <td class="border p-3 text-right">{(torrent.rateDownload / 1024).toFixed(1)} KB/s</td>
              <td class="border p-3 text-right">{(torrent.rateUpload / 1024).toFixed(1)} KB/s</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
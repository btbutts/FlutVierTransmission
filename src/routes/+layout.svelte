<script lang="ts">
  import './+layout.css';
  import { refreshAll, torrents, session, isLoading, error, addTorrent, performActionAndRefresh, selectedTorrents } from '$lib';
  import type { Torrent } from '$lib';

  let addModalOpen = $state(false);
  let newTorrentUrl = $state('');
  let { children } = $props();

  async function handleAdd() {
    if (newTorrentUrl.trim()) {
      try {
        await addTorrent(newTorrentUrl);
        newTorrentUrl = '';
        addModalOpen = false;
        await refreshAll();
      } catch (err: unknown) {
        error.set(err instanceof Error ? err.message : 'Add failed');
      }
    }
  }

  $effect(() => {
    // Auto-refresh every 20s (throttled to fix setTimeout warnings; Flood-like)
    const interval = setInterval(refreshAll, 20000);
    return () => clearInterval(interval);
  });
</script>

<div class="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex">
  <!-- Sidebar (stats, future filters) -->
  <aside class="w-64 bg-white/80 dark:bg-gray-800/80 backdrop-blur border-r border-gray-200/50 dark:border-gray-700/50 p-6 hidden lg:block">
    <h2 class="font-bold mb-6 text-lg">Stats</h2>
    <div class="space-y-4 text-sm">
      <div>Downloaded: {Math.round((($session.downloadedEver as number) || 0) / (1024**3))} GB</div>
      <div>Uploaded: {Math.round((($session.uploadedEver as number) || 0) / (1024**3))} GB</div>
      <div>Active: {$torrents.filter((t: Torrent) => [4,5,6].includes(t.status)).length}</div>
      <div>All: {$torrents.length}</div>
      <div>Selected: {$selectedTorrents.length}</div>
    </div>
  </aside>

  <!-- Main + Toolbar -->
  <div class="flex-1 flex flex-col min-h-screen">
    <!-- Toolbar (Flood-style) -->
    <header class="bg-white/80 dark:bg-gray-800/80 backdrop-blur shadow-sm p-4 border-b border-gray-200/50 dark:border-gray-700/50 flex items-center justify-between sticky top-0 z-10">
      <div class="flex items-center space-x-4">
        <h1 class="text-2xl font-bold">FlutVierTransmission</h1>
        {#if $error}
          <div class="bg-red-100 text-red-800 px-3 py-1 rounded text-sm">{$error}</div>
        {/if}
      </div>
      <div class="flex items-center space-x-2">
        <button 
          onclick={() => (addModalOpen = true)} 
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-sm flex items-center space-x-2 text-sm font-medium"
          disabled={$isLoading}
        >
          <span>+ Add Torrent</span>
        </button>
        {#if $selectedTorrents.length > 0}
          <button onclick={() => performActionAndRefresh($selectedTorrents, 'start')} class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md shadow-sm text-sm">
            Start ({$selectedTorrents.length})
          </button>
          <button onclick={() => performActionAndRefresh($selectedTorrents, 'stop')} class="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-md shadow-sm text-sm">Stop</button>
          <button onclick={() => performActionAndRefresh($selectedTorrents, 'remove')} class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md shadow-sm text-sm">Remove</button>
        {/if}
        <button 
          onclick={refreshAll} 
          disabled={$isLoading}
          class="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-md shadow-sm flex items-center space-x-2 text-sm"
        >
          <span>{$isLoading ? 'Loading...' : 'Refresh'}</span>
        </button>
      </div>
    </header>

    <!-- Page Content (Svelte 5: children snippet) -->
    <main class="flex-1 overflow-auto p-6">
      {@render children()}
    </main>
  </div>

  <!-- Add Torrent Modal (Flood-like) -->
  {#if addModalOpen}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <h2 class="text-2xl font-bold mb-6">Add Torrent</h2>
        <div class="space-y-4">
          <input 
            bind:value={newTorrentUrl} 
            placeholder="Paste magnet link or .torrent URL" 
            class="w-full p-4 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
          />
          <div class="flex space-x-3 pt-2">
            <button 
              onclick={handleAdd} 
              disabled={!newTorrentUrl.trim()}
              class="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 px-4 rounded-xl shadow-sm transition-all"
            >
              Add Torrent
            </button>
            <button 
              onclick={() => (addModalOpen = false)} 
              class="flex-1 bg-gray-500 hover:bg-gray-600 text-white font-medium py-3 px-4 rounded-xl shadow-sm transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
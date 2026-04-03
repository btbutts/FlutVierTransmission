<script lang="ts">
  import './+layout.css';
  import { refreshAll, torrents, session, isLoading, error, addTorrent, performActionAndRefresh, selectedTorrents } from '$lib';
  import type { Torrent } from '$lib';
  import RefreshButton from '$lib/components/RefreshButton.svelte';
  import "@fontsource-variable/inter/index.css"; // Import the Inter variable font (supports weights 100-900)
  import "@fontsource/inter/400.css"; // Import static weights as additional sources for the "Inter" family
  import "@fontsource/inter/500.css";
  import "@fontsource/inter/600.css";
  import { Plus } from '$lib/plugins';

  // Sidebar stats (computed from torrents; session lacks totals)
  const totalDownloaded = $derived(Math.round($torrents.reduce((sum: number, t: Torrent) => sum + (t.downloadedEver || 0), 0) / (1024 ** 3)));
  const totalUploaded = $derived(Math.round($torrents.reduce((sum: number, t: Torrent) => sum + (t.uploadedEver || 0), 0) / (1024 ** 3)));
  const activeCount = $derived($torrents.filter((t: Torrent) => [4, 5, 6].includes(t.status)).length);

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
    // Auto-refresh every 20s
    refreshAll();
    const interval = setInterval(refreshAll, 20000);
    return () => clearInterval(interval);
  });
</script>

<style>
  /* Set Inter as the default font for the entire app */
  :global(html, body, input, textarea, button, select, *) {
    font-family: "Inter Variable", "Inter", ui-sans-serif, system-ui, -apple-system,
                 "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans",
                 "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
  }
</style>

<div>

  <!-- Toolbar: fixed to browser viewport. Always pinned regardless of horizontal scroll. -->
  <header class="fixed top-0 left-0 right-0 z-30 h-16 bg-white/80 dark:bg-gray-800/80 backdrop-blur shadow-sm border-b border-gray-200/50 dark:border-gray-700/50 flex items-center justify-between px-4 text-gray-900 dark:text-gray-100">
    <div class="flex items-center space-x-4 lg:pl-64">
      <h1 class="text-2xl font-bold">FlutVierTransmission</h1>
      {#if $error}
        <div class="bg-red-100 text-red-800 px-3 py-1 rounded text-sm">{$error}</div>
      {/if}
    </div>
    <div class="flex items-center space-x-2">
      <button
        onclick={() => (addModalOpen = true)}
        class="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded-md shadow-sm flex items-center space-x-2 text-sm text-nowrap"
        disabled={$isLoading}
      >
        <Plus class="h-4 w-4" />
        <span>Add Torrent</span>
      </button>
      {#if $selectedTorrents.length > 0}
        <button onclick={() => performActionAndRefresh($selectedTorrents, 'start')} class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md shadow-sm text-sm">
          Start ({$selectedTorrents.length})
        </button>
        <button onclick={() => performActionAndRefresh($selectedTorrents, 'stop')} class="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-md shadow-sm text-sm">Stop</button>
        <button onclick={() => performActionAndRefresh($selectedTorrents, 'remove')} class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md shadow-sm text-sm">Remove</button>
      {/if}
      <RefreshButton
        loading={$isLoading}
        onClick={refreshAll}
        buttonClass="px-4 py-2 bg-gray-700 hover:bg-gray-600 active:bg-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 dark:active:bg-gray-800 text-white rounded-md shadow-sm transition-colors text-sm text-nowrap"
      />
    </div>
  </header>

  <!-- Sidebar: fixed to viewport left, below toolbar. Table scrolls horizontally beneath it. -->
  <aside class="hidden lg:flex flex-col fixed top-16 left-0 z-20 w-64 h-[calc(100vh-4rem)] bg-white/80 dark:bg-gray-800/80 backdrop-blur border-r border-gray-200/50 dark:border-gray-700/50 p-6 text-gray-900 dark:text-gray-100">
    <h2 class="font-bold mb-6 text-lg">Stats</h2>
    <div class="space-y-4 text-sm">
      <div>Downloaded: {totalDownloaded} GB</div>
      <div>Uploaded: {totalUploaded} GB</div>
      <div>Active: {activeCount}</div>
      <div>All: {$torrents.length}</div>
      <div>Selected: {$selectedTorrents.length}</div>
    </div>
  </aside>

  <!-- Main: fixed below toolbar, right of sidebar at lg+. Horizontal scroll lives here;
       table min-width overflows this container and triggers the scrollbar. -->
  <main class="fixed top-16 left-0 right-0 bottom-0 px-6 lg:pl-[280px] py-4 flex flex-col bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100" style="overflow-x: auto; overflow-y: hidden">
    {@render children()}
  </main>

  <!-- Add Torrent Modal (Flood-like) -->
  {#if addModalOpen}
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="presentation"
      onclick={(event) => {
        if (event.target === event.currentTarget) {
          addModalOpen = false;
        }
      }}
    >
      <div class="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-2xl ring-1 ring-black/20 dark:ring-white/10 max-w-md w-full max-h-[90vh] overflow-y-auto" style="box-shadow: 0 0 0 1px rgba(0,0,0,0.15), 0 0 40px 16px rgba(0,0,0,0.65), 0 0 120px 60px rgba(0,0,0,0.5)">
        <h2 class="text-2xl font-bold mb-6 text-white">Add Torrent</h2>
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
              class="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 px-4 rounded-xl shadow-sm transition-all inline-flex items-center justify-center gap-2"
            >
              <Plus class="h-[1em] w-[1em] shrink-0" />
              <span>Add Torrent</span>
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

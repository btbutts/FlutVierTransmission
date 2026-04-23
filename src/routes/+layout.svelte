<script lang="ts">
import './+layout.css';

import {
  addTorrent,
  error,
  isLoading,
  performActionAndRefresh,
  refreshAll,
  selectedTorrents,
  torrents,
  type Torrent
} from '$lib';

import RefreshButton from '$lib/components/RefreshButton.svelte';
import SettingsButton from '$lib/components/SettingsButton.svelte';
import SettingsModal from '$lib/components/SettingsModal.svelte';
import { createHorizontalScrollSync } from '$lib/horizontalScrollSync.svelte';

import '@fontsource-variable/inter/index.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';

import { Plus } from '$lib/plugins';

// Sidebar stats (computed from torrents; session lacks totals)
const totalDownloaded = $derived(
  Math.round(
    $torrents.reduce((sum: number, t: Torrent) => sum + (t.downloadedEver || 0), 0) / 1024 ** 3
  )
);
const totalUploaded = $derived(
  Math.round(
    $torrents.reduce((sum: number, t: Torrent) => sum + (t.uploadedEver || 0), 0) / 1024 ** 3
  )
);
const activeCount = $derived($torrents.filter((t: Torrent) => [4, 5, 6].includes(t.status)).length);

let addModalOpen = $state(false);
let newTorrentUrl = $state('');
let settingsOpen = $state(false);
let { children } = $props();

const scrollSync = createHorizontalScrollSync();

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

<div>
  <!-- Toolbar: fixed to browser viewport. Always pinned regardless of horizontal scroll. -->
  <header
    class="text-ColorPalette-text-primary/80 border-ColorPalette-border-secondary/50 bg-ColorPalette-bg-secondary/80 fixed top-0 right-0 left-0 z-30 flex h-16 items-center justify-between border-b px-4 shadow-sm backdrop-blur"
  >
    <SettingsButton onclick={() => (settingsOpen = true)} class="absolute top-1/2 left-4 -translate-y-1/2" />

    <div class="flex min-w-0 flex-1 items-center justify-between pl-12 lg:pl-[264px]">
      <div class="flex min-w-0 items-center space-x-4">
        <h1 class="text-2xl font-bold">FlutVierTransmission</h1>
        {#if $error}
          <div class="rounded bg-red-100 px-3 py-1 text-sm text-red-800">{$error}</div>
        {/if}
      </div>
      <div class="flex items-center space-x-2">
        <button
          onclick={() => (addModalOpen = true)}
          class="flex items-center space-x-2 rounded-md bg-blue-600 px-4 py-2 text-sm text-nowrap text-white shadow-sm hover:bg-blue-800"
          disabled={$isLoading}
        >
          <Plus class="h-4 w-4" />
          <span>Add Torrent</span>
        </button>
        {#if $selectedTorrents.length > 0}
          <button
            onclick={() => performActionAndRefresh($selectedTorrents, 'start')}
            class="rounded-md bg-green-600 px-4 py-2 text-sm text-white shadow-sm hover:bg-green-700"
          >
            Start ({$selectedTorrents.length})
          </button>
          <button
            onclick={() => performActionAndRefresh($selectedTorrents, 'stop')}
            class="rounded-md bg-yellow-600 px-4 py-2 text-sm text-white shadow-sm hover:bg-yellow-700"
            >Stop</button
          >
          <button
            onclick={() => performActionAndRefresh($selectedTorrents, 'remove')}
            class="rounded-md bg-red-600 px-4 py-2 text-sm text-white shadow-sm hover:bg-red-700"
            >Remove</button
          >
        {/if}
        <RefreshButton
          loading={$isLoading}
          onClick={refreshAll}
          buttonClass="px-4 py-2 bg-gray-700 hover:bg-gray-600 active:bg-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 dark:active:bg-gray-800 text-ColorPalette-button-text-primary rounded-md shadow-sm transition-colors text-sm text-nowrap"
        />
      </div>
    </div>
  </header>

  <!-- Sidebar: fixed to viewport left, below toolbar. Table scrolls horizontally beneath it. -->
  <aside
    class="border-ColorPalette-border-secondary/50 bg-ColorPalette-bg-secondary/80 text-ColorPalette-text-primary/80 fixed top-16 left-0 z-20 hidden h-[calc(100vh-4rem)] w-64 flex-col border-r p-6 backdrop-blur lg:flex"
  >
    <h2 class="mb-6 text-lg font-bold">Stats</h2>
    <div class="space-y-4 text-sm">
      <div>Downloaded: {totalDownloaded} GB</div>
      <div>Uploaded: {totalUploaded} GB</div>
      <div>Active: {activeCount}</div>
      <div>All: {$torrents.length}</div>
      <div>Selected: {$selectedTorrents.length}</div>
    </div>
  </aside>

  <!-- Main: native scrollbar hidden; scroll is mirrored to the custom scrollbar div below. -->
  <main
    bind:this={scrollSync.mainEl}
    class="main-scroll bg-ColorPalette-bg-primary text-ColorPalette-text-primary fixed top-16 right-0 bottom-0 left-0 flex flex-col px-6 py-4 lg:pl-[280px]"
    style="overflow-x: auto; overflow-y: hidden"
  >
    {@render children()}
  </main>

  <!-- Custom horizontal scrollbar: starts at the sidebar's right edge (lg:left-64).
       Native scrollbar on <main> is hidden; this div's own native scrollbar is the visible one.
       Scroll position is kept in sync with <main> via the $effect above.
       Spacer width is derived from layoutMinWidth so the scroll range matches <main> exactly. -->
  <div
    bind:this={scrollSync.syncScrollEl}
    class="fixed right-0 bottom-[1.5px] left-0 lg:left-64"
    style="height: 16px; overflow-x: auto; z-index: 22;"
    aria-hidden="true"
  >
    <div style="width: {scrollSync.syncScrollerWidth}; height: 1px;"></div>
  </div>

  <!-- Add Torrent Modal -->
  {#if addModalOpen}
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onclick={(event) => {
        if (event.target === event.currentTarget) {
          addModalOpen = false;
        }
      }}
    >
      <div
        class="bg-ColorPalette-bg-secondary ring-ColorPalette-modal-ring-secondary/50 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl p-8 shadow-2xl ring-1"
        style="box-shadow: 0 0 0 1px rgba(0,0,0,0.15), 0 0 40px 16px rgba(0,0,0,0.65), 0 0 120px 60px rgba(0,0,0,0.5)"
      >
        <h2 class="text-ColorPalette-text-secondary mb-6 text-2xl font-bold">Add Torrent</h2>
        <div class="space-y-4">
          <input
            bind:value={newTorrentUrl}
            placeholder="Paste magnet link or .torrent URL"
            class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-full rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
          />
          <div class="flex space-x-3 pt-2">
            <button
              onclick={handleAdd}
              disabled={!newTorrentUrl.trim()}
              class="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 font-medium text-white shadow-sm transition-all hover:bg-blue-700 disabled:opacity-50"
            >
              <Plus class="h-[1em] w-[1em] shrink-0" />
              <span>Add Torrent</span>
            </button>
            <button
              onclick={() => (addModalOpen = false)}
              class="flex-1 rounded-md bg-gray-500 px-4 py-2 font-medium text-white shadow-sm transition-all hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Settings Modal (always mounted so theme effects run at app start) -->
  <SettingsModal bind:open={settingsOpen} />
</div>

<style>
/* Set Inter as the default font for the entire app */
:global(html, body, input, textarea, button, select, *) {
  font-family:
    'Inter Variable',
    'Inter',
    ui-sans-serif,
    system-ui,
    -apple-system,
    'Segoe UI',
    Roboto,
    'Helvetica Neue',
    Arial,
    'Noto Sans',
    'Apple Color Emoji',
    'Segoe UI Emoji',
    'Segoe UI Symbol',
    'Noto Color Emoji';
}

/* Hide <main>'s native horizontal scrollbar — the custom sync scrollbar div below replaces it. */
:global(main.main-scroll) {
  scrollbar-width: none; /* Firefox */
}
:global(main.main-scroll::-webkit-scrollbar) {
  display: none; /* Chrome / Safari / Edge */
}
</style>

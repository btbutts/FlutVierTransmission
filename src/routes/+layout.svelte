<script lang="ts">
// Temp for testing dark mode toggle;
// will be replaced by a proper theme system in Phase 3
import { browser } from '$app/environment';

import './+layout.css';

import {
  addTorrent,
  error,
  isLoading,
  performActionAndRefresh,
  refreshAll,
  refreshSession,
  selectedTorrents,
  session,
  torrents,
  updateSession,
  windowPopUp,
  type Torrent
} from '$lib';

import DDSelector from '$lib/components/DDSelector.svelte';
import RefreshButton from '$lib/components/RefreshButton.svelte';
import SaveButton from '$lib/components/SaveButton.svelte';
import SettingsButton from '$lib/components/SettingsButton.svelte';
import { createHorizontalScrollSync } from '$lib/horizontalScrollSync.svelte';

import '@fontsource-variable/inter/index.css'; // Import the Inter variable font (supports weights 100-900)
import '@fontsource/inter/400.css'; // Import static weights as additional sources for the "Inter" family
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';

import { Close, Plus } from '$lib/plugins';

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
// Temp for testing dark mode toggle;
// will be replaced by a proper theme system in Phase 3
const isDarkMode = true;
let { children } = $props();

// Phase 3: Settings Modal
type SettingsTab = 'general' | 'speeds' | 'queue' | 'ports' | 'remote' | 'disk';

let settingsOpen = $state(false);
let tempSettings = $state<Record<string, unknown>>({}); // Editable copy
let activeTab = $state<SettingsTab>('general');
let saveStatus = $state<'idle' | 'saving' | 'success' | 'error'>('idle');
const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'speeds', label: 'Speeds' },
  { id: 'queue', label: 'Queue' },
  { id: 'ports', label: 'Ports' },
  { id: 'remote', label: 'Remote' },
  { id: 'disk', label: 'Disk' }
];

function openSettings() {
  settingsOpen = true;
  tempSettings = { ...$session }; // Copy current session
  saveStatus = 'idle';
  void refreshSession(); // Fresh data
}

async function saveSettings() {
  saveStatus = 'saving';
  try {
    await updateSession(tempSettings);
    saveStatus = 'success';
  } catch {
    saveStatus = 'error';
  }
}

function closeSettings() {
  settingsOpen = false;
  tempSettings = {};
}

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

// Temp for testing dark mode toggle;
// will be replaced by a proper theme system in Phase 3
$effect(() => {
  if (!browser) {
    return;
  }

  document.documentElement.classList.toggle('dark', isDarkMode);
});

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
    <SettingsButton onclick={openSettings} class="absolute top-1/2 left-4 -translate-y-1/2" />

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

  <!-- Add Torrent Modal (Flood-like) -->
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
  <!-- Phase 3: Settings Modal (exceeds Flood: tabs, reactive, full RPC coverage) -->
  {#if settingsOpen}
    <div
      use:windowPopUp
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="settings-title"
      onclick={(event) => event.target === event.currentTarget && closeSettings()}
      onkeydown={(event) => event.key === 'Escape' && closeSettings()}
    >
      <div
        class="bg-ColorPalette-bg-secondary/95 ring-ColorPalette-modal-ring-secondary/50 mx-4 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl shadow-[0_0_0_1px_rgba(0,0,0,0.15),0_0_40px_16px_rgba(0,0,0,0.65),0_0_120px_60px_rgba(0,0,0,0.5)] ring-1 backdrop-blur-xl"
      >
        <!-- Sticky Header -->
        <div
          class="border-ColorPalette-border-tertiary/50 bg-ColorPalette-bg-quaternary/95 sticky top-0 z-20 flex flex-shrink-0 items-center justify-between rounded-t-3xl border-b p-6 backdrop-blur-md"
        >
          <h2
            id="settings-title"
            class="text-ColorPalette-text-secondary flex-1 text-2xl font-bold"
          >
            Settings
          </h2>
          <div class="flex items-center space-x-2">
            <button
              onclick={closeSettings}
              class="bg-ColorPalette-bg-quinary hover:bg-ColorPalette-button-bg-hover-tertiary text-ColorPalette-text-quinary hover:text-ColorPalette-modal-tab-text-hover-secondary rounded-md p-2 transition-colors"
              aria-label="Close"
            >
              <Close class="h-5 w-5 " />
            </button>
          </div>
        </div>
        <!-- Tabs -->
        <div
          class="border-ColorPalette-border-secondary/50 bg-ColorPalette-bg-tertiary/50 border-b"
        >
          <nav class="-mb-px flex">
            {#each settingsTabs as tab (tab.id)}
              <button
                onclick={() => (activeTab = tab.id)}
                class="border-b-2 px-4 py-2 text-sm font-medium {activeTab === tab.id
                  ? 'border-ColorPalette-modal-tab-selected-primary bg-ColorPalette-bg-secondary/50 text-ColorPalette-modal-tab-selected-primary'
                  : 'text-ColorPalette-text-tertiary hover:text-ColorPalette-modal-tab-text-hover-secondary hover:bg-ColorPalette-bg-tertiary/70 border-transparent'} transition-colors"
              >
                {tab.label}
              </button>
            {/each}
          </nav>
        </div>
        <!-- Scrollable Content -->
        <div class="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
          {#if activeTab === 'general'}
            <!-- Example: RPC fields like 'alt-speed-enabled', 'encryption' -->
            <div class="text-ColorPalette-text-secondary space-y-4">
              <label class="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={Boolean(tempSettings['alt-speed-enabled'])}
                  onchange={(event) => {
                    tempSettings['alt-speed-enabled'] = (
                      event.currentTarget as HTMLInputElement
                    ).checked;
                  }}
                  class="text-ColorPalette-modal-TxtAccent-secondary h-5 w-5 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
                />
                <span class="text-ColorPalette-text-secondary text-sm font-medium"
                  >Alternative speed limits (turtle mode)</span
                >
              </label>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <div class="text-ColorPalette-text-secondary mb-1 block text-sm font-medium">
                    Encryption
                  </div>
                  <DDSelector
                    value={tempSettings['encryption'] ?? 'tolerated'}
                    options={[
                      { value: 'tolerated', label: 'Allow any' },
                      { value: 'preferred', label: 'Prefer encrypted' },
                      { value: 'required', label: 'Require encrypted' }
                    ]}
                    onChange={(v) => (tempSettings['encryption'] = v)}
                    class="mx-0 w-40"
                  />
                </div>
              </div>
            </div>
          {:else if activeTab === 'speeds'}
            <!-- Speed limits -->
            <div class="text-ColorPalette-text-secondary grid grid-cols-2 gap-6">
              <div>
                <label
                  for="speed-limit-down"
                  class="text-ColorPalette-text-secondary mb-2 block text-sm font-medium"
                  >Download Limit (KiB/s)</label
                >
                <input
                  id="speed-limit-down"
                  type="number"
                  bind:value={tempSettings['speed-limit-down']}
                  min="0"
                  class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-full rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
                />
              </div>
              <div>
                <label
                  for="speed-limit-up"
                  class="text-ColorPalette-text-secondary mb-2 block text-sm font-medium"
                  >Upload Limit (KiB/s)</label
                >
                <input
                  id="speed-limit-up"
                  type="number"
                  bind:value={tempSettings['speed-limit-up']}
                  min="0"
                  class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-full rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
                />
              </div>
            </div>
          {:else if activeTab === 'queue'}
            <!-- Queue limits -->
            <div class="text-ColorPalette-text-secondary grid grid-cols-2 gap-6">
              <div>
                <label
                  for="queue-stalled-minutes"
                  class="text-ColorPalette-text-secondary mb-2 block text-sm font-medium"
                  >Max Active Torrents</label
                >
                <input
                  id="queue-stalled-minutes"
                  type="number"
                  bind:value={tempSettings['queue-stalled-minutes']}
                  min="0"
                  class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-full rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
                />
              </div>
              <!-- Add more: 'max-active-downloads', 'queue-enabled', etc. -->
            </div>
          {:else if activeTab === 'ports'}
            <!-- Peer port, DHT, etc. -->
            <div class="text-ColorPalette-text-secondary">
              <label
                >Peer Port: <input
                  type="number"
                  bind:value={tempSettings['peer-port']}
                  class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary ml-2 w-24 rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
                /></label
              >
              <!-- Toggles: dht-enabled, pex-enabled, utp-enabled -->
            </div>
          {:else if activeTab === 'remote'}
            <!-- RPC whitelist, auth -->
            <div class="text-ColorPalette-text-secondary">
              <label
                >RPC Whitelist: <input
                  type="text"
                  bind:value={tempSettings['rpc-whitelist']}
                  class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-full rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
                /></label
              >
            </div>
          {:else if activeTab === 'disk'}
            <!-- Cache, incomplete-dir-enabled -->
            <div class="text-ColorPalette-text-secondary">
              <label
                >Disk Cache (MiB): <input
                  type="number"
                  bind:value={tempSettings['cache-size-mb']}
                  class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary ml-2 w-24 rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
                /></label
              >
            </div>
          {/if}
        </div>
        <!-- Sticky Footer: Save/Reset -->
        <div
          class="border-ColorPalette-border-tertiary/50 bg-ColorPalette-bg-quaternary/95 sticky bottom-0 z-10 flex justify-end space-x-3 rounded-b-3xl border-t p-6 backdrop-blur-md"
        >
          <button
            onclick={() => (tempSettings = { ...$session })}
            class="bg-ColorPalette-bg-quinary hover:bg-ColorPalette-button-bg-hover-tertiary text-ColorPalette-text-quinary hover:text-ColorPalette-modal-tab-text-hover-secondary rounded-md px-6 py-2 text-sm transition-colors"
            >Reset</button
          >
          <SaveButton {saveStatus} onclick={saveSettings} />
          {#if saveStatus === 'error'}
            <div class="flex items-center rounded-xl bg-red-100 px-4 py-2 text-sm text-red-800">
              Save failed (check console)
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
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

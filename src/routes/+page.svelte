<script lang="ts">
import {
  currentTorrent,
  error,
  isLoading,
  refreshTorrent,
  updateFilePriorities,
  windowPopUp
} from '$lib';

import DDSelector from '$lib/components/DDSelector.svelte';
import PrimaryTable from '$lib/components/PrimaryTable.svelte';
import RefreshButton from '$lib/components/RefreshButton.svelte';
import { formatBytes } from '$lib/helpers';

let filePriorities = $state<Record<string, number>>({});

// Escape key closes the per-torrent files modal
$effect(() => {
  if ($currentTorrent) {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        $currentTorrent = null;
        filePriorities = {};
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }
});

async function savePriorities() {
  if ($currentTorrent && Object.keys(filePriorities).length > 0) {
    try {
      await updateFilePriorities($currentTorrent.id, filePriorities);
      await refreshTorrent($currentTorrent.id);
      filePriorities = {};
    } catch (err: unknown) {
      error.set(err instanceof Error ? err.message : 'Save failed');
    }
  }
}
</script>

<PrimaryTable />

<!-- Phase 2: Per-Torrent Files Modal -->
{#if $currentTorrent}
  <div
    use:windowPopUp
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) {
        $currentTorrent = null;
        filePriorities = {};
      }
    }}
    onkeydown={(event) => {
      if (event.key === 'Escape') {
        $currentTorrent = null;
        filePriorities = {};
      }
    }}
  >
    <div
      class="mx-4 flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white/95 ring-1 ring-white/50 ring-offset-1 ring-offset-gray-50/50 backdrop-blur-xl dark:bg-gray-800/95 dark:ring-gray-900/50 dark:ring-offset-gray-900/50"
      style="box-shadow: 0 0 0 1px rgba(0,0,0,0.15), 0 0 40px 16px rgba(0,0,0,0.65), 0 0 120px 60px rgba(0,0,0,0.5)"
    >
      <!-- Sticky Title + Buttons -->
      <div
        class="sticky top-0 z-20 flex flex-shrink-0 items-center justify-between rounded-t-3xl border-b border-gray-200/50 bg-white/95 p-8 backdrop-blur-md dark:border-gray-700/50 dark:bg-gray-800/95"
      >
        <h2
          class="max-w-none min-w-0 flex-1 pr-4 text-3xl font-bold break-words dark:text-gray-300"
          id="modal-title"
        >
          Files: {$currentTorrent.name}
        </h2>
        <div class="flex min-w-[12rem] flex-shrink-0 flex-nowrap space-x-2">
          <RefreshButton
            loading={$isLoading}
            onClick={() => refreshTorrent($currentTorrent!.id)}
            buttonClass="px-4 py-2 bg-gray-600 hover:bg-gray-700 active:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-700 dark:active:bg-gray-800 text-white rounded-lg shadow-sm transition-colors text-sm flex-shrink-0"
          />
          <button
            onclick={() => (($currentTorrent = null), (filePriorities = {}))}
            class="flex-shrink-0 rounded-lg bg-gray-500 px-4 py-2 text-sm text-white transition-colors hover:bg-gray-600"
            >Close</button
          >
          <button
            onclick={savePriorities}
            disabled={Object.keys(filePriorities).length === 0}
            class="flex-shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >Save Priorities</button
          >
        </div>
      </div>
      <!-- Scrollable Table Container -->
      <div class="min-h-0 flex-1 overflow-y-auto rounded-b-3xl px-8 pt-0 pb-8">
        <table class="w-full text-sm dark:text-white">
          <thead
            class="sticky top-0 z-10 -mx-8 border-b border-gray-200/50 bg-gray-50/95 px-8 backdrop-blur-sm dark:border-gray-700/50 dark:bg-gray-700/95"
          >
            <tr>
              <th class="p-3 text-left font-medium">Name</th>
              <th class="p-3 text-center font-medium">Size</th>
              <th class="p-3 text-center font-medium">Progress</th>
              <th class="p-3 text-center font-medium">Priority</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100/50 dark:divide-gray-700/50">
            {#each $currentTorrent.files ?? [] as file, i (i)}
              {#if $currentTorrent.fileStats?.[i]}
                {@const stat = $currentTorrent.fileStats[i]}
                <tr class="transition-colors hover:bg-gray-50/50 dark:hover:bg-gray-700/50">
                  <td class="max-w-md truncate p-3 font-medium" title={file.name}>{file.name}</td>
                  <td class="p-3 text-center">{formatBytes(file.length)}</td>
                  <td class="p-3 text-center">
                    <div
                      class="relative mx-auto h-6 w-28 overflow-hidden rounded-2xl border border-gray-200/50 bg-gray-200/90 shadow-sm dark:border-gray-700/50 dark:bg-gray-300/90"
                    >
                      <!-- Progress Fill (absolute, behind text) -->
                      <div
                        class="absolute top-0 left-0 h-full rounded-2xl bg-gradient-to-r from-green-500 to-green-600 shadow-inner transition-all duration-500 dark:from-green-700 dark:to-green-500"
                        style="width: {((stat.bytesCompleted / file.length) * 100).toFixed(1)}%"
                      ></div>
                      <!-- Percentage Text (absolute overlay, centered) -->
                      <div class="absolute inset-0 flex items-center justify-center">
                        <span
                          class="text-sm leading-none font-semibold text-green-800 dark:text-green-950"
                        >
                          {((stat.bytesCompleted / file.length) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </td>
                  <td class="p-3 text-center">
                    <DDSelector
                      value={filePriorities[i] ?? (!stat.wanted ? -2 : stat.priority)}
                      onChange={(newValue) => {
                        filePriorities = {
                          ...filePriorities,
                          [i]: newValue
                        };
                      }}
                    />
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>
{/if}

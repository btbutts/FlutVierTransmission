<!-- src/lib/components/TorrentInfoModal.svelte
     Per-torrent file list modal, animated via FlyStretchAnimationWrapper.
     Opens with a fly-stretch from the double-clicked table row;
     closes by flying back to that same row position. -->
<script lang="ts">
import { currentTorrent, error, isLoading, refreshTorrent, updateFilePriorities } from '$lib';

import DDSelector from '$lib/components/DDSelector.svelte';
import FlyStretchAnimationWrapper from '$lib/components/FlyStretchAnimWrapper.svelte';
import RefreshButton from '$lib/components/RefreshButton.svelte';
import { formatBytes } from '$lib/helpers';

interface Props {
  /** Controls modal visibility — bindable so parent can open/close */
  open?: boolean;
  /**
   * Returns the DOMRect of the trigger element (the double-clicked table row).
   * Used as the fly animation source/return position.
   */
  getTriggerRect?: () => DOMRect | null;
}

let { open = $bindable(false), getTriggerRect = () => null }: Props = $props();

let filePriorities = $state<Record<string, number>>({});

/**
 * Called after the close animation finishes. Clears the store and local state
 * here (not at close-click time) so content stays visible during the shrink animation.
 */
function handleClosed() {
  currentTorrent.set(null);
  filePriorities = {};
}

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

<FlyStretchAnimationWrapper
  bind:open
  {getTriggerRect}
  maxWidth={1024}
  maxHeight={700}
  ariaLabel={$currentTorrent ? `Files: ${$currentTorrent.name}` : 'Torrent Files'}
  onClosed={handleClosed}
>
  {#snippet children(_phase, close, _panelHeight)}
    <div class="flex h-full flex-col overflow-hidden">
      <!-- Sticky header: title + action buttons -->
      <div
        class="border-ColorPalette-border-secondary/50 bg-ColorPalette-bg-secondary/95 flex-none border-b p-8 backdrop-blur-sm"
      >
        <div class="flex items-start justify-between gap-4">
          <h2
            id="torrent-info-title"
            class="text-ColorPalette-text-secondary min-w-0 flex-1 pr-4 text-3xl font-bold break-words"
          >
            Files: {$currentTorrent?.name ?? ''}
          </h2>
          <div class="flex min-w-[12rem] flex-shrink-0 flex-nowrap items-center space-x-2">
            <RefreshButton
              loading={$isLoading}
              onClick={() => {
                if ($currentTorrent) refreshTorrent($currentTorrent.id);
              }}
              buttonClass="px-4 py-2 bg-gray-600 hover:bg-gray-700 active:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-700 dark:active:bg-gray-800 text-white rounded-lg shadow-sm transition-colors text-sm flex-shrink-0"
            />
            <button
              type="button"
              onclick={close}
              class="flex-shrink-0 rounded-lg bg-gray-500 px-4 py-2 text-sm text-white transition-colors hover:bg-gray-600"
            >
              Close
            </button>
            <button
              type="button"
              onclick={savePriorities}
              disabled={Object.keys(filePriorities).length === 0}
              class="flex-shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              Save Priorities
            </button>
          </div>
        </div>
      </div>

      <!-- Scrollable file table -->
      <div class="min-h-0 flex-1 overflow-y-auto px-8 pt-0 pb-8">
        <table class="text-ColorPalette-text-primary w-full text-sm">
          <thead
            class="border-ColorPalette-border-secondary/50 bg-ColorPalette-bg-secondary/95 sticky top-0 z-10 border-b backdrop-blur-sm"
          >
            <tr>
              <th class="p-3 text-left font-medium">Name</th>
              <th class="p-3 text-center font-medium">Size</th>
              <th class="p-3 text-center font-medium">Progress</th>
              <th class="p-3 text-center font-medium">Priority</th>
            </tr>
          </thead>
          <tbody class="divide-ColorPalette-border-secondary/30 divide-y">
            {#each $currentTorrent?.files ?? [] as file, i (i)}
              {#if $currentTorrent?.fileStats?.[i]}
                {@const stat = $currentTorrent.fileStats[i]}
                <tr class="hover:bg-ColorPalette-bg-tertiary/30 transition-colors">
                  <td class="max-w-md truncate p-3 font-medium" title={file.name}>{file.name}</td>
                  <td class="p-3 text-center">{formatBytes(file.length)}</td>
                  <td class="p-3 text-center">
                    <div
                      class="border-ColorPalette-border-secondary/50 bg-ColorPalette-bg-tertiary/90 relative mx-auto h-6 w-28 overflow-hidden rounded-2xl border shadow-sm"
                    >
                      <!-- Progress fill (behind text) -->
                      <div
                        class="absolute top-0 left-0 h-full rounded-2xl bg-gradient-to-r from-green-500 to-green-600 shadow-inner transition-all duration-500 dark:from-green-700 dark:to-green-500"
                        style="width: {((stat.bytesCompleted / file.length) * 100).toFixed(1)}%"
                      ></div>
                      <!-- Percentage label (overlay, centered) -->
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
                        filePriorities = { ...filePriorities, [i]: newValue };
                      }}
                      tooltipMaxWidth={235}
                      tooltipDelay={1500}
                    >
                      {#snippet tooltipConfig()}
                        <div class="leading-relaxed text-gray-700 dark:text-gray-200">
                          <p class="mb-1.5 font-bold">Customize Torrent File Downloads:</p>
                          <ul class="list-outside list-disc space-y-1 pl-4">
                            <li>
                              Disable downloading a torrent file by choosing <strong>Skip</strong>
                            </li>
                            <li>
                              Reprioritize torrents by choosing <strong>Low</strong> or
                              <strong>High</strong>
                              <br /><span
                                class="text-[0.65rem] font-light text-gray-500 italic dark:text-gray-400"
                                >Default priority is always Normal</span
                              >
                            </li>
                          </ul>
                        </div>
                      {/snippet}
                    </DDSelector>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/snippet}
</FlyStretchAnimationWrapper>

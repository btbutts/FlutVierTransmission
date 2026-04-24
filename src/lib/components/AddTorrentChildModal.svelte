<!-- src/lib/components/AddTorrentChildModal.svelte -->
<script lang="ts">
import { Backburger } from '$lib/plugins';

import AddTorrentButton from './AddTorrentButton.svelte';

interface Props {
  /** Mirrors the master modal's startTorrent checkbox — two-way bindable */
  startTorrent?: boolean;
  /** Total queued item count (URL + files) — drives singular/plural labels */
  totalItems?: number;
  /** Whether the Add Torrent button should be enabled */
  canAdd?: boolean;
  /** Close the entire Add Torrent overlay (Cancel) */
  onClose?: () => void;
  /** Slide back to the master modal */
  onBack?: () => void;
  /** Execute the torrent-add RPC calls */
  onAdd?: () => void | Promise<void>;
}

let {
  startTorrent = $bindable(true),
  totalItems = 0,
  canAdd = false,
  onClose = () => {},
  onBack = () => {},
  onAdd = () => {}
}: Props = $props();

const startLabel = $derived(totalItems > 1 ? 'Start Torrents' : 'Start Torrent');
</script>

<!--
  pointer-events-auto is explicit here because this card is rendered inside an
  ancestor div that has pointer-events-none (to allow backdrop-click-to-close on
  the outer overlay). Without it, all interactive elements inside would be dead.
-->
<div
  class="bg-ColorPalette-bg-secondary ring-ColorPalette-modal-ring-secondary/50 pointer-events-auto max-h-[70vh] w-full max-w-md overflow-hidden rounded-xl ring-1"
  style="box-shadow: 0 0 0 1px rgba(0,0,0,0.15), 0 0 40px 16px rgba(0,0,0,0.65), 0 0 120px 60px rgba(0,0,0,0.5)"
>
  <div class="max-h-[70vh] overflow-y-auto overscroll-contain p-8">
  <!-- Header: title left, Backburger back button right -->
  <div class="mb-6 flex items-center justify-between">
    <h2 class="text-ColorPalette-text-secondary text-2xl font-bold">Choose Torrent Files</h2>
    <button
      type="button"
      onclick={onBack}
      title="Back to Add Torrent"
      aria-label="Back to Add Torrent"
      class="inline-flex aspect-square shrink-0 items-center justify-center rounded-md bg-gray-700/90 p-1.5 text-white shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-gray-600 focus:outline-none active:scale-[0.97] active:bg-gray-800 dark:bg-gray-700/90 dark:hover:bg-gray-600 dark:active:bg-gray-800"
    >
      <Backburger class="h-5 w-5" />
    </button>
  </div>

  <div class="space-y-4">
    <!-- ── Main content area — to be expanded in the next step ── -->

    <!-- Start torrent(s) checkbox — kept in sync with master via $bindable -->
    <label class="flex items-center gap-2">
      <input
        type="checkbox"
        bind:checked={startTorrent}
        class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
      />
      <span class="text-ColorPalette-text-secondary text-sm">{startLabel}</span>
    </label>

    <!-- Action buttons -->
    <div class="flex space-x-3 pt-2">
      <AddTorrentButton
        onclick={onAdd}
        disabled={!canAdd}
        label="Add Torrent{totalItems > 1 ? 's' : ''}"
        class="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 font-medium text-white shadow-sm transition-all hover:bg-blue-700 disabled:opacity-50"
      />
      <button
        type="button"
        onclick={onClose}
        class="flex-1 rounded-md bg-gray-500 px-4 py-2 font-medium text-white shadow-sm transition-all hover:bg-gray-600"
      >
        Cancel
      </button>
    </div>
  </div>
  </div>
</div>

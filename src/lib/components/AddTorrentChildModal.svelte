<!-- src/lib/components/AddTorrentChildModal.svelte -->
<script lang="ts">
import { onDestroy, untrack } from 'svelte';
import {
  addTorrentForSelect,
  addTorrentMetainfoForSelect,
  error,
  getTorrentFilesList,
  refreshAll,
  removeTorrents,
  startTorrents,
  stopTorrents,
  updateFilePriorities
} from '$lib';

import { formatBytes } from '$lib/helpers';
import { Backburger, Loading } from '$lib/plugins';

import AddTorrentButton from './AddTorrentButton.svelte';
import DDSelector from './DDSelector.svelte';

// ── Props ──────────────────────────────────────────────────────────────────────
interface Props {
  /** Mirrors the master modal's startTorrent checkbox — two-way bindable */
  startTorrent?: boolean;
  /** Queued .torrent files passed from the master modal */
  files?: Array<{ name: string; base64: string }>;
  /** Queued magnet link or .torrent URL (at most one) from the master modal */
  magnetUrl?: string;
  /** When true, this card is the visible/active card — triggers processing */
  active?: boolean;
  /** Close the entire Add Torrent overlay (Cancel) */
  onClose?: () => void;
  /** Slide back to the master modal */
  onBack?: () => void;
  /** All torrents confirmed and finalized — close everything */
  onDone?: () => void;
}

let {
  startTorrent = $bindable(true),
  files = [],
  magnetUrl = '',
  active = false,
  onClose = () => {},
  onBack = () => {},
  onDone = () => {}
}: Props = $props();

// ── Queue Item Types ───────────────────────────────────────────────────────────
type ItemStatus = 'pending' | 'adding' | 'fetching' | 'ready' | 'error';

interface FileEntry {
  name: string;
  length: number;
  index: number; // original index in the torrent file list (needed for RPC priority calls)
}

interface QueueItem {
  key: string;
  type: 'file' | 'magnet';
  displayName: string; // filename or magnet URL; updated to server torrent name after add
  base64?: string; // only for type === 'file'
  url?: string; // only for type === 'magnet'
  status: ItemStatus;
  transmissionId?: number;
  isDuplicate: boolean; // was this torrent already in Transmission before we added it?
  errorMsg?: string;
  metadataProgress: number; // 0–1; shown for magnets while fetching metadata
  files: FileEntry[]; // alphabetically sorted after population
  filePriorities: Record<number, number>; // fileIndex → priority (-2 skip, -1 low, 0 normal, 1 high)
  start: boolean; // per-torrent "start on confirm" checkbox
  completedAt: number; // epoch ms when status → ready; 0 = not yet complete
  finalized: boolean; // true after this item has been confirmed via handleAdd; excluded from cleanup + display
}

// ── Reactive State ─────────────────────────────────────────────────────────────
let queue = $state<QueueItem[]>([]);
let isFinalizing = $state(false);
let flashHighlight = $state(false);

// Non-reactive — mutated imperatively, not read in templates:
let abort: AbortController | null = null;
let flashTimerRef: ReturnType<typeof setTimeout> | null = null;

// ── Actionability helpers ───────────────────────────────────────────────────────
// An item can be finalized right now if it has enough information to act on:
//   .torrent file → fully ready (single RPC fetch, completes quickly)
//   magnet link   → at least 1% metadata received from peers
// Used by both canAdd and handleAdd.
function isActionableNow(item: QueueItem): boolean {
  if (item.type === 'file') return item.status === 'ready';
  return item.transmissionId !== undefined && item.metadataProgress >= 0.01;
}

// A per-torrent checkbox is interactive (not locked) when the item is meaningful:
//   .torrent file → always (metadata was already local at open time)
//   magnet link   → once at least 1% of peer metadata has downloaded
function isCheckboxEnabled(item: QueueItem): boolean {
  if (item.type === 'file') return true;
  return item.metadataProgress >= 0.01;
}

// ── Derived ────────────────────────────────────────────────────────────────────
// Unfinalized item count — drives "Start Torrent/s" and "Add Torrent/s" labels.
const totalItems = $derived(queue.filter((item) => !item.finalized).length);

const startLabel = $derived(totalItems > 1 ? 'Start Torrents' : 'Start Torrent');

// How many items handleAdd will process on the next click — drives button label.
const actionableCount = $derived(
  queue.filter((item) => !item.finalized && isActionableNow(item)).length
);

// The "+ Add Torrent" button is enabled when:
//  • Not currently finalizing, AND
//  • At least one non-finalized item has an unlocked checkbox that is checked.
// Scenarios:
//  1 (magnets only)  — locked until a magnet hits ≥1% AND the user checks it.
//  2 (.torrent only) — immediately enabled (.torrent checkboxes are never locked,
//                      start defaults to true).
//  3 (mixed)         — immediately enabled because of the .torrent files.
const canAdd = $derived(
  !isFinalizing && queue.some((item) => !item.finalized && isCheckboxEnabled(item) && item.start)
);

// True when at least one non-finalized magnet has not yet reached 1% metadata download.
// Drives the hint message visibility and the flash animation trigger.
const hasStuckMagnets = $derived(
  queue.some((item) => !item.finalized && item.type === 'magnet' && item.metadataProgress < 0.01)
);

// Finalized items leave the list immediately; ready items sort first by completion time.
const displayQueue = $derived([
  ...queue
    .filter((item) => item.status === 'ready' && !item.finalized)
    .sort((a, b) => a.completedAt - b.completedAt),
  ...queue.filter((item) => item.status !== 'ready' && !item.finalized)
]);

// ── Queue Building ─────────────────────────────────────────────────────────────
function buildQueue(): QueueItem[] {
  const items: QueueItem[] = [];

  for (const f of files) {
    items.push({
      key: `file-${f.name}`,
      type: 'file',
      displayName: f.name,
      base64: f.base64,
      status: 'pending',
      isDuplicate: false,
      errorMsg: undefined,
      metadataProgress: 0,
      files: [],
      filePriorities: {},
      start: startTorrent,
      completedAt: 0,
      finalized: false
    });
  }

  const url = magnetUrl.trim();
  if (url) {
    items.push({
      key: `magnet-${url}`,
      type: 'magnet',
      displayName: url,
      url,
      status: 'pending',
      isDuplicate: false,
      errorMsg: undefined,
      metadataProgress: 0,
      files: [],
      filePriorities: {},
      start: startTorrent,
      completedAt: 0,
      finalized: false
    });
  }

  return items;
}

// ── Processing ─────────────────────────────────────────────────────────────────
async function processQueue(signal: AbortSignal) {
  await Promise.allSettled(queue.map((item) => processItem(item, signal)));
}

async function processItem(item: QueueItem, signal: AbortSignal) {
  if (signal.aborted) return;

  try {
    item.status = 'adding';

    let result: { id: number; name: string; isDuplicate: boolean };
    if (item.type === 'file') {
      result = await addTorrentMetainfoForSelect(item.base64!);
    } else {
      result = await addTorrentForSelect(item.url!);
    }

    // Record the server ID before the abort check so cleanup can find it
    // even if abort fires between the await and the check below.
    item.transmissionId = result.id;
    item.isDuplicate = result.isDuplicate;
    if (result.name) item.displayName = result.name;

    if (signal.aborted) return;

    item.status = 'fetching';

    if (item.type === 'file') {
      // .torrent files have full metadata locally — a single torrent-get suffices.
      const data = await getTorrentFilesList(result.id);
      if (signal.aborted) return;
      if (!data) throw new Error('Torrent not found after adding');
      item.files = sortedFiles(data.files ?? []);
      item.completedAt = Date.now();
      item.status = 'ready';
    } else {
      // Magnet links require downloading metadata from peers; poll until done.
      await pollMagnetMetadata(item, signal);
    }
  } catch (err: unknown) {
    if (signal.aborted) return;
    item.status = 'error';
    item.errorMsg = err instanceof Error ? err.message : 'Failed';
  }
}

async function pollMagnetMetadata(item: QueueItem, signal: AbortSignal) {
  const POLL_MS = 2000;

  while (!signal.aborted) {
    const data = await getTorrentFilesList(item.transmissionId!);
    if (signal.aborted) break;

    if (!data) {
      item.status = 'error';
      item.errorMsg = 'Torrent disappeared from server';
      return;
    }

    // Update display name once the server knows the torrent name.
    if (data.name) item.displayName = data.name;
    item.metadataProgress = data.metadataPercentComplete;

    if (data.metadataPercentComplete >= 1 && (data.files?.length ?? 0) > 0) {
      // Metadata complete — stop the torrent (user hasn't confirmed yet).
      await stopTorrents([item.transmissionId!]);
      if (signal.aborted) break;
      item.files = sortedFiles(data.files ?? []);
      item.completedAt = Date.now();
      item.status = 'ready';
      return;
    }

    // Wait before the next poll; abort signal cuts the wait short.
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, POLL_MS);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true }
      );
    });
  }
}

function sortedFiles(raw: Array<{ name: string; length: number }>): FileEntry[] {
  return raw
    .map((f, i) => ({ name: f.name, length: f.length, index: i }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Flash animation ────────────────────────────────────────────────────────────
// Pulses the hint message color between default and blue-500 for 3 cycles,
// each 1000ms (500ms per half-step), with CSS transitions doing the smooth fade.
function triggerFlash() {
  // Cancel any in-progress flash before starting fresh.
  if (flashTimerRef !== null) {
    clearTimeout(flashTimerRef);
    flashTimerRef = null;
    flashHighlight = false;
  }

  const HALF_CYCLE_MS = 500; // half of the 1000ms-per-cycle the user specified
  let step = 0;
  const TOTAL_STEPS = 6; // 3 cycles × 2 half-steps (on + off)

  function tick() {
    step++;
    flashHighlight = step % 2 !== 0; // odd steps = blue, even steps = default
    if (step < TOTAL_STEPS) {
      flashTimerRef = setTimeout(tick, HALF_CYCLE_MS);
    } else {
      flashTimerRef = null;
    }
  }

  tick(); // step 1: immediately set blue, then alternate every 500ms
}

// ── Cleanup ────────────────────────────────────────────────────────────────────
// Reads non-finalized, non-duplicate IDs without creating a reactive dependency.
// finalized items have already been confirmed by handleAdd and must not be removed.
function getAddedIds(): number[] {
  return untrack(() =>
    queue
      .filter((item) => item.transmissionId !== undefined && !item.isDuplicate && !item.finalized)
      .map((item) => item.transmissionId!)
  );
}

// ── Activation / Deactivation ──────────────────────────────────────────────────
// The $effect depends ONLY on `active`. Every other read (queue, files, magnetUrl)
// is wrapped in untrack() so that mutations to queue items — or any prop change —
// cannot make the effect a reactive dependency and cause it to abort + restart
// in-flight RPC calls (which would lock the spinner at "Adding…" forever).
$effect(() => {
  if (active) {
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    // Everything below runs inside untrack so that:
    //  • buildQueue() reads of files/magnetUrl/startTorrent are not tracked
    //  • processQueue()'s synchronous queue.map() read is not tracked
    // Without this, writing `queue` and then reading it in the same $effect
    // body creates a write→read cycle that Svelte re-runs indefinitely,
    // calling abort.abort() before every RPC resolve.
    untrack(() => {
      queue = buildQueue();
      void processQueue(signal);
    });
  } else {
    if (abort) {
      abort.abort();
      abort = null;
    }
    const idsToRemove = getAddedIds();
    queue = [];
    if (idsToRemove.length > 0) {
      void removeTorrents(idsToRemove, false).catch(() => {});
    }
  }
});

// Safety net: abort and clean up when the component is destroyed (e.g., the
// user cancels from the master modal while the child card is still active).
onDestroy(() => {
  abort?.abort();
  if (flashTimerRef !== null) clearTimeout(flashTimerRef);
  // getAddedIds() already excludes finalized and duplicate IDs, so items that
  // were partially confirmed (scenario 3) are not removed on destroy.
  const idsToRemove = getAddedIds();
  if (idsToRemove.length > 0) {
    void removeTorrents(idsToRemove, false).catch(() => {});
  }
});

// ── Primary checkbox → cascade to all per-torrent checkboxes ──────────────────
// Fires whenever startTorrent changes — whether from the master modal's checkbox
// (via the $bindable binding) or from the child's own primary checkbox.
// Individual per-torrent checkbox changes don't touch startTorrent, so they're
// unaffected. queue is read inside untrack so it isn't a tracked dependency.
$effect(() => {
  const s = startTorrent;
  untrack(() => {
    for (const item of queue) {
      if (!item.finalized) item.start = s;
    }
  });
});

// ── Add / Finalize ─────────────────────────────────────────────────────────────
async function handleAdd() {
  if (isFinalizing || !canAdd) return;
  isFinalizing = true;

  // Only process items that are actionable right now:
  //   .torrent files that are fully ready, or magnets with ≥1% metadata.
  // Magnets still at 0% are left in-queue and the modal stays open for them.
  const toFinalize = queue.filter((item) => !item.finalized && isActionableNow(item));

  try {
    for (const item of toFinalize) {
      if (item.transmissionId !== undefined) {
        // Apply any file priority overrides the user configured (ready items only —
        // partial-metadata magnets keep the default Transmission priority until
        // the user gets a second chance to configure them).
        if (item.status === 'ready' && Object.keys(item.filePriorities).length > 0) {
          await updateFilePriorities(item.transmissionId, item.filePriorities);
        }

        // Respect the per-torrent "start on confirm" checkbox.
        // .torrent files were added paused; completed magnets were stopped after
        // metadata fetch. Partial-metadata magnets are already running (paused: false)
        // so startTorrents() for them is a no-op — harmless either way.
        if (item.start) {
          await startTorrents([item.transmissionId]);
        }
      }

      // Marks the item confirmed: removes it from displayQueue and from cleanup.
      item.finalized = true;
    }

    // Check whether any non-error items are still pending (scenario 3 partial).
    const stillPending = queue.filter((item) => !item.finalized && item.status !== 'error');

    if (stillPending.length === 0) {
      // All done — close the modal.
      await refreshAll();
      onDone();
    } else {
      // Some magnets still have 0% metadata. Keep the modal open so the user
      // can configure them once their metadata arrives. Refresh in the background
      // so the main torrent list reflects the items we just confirmed.
      void refreshAll().catch(() => {});
      isFinalizing = false;
      // Flash the hint message to draw attention to the stuck magnets.
      if (stillPending.some((item) => item.type === 'magnet' && item.metadataProgress < 0.01)) {
        triggerFlash();
      }
    }
  } catch (err: unknown) {
    error.set(err instanceof Error ? err.message : 'Failed to finalize torrents');
    isFinalizing = false;
  }
}
</script>

<!--
  pointer-events-auto is explicit here because this card is rendered inside an
  ancestor div that has pointer-events-none (to allow backdrop-click-to-close on
  the outer overlay). Without it, all interactive elements inside would be dead.

  The outer div uses flex flex-col so the header, primary checkbox, and footer
  are fixed-height rows while the file list in the middle scrolls independently.
-->
<div
  class="bg-ColorPalette-bg-secondary ring-ColorPalette-modal-ring-secondary/50 pointer-events-auto flex max-h-[70vh] w-full max-w-[45rem] flex-col overflow-hidden rounded-xl ring-1"
  style="box-shadow: 0 0 0 1px rgba(0,0,0,0.15), 0 0 40px 16px rgba(0,0,0,0.65), 0 0 120px 60px rgba(0,0,0,0.5)"
>
  <!-- ── Header: title left, Backburger back button right ─────────────────── -->
  <!--
    items-start keeps the back button aligned with the top of the title column
    when the hint message is present.
  -->
  <div class="flex flex-shrink-0 items-start justify-between px-8 pt-8 pb-4">
    <div class="flex flex-col gap-1">
      <h2 class="text-ColorPalette-text-secondary text-2xl font-bold">Choose Torrent Files</h2>
      <!--
        Shown only while at least one magnet link has not yet reached 1% metadata.
        When the user clicks "+ Add Torrents" with stuck magnets remaining, triggerFlash()
        pulses the color between text-ColorPalette-text-tertiary and text-blue-500
        for 3 × 1000ms cycles (500ms per half-step) via CSS color transitions.
      -->
      {#if hasStuckMagnets}
        <p
          class="{flashHighlight
            ? 'text-blue-500'
            : 'text-ColorPalette-text-tertiary'} text-xs transition-colors duration-[500ms]"
        >
          Magnet Links can only be saved<br />
          after metadata begins downloading
        </p>
      {/if}
    </div>
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

  <!-- ── Primary "Start Torrents" checkbox ────────────────────────────────── -->
  <div class="border-ColorPalette-modal-ring-secondary/30 flex-shrink-0 border-t px-8 py-3">
    <label class="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        bind:checked={startTorrent}
        class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
      />
      <span class="text-ColorPalette-text-secondary text-sm">{startLabel}</span>
    </label>
  </div>

  <!-- ── Scrollable torrent / file list ───────────────────────────────────── -->
  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-8 py-3">
    {#if displayQueue.length === 0}
      <!-- Empty state while the queue is being initialised -->
      <div class="text-ColorPalette-text-tertiary flex items-center justify-center py-8 text-sm">
        <Loading class="mr-2 h-4 w-4 animate-spin" />
        Preparing…
      </div>
    {:else}
      <div class="space-y-3">
        {#each displayQueue as item (item.key)}
          <!-- ── Torrent row ─────────────────────────────────────────────── -->
          <div>
            <div class="flex min-w-0 items-center gap-2 py-1">
              <!-- Per-torrent start/do-not-start checkbox.
                   Locked for magnet links until at least 1% of peer metadata
                   has downloaded — prevents confirming a torrent that hasn't
                   yet established contact with any tracker or peer. -->
              <input
                type="checkbox"
                bind:checked={item.start}
                disabled={item.type === 'magnet' && item.metadataProgress < 0.01}
                class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 flex-shrink-0 rounded border-gray-300 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
              />

              <!-- Torrent display name -->
              <span
                class="text-ColorPalette-text-secondary min-w-0 flex-1 truncate text-sm font-medium"
                title={item.displayName}>{item.displayName}</span
              >

              <!-- Status indicator — hidden once ready -->
              {#if item.status === 'adding'}
                <span
                  class="text-ColorPalette-text-tertiary flex flex-shrink-0 items-center gap-1 text-xs"
                >
                  <Loading class="h-3.5 w-3.5 animate-spin" />
                  Adding…
                </span>
              {:else if item.status === 'fetching' && item.type === 'file'}
                <span
                  class="text-ColorPalette-text-tertiary flex flex-shrink-0 items-center gap-1 text-xs"
                >
                  <Loading class="h-3.5 w-3.5 animate-spin" />
                  Loading files…
                </span>
              {:else if item.status === 'fetching' && item.type === 'magnet'}
                <span
                  class="text-ColorPalette-text-tertiary flex flex-shrink-0 items-center gap-1 text-xs"
                >
                  <Loading class="h-3.5 w-3.5 animate-spin" />
                  Metadata {(item.metadataProgress * 100).toFixed(0)}%
                </span>
              {:else if item.status === 'error'}
                <span class="flex-shrink-0 text-xs text-red-400" title={item.errorMsg}>
                  Error
                </span>
              {/if}
            </div>

            <!-- ── File list (indented LDAP-tree style) ───────────────── -->
            {#if item.status === 'ready' && item.files.length > 0}
              <!--
                ml-6  — indent to align visually below the torrent name
                border-l — the vertical "tree" line (LDAP-browser style)
                pl-3  — gap between the tree line and the file name
              -->
              <div class="mt-0.5 ml-6 border-l border-gray-600/30 pl-3">
                <div class="space-y-0.5">
                  {#each item.files as file (file.index)}
                    <div class="flex min-w-0 items-center gap-2 py-0.5">
                      <!-- File name (truncated, full on hover) -->
                      <span
                        class="text-ColorPalette-text-tertiary min-w-0 flex-1 truncate text-xs"
                        title={file.name}>{file.name}</span
                      >

                      <!-- File size (de-emphasised) -->
                      <span
                        class="text-ColorPalette-text-tertiary flex-shrink-0 text-xs opacity-60"
                      >
                        {formatBytes(file.length)}
                      </span>

                      <!-- Priority dropdown: Skip / Low / Normal / High -->
                      <DDSelector
                        value={item.filePriorities[file.index] ?? 0}
                        onChange={(v) => {
                          item.filePriorities[file.index] = v as number;
                        }}
                      />
                    </div>
                  {/each}
                </div>
              </div>
            {:else if item.status === 'error'}
              <div class="mt-0.5 ml-6 border-l border-red-500/30 pl-3">
                <p class="text-xs text-red-400">{item.errorMsg ?? 'Unknown error'}</p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- ── Footer: action buttons ───────────────────────────────────────────── -->
  <div class="border-ColorPalette-modal-ring-secondary/30 flex-shrink-0 border-t px-8 pt-4 pb-8">
    <div class="flex space-x-3">
      <AddTorrentButton
        onclick={handleAdd}
        disabled={!canAdd}
        label="Add Torrent{actionableCount !== 1 ? 's' : ''}"
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

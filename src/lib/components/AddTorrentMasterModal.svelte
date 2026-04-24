<!-- src/lib/components/AddTorrentMasterModal.svelte -->
<script lang="ts">
import { tick } from 'svelte';

import { addTorrent, addTorrentMetainfo, error, refreshAll } from '$lib';

import { windowPopUp } from '$lib/helpers';
import { Close, FileFind, Forwardburger } from '$lib/plugins';

import AddTorrentButton from './AddTorrentButton.svelte';
import AddTorrentChildModal from './AddTorrentChildModal.svelte';

interface Props {
  /** Controls modal visibility — bindable so parent can open/close */
  open?: boolean;
}

let { open = $bindable(false) }: Props = $props();

// ── Torrent entry state ────────────────────────────────────────────────────────
let newTorrentUrl = $state('');
let selectedFiles = $state<Array<{ name: string; base64: string }>>([]);
let startTorrent = $state(true);
let fileInputEl = $state<HTMLInputElement | undefined>(undefined);

// ── Animation state ────────────────────────────────────────────────────────────
// Each card is positioned via `transform: translateX(...)`.
// Transitions are applied only when animating; set to 'none' for instant snaps.
// tick() + requestAnimationFrame ensures the browser commits the start position
// before the end position is applied, so the transition actually fires.
let isAnimating = $state(false);
let masterX = $state('0px');
let childX = $state('150vw');
let masterTransition = $state('none');
let childTransition = $state('none');

// ── Derived ────────────────────────────────────────────────────────────────────
const totalItems = $derived(selectedFiles.length + (newTorrentUrl.trim() ? 1 : 0));
const startLabel = $derived(totalItems > 1 ? 'Start Torrents' : 'Start Torrent');
const canAdd = $derived(newTorrentUrl.trim().length > 0 || selectedFiles.length > 0);

/**
 * Master card style: always uses transform + transition (never switches to
 * `animation`). The box-shadow is a constant suffix so it persists at all times.
 */
const masterCardStyle = $derived(
  `transform: translateX(${masterX}); transition: ${masterTransition}; ` +
    'box-shadow: 0 0 0 1px rgba(0,0,0,0.15), 0 0 40px 16px rgba(0,0,0,0.65), 0 0 120px 60px rgba(0,0,0,0.5);'
);

/**
 * Child wrapper style: same transform + transition pattern. The card shadow
 * lives inside AddTorrentChildModal itself.
 */
const childWrapperStyle = $derived(
  `transform: translateX(${childX}); transition: ${childTransition};`
);

// ── Actions ────────────────────────────────────────────────────────────────────
function closeModal() {
  open = false;
  newTorrentUrl = '';
  selectedFiles = [];
  // Reset animation state so next open starts clean
  masterX = '0px';
  childX = '150vw';
  masterTransition = 'none';
  childTransition = 'none';
  isAnimating = false;
}

/**
 * Slide child in from the right, push master out to the left.
 *
 * Push-effect timing:
 *   Child  — 400ms ease-out  (decelerates as it reaches centre)
 *   Master — 260ms ease-in, 140ms delay  (stays still while child crosses ~35%
 *            of its travel, then accelerates leftward — "pushed" feel)
 *
 * tick() flushes Svelte's DOM update so the browser commits the start positions.
 * requestAnimationFrame then fires after the browser paints that frame, giving
 * the CSS transition engine a clear before→after to interpolate.
 */
async function openAddTorrentChildModal() {
  if (isAnimating) return;
  isAnimating = true;

  // Snap to start positions with no transition
  masterTransition = 'none';
  childTransition = 'none';
  masterX = '0px';
  childX = '150vw';

  await tick();

  requestAnimationFrame(() => {
    masterTransition = 'transform 260ms ease-in 340ms';
    childTransition = 'transform 400ms ease-out';
    masterX = '-150vw';
    childX = '0px';

    setTimeout(() => {
      isAnimating = false;
    }, 450);
  });
}

/**
 * Slide master in from the left, push child out to the right.
 * Mirror timing of openAddTorrentChildModal.
 */
async function closeAddTorrentChildModal() {
  if (isAnimating) return;
  isAnimating = true;

  // Snap to start positions with no transition
  masterTransition = 'none';
  childTransition = 'none';
  masterX = '-150vw';
  childX = '0px';

  await tick();

  requestAnimationFrame(() => {
    masterTransition = 'transform 400ms ease-out';
    childTransition = 'transform 260ms ease-in 340ms';
    masterX = '0px';
    childX = '150vw';

    setTimeout(() => {
      isAnimating = false;
    }, 450);
  });
}

function removeFile(index: number) {
  selectedFiles = selectedFiles.filter((_, i) => i !== index);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFilesSelected(e: Event) {
  const input = e.currentTarget as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  const files = Array.from(input.files);
  input.value = '';
  const newItems: Array<{ name: string; base64: string }> = [];
  for (const file of files) {
    if (!selectedFiles.some((f) => f.name === file.name)) {
      const base64 = await readFileAsBase64(file);
      newItems.push({ name: file.name, base64 });
    }
  }
  if (newItems.length > 0) {
    selectedFiles = [...selectedFiles, ...newItems];
  }
}

async function handleAddTorrent() {
  if (!canAdd) return;
  const paused = !startTorrent;
  const promises: Promise<unknown>[] = [];
  if (newTorrentUrl.trim()) {
    promises.push(addTorrent(newTorrentUrl.trim(), { paused }));
  }
  for (const file of selectedFiles) {
    promises.push(addTorrentMetainfo(file.base64, { paused }));
  }
  try {
    await Promise.all(promises);
    closeModal();
    await refreshAll();
  } catch (err: unknown) {
    error.set(err instanceof Error ? err.message : 'Add failed');
  }
}
</script>

{#if open}
  <!--
    Outer overlay: bg-black/50 backdrop + overflow-hidden to clip cards during
    slide animations. onclick with target === currentTarget closes on backdrop click;
    pointer-events-none on child wrappers ensures dark-area clicks reach this div.
  -->
  <div
    use:windowPopUp
    class="fixed inset-0 z-50 overflow-hidden bg-black/50"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="add-torrent-title"
    onclick={(event) => event.target === event.currentTarget && closeModal()}
    onkeydown={(event) => event.key === 'Escape' && closeModal()}
  >
    <!-- Hidden native file picker — triggered programmatically by the Browse button -->
    <input
      bind:this={fileInputEl}
      type="file"
      accept=".torrent"
      multiple
      class="hidden"
      onchange={handleFilesSelected}
    />

    <!-- ── Master card ──────────────────────────────────────────────────────── -->
    <!--
      pointer-events-none on the centering wrapper so clicks on the dark area
      pass through to the outer overlay (enabling backdrop-click-to-close).
      pointer-events-auto on the card itself re-enables interactions inside it.
    -->
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
      <div
        class="bg-ColorPalette-bg-secondary ring-ColorPalette-modal-ring-secondary/50 pointer-events-auto max-h-[40vh] w-full max-w-md overflow-y-auto rounded-xl p-8 ring-1"
        style={masterCardStyle}
      >
        <h2 id="add-torrent-title" class="text-ColorPalette-text-secondary mb-6 text-2xl font-bold">
          Add Torrent
        </h2>
        <div class="space-y-4">
          <!-- Selected .torrent files list (mirrors Common Paths styling) -->
          {#if selectedFiles.length > 0}
            <div class="space-y-1">
              {#each selectedFiles as file, i (file.name)}
                <div class="flex items-center gap-2">
                  <span
                    class="bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary min-w-0 flex-1 truncate rounded-md px-2 py-1 text-xs"
                    title={file.name}>{file.name}</span
                  >
                  <!-- px-[11.5px] invisible padding — aligns remove button column with Add btn -->
                  <div class="flex shrink-0 items-center justify-center px-[11.5px]">
                    <button
                      type="button"
                      onclick={() => removeFile(i)}
                      aria-label="Remove {file.name}"
                      class="bg-ColorPalette-bg-quinary hover:bg-ColorPalette-button-bg-hover-tertiary text-ColorPalette-text-quinary flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:text-red-600"
                    >
                      <Close class="h-4 w-4" />
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          <!-- URL/magnet input · Browse button · Configure button (one flex row) -->
          <div class="flex items-stretch gap-2">
            <input
              bind:value={newTorrentUrl}
              placeholder="Paste magnet link or .torrent URL"
              onkeydown={(e) => e.key === 'Enter' && handleAddTorrent()}
              class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary min-w-0 flex-1 rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
            />
            <!-- Browse: opens OS native file picker for local .torrent files -->
            <button
              type="button"
              onclick={() => fileInputEl?.click()}
              title="Browse for torrents from local machine"
              aria-label="Browse for torrents from local machine"
              class="inline-flex aspect-square shrink-0 items-center justify-center rounded-md bg-gray-700/90 p-1.5 text-white shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-gray-600 focus:outline-none active:scale-[0.97] active:bg-gray-800 dark:bg-gray-700/90 dark:hover:bg-gray-600 dark:active:bg-gray-800"
            >
              <FileFind class="h-5 w-5" />
            </button>
            <!-- Configure: slides in the child modal to select per-file priorities -->
            <button
              type="button"
              onclick={openAddTorrentChildModal}
              title="Select files to download from torrent"
              aria-label="Configure Torrent Files"
              class="inline-flex aspect-square shrink-0 items-center justify-center rounded-md bg-gray-700/90 p-1.5 text-white shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-gray-600 focus:outline-none active:scale-[0.97] active:bg-gray-800 dark:bg-gray-700/90 dark:hover:bg-gray-600 dark:active:bg-gray-800"
            >
              <Forwardburger class="h-5 w-5" />
            </button>
          </div>

          <!-- Start torrent(s) checkbox -->
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
              onclick={handleAddTorrent}
              disabled={!canAdd}
              label="Add Torrent{totalItems > 1 ? 's' : ''}"
              class="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 font-medium text-white shadow-sm transition-all hover:bg-blue-700 disabled:opacity-50"
            />
            <button
              type="button"
              onclick={closeModal}
              class="flex-1 rounded-md bg-gray-500 px-4 py-2 font-medium text-white shadow-sm transition-all hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Child card ───────────────────────────────────────────────────────── -->
    <!--
      Same pointer-events-none wrapper pattern. The animation wrapper div
      is pointer-events-auto so AddTorrentChildModal's interactions work;
      AddTorrentChildModal also explicitly sets pointer-events-auto on its
      root card element in case of CSS inheritance edge cases.
    -->
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
      <div class="pointer-events-auto" style={childWrapperStyle}>
        <AddTorrentChildModal
          bind:startTorrent
          {totalItems}
          {canAdd}
          onClose={closeModal}
          onBack={closeAddTorrentChildModal}
          onAdd={handleAddTorrent}
        />
      </div>
    </div>
  </div>
{/if}

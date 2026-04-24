<!-- src/lib/components/AddTorrentMasterModal.svelte -->
<script lang="ts">
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

// ── Animation refs & guard ─────────────────────────────────────────────────────
// $state satisfies Svelte 5's bind:this requirement.
// We never read these in reactive contexts ($derived / template expressions),
// so making them $state has no batching effect on our imperative animation code.
let masterCardElement = $state<HTMLDivElement | undefined>(undefined);
let childCardElement = $state<HTMLDivElement | undefined>(undefined);
let isAnimating = $state(false);

// Animation timing constants
const INCOMING_MS = 800; // incoming card: ease-out slide to centre
const OUTGOING_MS = 500; // outgoing card: ease-in slide off-screen (starts at proximity)
// 80px accounts for one RAF frame of card travel (~16ms) plus the frame in which
// the exit applyStyle takes visual effect — net visual gap at exit start ≈ 12–20px.
const PROXIMITY_PX = 175;

// ── Derived ────────────────────────────────────────────────────────────────────
const totalItems = $derived(selectedFiles.length + (newTorrentUrl.trim() ? 1 : 0));
const startLabel = $derived(totalItems > 1 ? 'Start Torrents' : 'Start Torrent');
const canAdd = $derived(newTorrentUrl.trim().length > 0 || selectedFiles.length > 0);

// ── Animation helpers ──────────────────────────────────────────────────────────
/**
 * Apply transform + transition to a card element directly.
 * Setting both in the same synchronous call is intentional:
 * the browser computes the transition against the PREVIOUS committed style,
 * so a `transition: none → X` + `transform: A → B` change in one batch
 * correctly starts the CSS transition from A to B.
 */
function applyStyle(el: HTMLElement, transition: string, transform: string) {
  el.style.transition = transition;
  el.style.transform = transform;
}

/**
 * Force a synchronous layout calculation.
 * Calling getBoundingClientRect() causes the browser to flush pending style
 * changes and compute positions — essential before starting a new transition
 * so the browser registers the "before" position unambiguously.
 */
function reflow(el: HTMLElement) {
  void el.getBoundingClientRect();
}

// ── Actions ────────────────────────────────────────────────────────────────────
function closeModal() {
  open = false;
  newTorrentUrl = '';
  selectedFiles = [];
  isAnimating = false;
  // DOM refs become undefined on unmount; no style cleanup needed —
  // the {#if open} block remounts fresh elements each time.
}

/**
 * Slide the child card in from the right, push the master card out to the left.
 *
 * Sequence:
 *   1. Snap both cards to their start positions instantly (no transition).
 *   2. reflow() commits those positions to the browser's layout engine.
 *   3. Immediately start the child's ease-out slide — no tick()/RAF delay,
 *      so the animation begins on the very next paint (imperceptible latency).
 *   4. Each RAF frame, measure the rendered gap between the two card edges.
 *   5. Once gap ≤ PROXIMITY_PX, start master's ease-in exit (OUTGOING_MS).
 *
 * Viewport-width-independent: gap is measured in real device pixels every frame.
 */
function openChild() {
  if (isAnimating || !masterCardElement || !childCardElement) return;
  isAnimating = true;

  const master = masterCardElement;
  const child = childCardElement;

  // ① Snap to start positions; reflow commits them so CSS transition has a
  //    clean "before" value — no tick()/RAF needed after this.
  applyStyle(master, 'none', 'translateX(0)');
  applyStyle(child, 'none', 'translateX(150vw)');
  reflow(master);
  reflow(child);

  // ② Start child sliding in immediately
  applyStyle(child, `transform ${INCOMING_MS}ms ease-out`, 'translateX(0)');

  let exitStarted = false;

  // ③ Poll each frame until cards are within PROXIMITY_PX of each other
  function checkProximity() {
    if (exitStarted) return;

    const gap = child.getBoundingClientRect().left - master.getBoundingClientRect().right;

    if (gap <= PROXIMITY_PX) {
      exitStarted = true;
      // ④ Master exits left (ease-in: slow start → accelerates off-screen)
      applyStyle(master, `transform ${OUTGOING_MS}ms ease-in`, 'translateX(-150vw)');
      setTimeout(() => {
        isAnimating = false;
      }, OUTGOING_MS + 50);
      return;
    }

    requestAnimationFrame(checkProximity);
  }

  requestAnimationFrame(checkProximity);
}

/**
 * Slide the master card in from the left, push the child card out to the right.
 * Exact mirror of openChild().
 */
function closeChild() {
  if (isAnimating || !masterCardElement || !childCardElement) return;
  isAnimating = true;

  const master = masterCardElement;
  const child = childCardElement;

  // ① Snap to start positions; reflow commits them
  applyStyle(master, 'none', 'translateX(-150vw)');
  applyStyle(child, 'none', 'translateX(0)');
  reflow(master);
  reflow(child);

  // ② Start master sliding in immediately
  applyStyle(master, `transform ${INCOMING_MS}ms ease-out`, 'translateX(0)');

  let exitStarted = false;

  // ③ Poll until cards are within PROXIMITY_PX of each other
  function checkProximity() {
    if (exitStarted) return;

    const gap = child.getBoundingClientRect().left - master.getBoundingClientRect().right;

    if (gap <= PROXIMITY_PX) {
      exitStarted = true;
      // ④ Child exits right (ease-in)
      applyStyle(child, `transform ${OUTGOING_MS}ms ease-in`, 'translateX(150vw)');
      setTimeout(() => {
        isAnimating = false;
      }, OUTGOING_MS + 50);
      return;
    }

    requestAnimationFrame(checkProximity);
  }

  requestAnimationFrame(checkProximity);
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
    Outer overlay: bg-black/50 backdrop + overflow-hidden to clip both cards
    during the slide animations so they never bleed outside the viewport.
    onclick with target === currentTarget enables backdrop-click-to-close;
    the pointer-events-none centering wrappers pass unhandled clicks through.
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
    <!-- Hidden native file picker — triggered programmatically by Browse button -->
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
      The outer div is the flex-centering wrapper (pointer-events-none so
      backdrop clicks pass through). The inner div is the actual card —
      bind:this gives us the DOM ref for direct style manipulation.
      The initial `style` positions it at centre (translateX 0); the JS
      animation functions overwrite transform/transition directly from there.
      box-shadow is inlined here (not driven by JS) so it persists at all times.
    -->
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
      <div
        bind:this={masterCardElement}
        class="bg-ColorPalette-bg-secondary ring-ColorPalette-modal-ring-secondary/50 pointer-events-auto max-h-[70vh] w-full max-w-md overflow-hidden rounded-xl ring-1"
        style="transform: translateX(0); box-shadow: 0 0 0 1px rgba(0,0,0,0.15), 0 0 40px 16px rgba(0,0,0,0.65), 0 0 120px 60px rgba(0,0,0,0.5);"
      >
        <div class="max-h-[70vh] overflow-y-auto overscroll-contain p-8">
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
                  <!-- px-[11.5px] padding visually aligns the remove column with the Add button -->
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
            <!-- Configure: slides in the child modal for per-file priority selection -->
            <button
              type="button"
              onclick={openChild}
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
    </div>

    <!-- ── Child card ───────────────────────────────────────────────────────── -->
    <!--
      Same pointer-events-none centering wrapper pattern. The inner div is
      the animation target (bind:this → childCardElement); it starts off-screen
      right via the initial translateX(150vw) inline style. The JS proximity
      loop writes transform/transition directly on this element.
      AddTorrentChildModal sets pointer-events-auto on its own root card.
    -->
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
      <div
        bind:this={childCardElement}
        class="pointer-events-auto"
        style="transform: translateX(150vw);"
      >
        <AddTorrentChildModal
          bind:startTorrent
          {totalItems}
          {canAdd}
          onClose={closeModal}
          onBack={closeChild}
          onAdd={handleAddTorrent}
        />
      </div>
    </div>
  </div>
{/if}

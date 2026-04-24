<!-- src/lib/components/AddTorrentMasterModal.svelte -->
<script lang="ts">
import { addTorrent, addTorrentMetainfo, error, refreshAll } from '$lib';

import { windowPopUp } from '$lib/helpers';
import { Close, FileFind, Plus } from '$lib/plugins';

interface Props {
  /** Controls modal visibility — bindable so parent can open/close */
  open?: boolean;
}

let { open = $bindable(false) }: Props = $props();

let newTorrentUrl = $state('');
let selectedFiles = $state<Array<{ name: string; base64: string }>>([]);
let startTorrent = $state(true);
let fileInputEl = $state<HTMLInputElement | undefined>(undefined);

const totalItems = $derived(selectedFiles.length + (newTorrentUrl.trim() ? 1 : 0));
const startLabel = $derived(totalItems > 1 ? 'Start Torrents' : 'Start Torrent');
const canAdd = $derived(newTorrentUrl.trim().length > 0 || selectedFiles.length > 0);

function closeModal() {
  open = false;
  newTorrentUrl = '';
  selectedFiles = [];
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

async function handleAdd() {
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
  <div
    use:windowPopUp
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="add-torrent-title"
    onclick={(event) => event.target === event.currentTarget && closeModal()}
    onkeydown={(event) => event.key === 'Escape' && closeModal()}
  >
    <!-- Hidden native file picker — triggered by the Browse button -->
    <input
      bind:this={fileInputEl}
      type="file"
      accept=".torrent"
      multiple
      class="hidden"
      onchange={handleFilesSelected}
    />

    <div
      class="bg-ColorPalette-bg-secondary ring-ColorPalette-modal-ring-secondary/50 max-h-[40vh] w-full max-w-md overflow-y-auto rounded-xl p-8 shadow-2xl ring-1"
      style="box-shadow: 0 0 0 1px rgba(0,0,0,0.15), 0 0 40px 16px rgba(0,0,0,0.65), 0 0 120px 60px rgba(0,0,0,0.5)"
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
                <!-- px-[11.5px] invisible padding — matches the Add button column width below -->
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

        <!-- URL/magnet input + Browse button (same row, Browse far-right) -->
        <div class="flex items-stretch gap-2">
          <input
            bind:value={newTorrentUrl}
            placeholder="Paste magnet link or .torrent URL"
            onkeydown={(e) => e.key === 'Enter' && handleAdd()}
            class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary min-w-0 flex-1 rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
          />
          <!-- Square browse button: height = input height (items-stretch + aspect-square), no border -->
          <button
            type="button"
            onclick={() => fileInputEl?.click()}
            title="Browse for torrents from local machine"
            aria-label="Browse for torrents from local machine"
            class="inline-flex aspect-square shrink-0 items-center justify-center rounded-md bg-gray-700/90 p-1.5 text-white shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-gray-600 focus:outline-none active:scale-[0.97] active:bg-gray-800 dark:bg-gray-700/90 dark:hover:bg-gray-600 dark:active:bg-gray-800"
          >
            <FileFind class="h-5 w-5" />
          </button>
        </div>

        <!-- Start torrent(s) checkbox — label is singular/plural based on total count -->
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
          <button
            onclick={handleAdd}
            disabled={!canAdd}
            class="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 font-medium text-white shadow-sm transition-all hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus class="h-[1em] w-[1em] shrink-0" />
            <span>Add Torrent{totalItems > 1 ? 's' : ''}</span>
          </button>
          <button
            onclick={closeModal}
            class="flex-1 rounded-md bg-gray-500 px-4 py-2 font-medium text-white shadow-sm transition-all hover:bg-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

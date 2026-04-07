<script lang="ts">
import { onMount } from 'svelte';
import {
  currentTorrent,
  error,
  isLoading,
  layoutMinWidth,
  performActionAndRefresh,
  refreshTorrent,
  selectedTorrents,
  torrents,
  updateFilePriorities,
  windowPopUp,
  type DropdownOption,
  type Torrent
} from '$lib';

import DDSelector from '$lib/components/DDSelector.svelte';
import RefreshButton from '$lib/components/RefreshButton.svelte';
import { Delete, Pause, Play } from '$lib/plugins';

// Declar vars
//let sortKey = $state<'name' | 'status' | 'totalSize' | 'rateDownload' | 'eta'>('name');
let sortKey = $state<string>('name');
let sortDir = $state<'asc' | 'desc'>('asc');
let filterName = $state('');
let filePriorities = $state<Record<string, number>>({}); // Temp priorities before save
let lastSelectedId = $state<number>(-1); // For shift-select (added in #6)
// NEW: Resize state/effect (document-level drag)
let resizingColIndex = $state<number | null>(null);
let dragStartX = $state(0);
let dragStartWidth = $state('');
let dragStartRightWidth = $state('');

// prettier-ignore
const columns = $state<ColumnConfig[]>([
    { key: 'name', label: 'Name', width: '256px', minWidth: '120px', align: 'left', sortable: true, resizable: true, isVisible: true },
    { key: 'status', label: 'Status', width: '112px', minWidth: '80px', align: 'center', sortable: true, resizable: true, isVisible: true },
    { key: 'totalSize', label: 'Size', width: '96px', minWidth: '72px', align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: true },
    { key: 'rateDownload', label: 'DL', width: '96px', minWidth: '72px', align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: true },
    { key: 'eta', label: 'ETA', width: '80px', minWidth: '64px', align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: true },  // No resizer before Actions
    // Begin optional columns (isVisible: false by default)
    { key: 'private', label: 'Private', width: '72px', minWidth: '60px', align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
    { key: 'ul', label: 'UL', width: '96px', minWidth: '72px', align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
    { key: 'activeSeeders', label: 'Seeds', width: '80px', minWidth: '64px', align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
    { key: 'added', label: 'Added', width: '112px', minWidth: '80px', align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
    { key: 'basePath', label: 'Path', width: '200px', minWidth: '120px', align: 'left', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
    { key: 'done', label: 'Done', width: '112px', minWidth: '80px', align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
    { key: 'error', label: 'Error', width: '120px', minWidth: '96px', align: 'left', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
    { key: 'queuePos', label: 'Queue', width: '72px', minWidth: '60px', align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
    { key: 'seedRatio', label: 'Ratio', width: '80px', minWidth: '64px', align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
    { key: 'leechers', label: 'Leechers', width: '94px', minWidth: '72px', align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
    { key: 'trackers', label: 'Trackers', width: '200px', minWidth: '140px', align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false }
  ]);

// Column toggle state and helpers
let selectedColumnKey = $state<string>(''); // Dummy for DDSelector ('' = "Columns")

const columnOptions = $derived(
  // Real columns (reactive visibility via option.visible for DDSelector icon mode)
  columns.map(
    (col): DropdownOption<string> => ({
      value: col.key,
      label: col.label,
      visible: col.isVisible
    })
  ) as DropdownOption<string>[]
);

function toggleColumnVisibility(key: string) {
  if (!key) return; // Ignore dummy

  const col = columns.find((c) => c.key === key);
  if (!col) return;

  const wasVisible = col.isVisible;
  col.isVisible = !col.isVisible;

  // Optional: Auto-redistribute if newly visible (smooth fit, scales all visible)
  if (!wasVisible) {
    setTimeout(redistributeWidths, 0); // Post-render
  }
}

// Only visible columns for rendering/width calcs (object refs preserved for mutation)
const visibleColumns = $derived(columns.filter((col) => col.isVisible));

// Min table width: ensures horizontal scroll triggers when columns exceed container
const minTableWidth = $derived(
  `${48 + 128 + visibleColumns.reduce((sum, col) => sum + parseFloat(col.width.slice(0, -2)), 0)}px`
);

// Redistribute available viewport space proportionally across visible columns
// so the table fills the browser exactly at load time (no horizontal scroll needed by default).
function redistributeWidths() {
  // Sidebar is now in normal flow (flex sibling of main), so its width is subtracted directly.
  // main has px-6 (24px each side = 48px total). Scrollbar gutter on body div = 8px.
  const sidebarW = window.innerWidth >= 1024 ? 256 : 0;
  const hPad = 48; // px-6 × 2 sides on <main>
  const scrollbarGutter = 8; // scrollbar-gutter: stable on body div reserves 8px
  const checkboxW = 48;
  const actionsW = 128;
  const available = window.innerWidth - sidebarW - hPad - scrollbarGutter - checkboxW - actionsW;
  const visibleCols = columns.filter((col) => col.isVisible);
  const defaultW = visibleCols.map((col) => parseFloat(col.width.slice(0, -2)));
  const totalDefault = defaultW.reduce((a, b) => a + b, 0);
  visibleCols.forEach((col, i) => {
    // Mutate only visible cols
    col.width = `${Math.max(
      parseFloat(col.minWidth?.slice(0, -2) ?? '60'),
      Math.floor((available * defaultW[i]) / totalDefault)
    )}px`;
  });
}

// On mount: distribute available viewport space proportionally across visible columns
onMount(() => {
  redistributeWidths(); // Initial distribution
});

// Keep layoutMinWidth store in sync so layout.svelte's inner wrapper knows the total
// content width (sidebar + table). Runs whenever minTableWidth changes (column resize).
$effect(() => {
  const sidebarW = window.innerWidth >= 1024 ? 256 : 0;
  const tableW = parseFloat(minTableWidth);
  layoutMinWidth.set(`${sidebarW + tableW}px`);
});

// NEW: Dynamic columns (future-proof: push new {key,label,width,...}; extend getDisplayValue/getSortValue)
interface ColumnConfig {
  key: string;
  label: string;
  width: string;
  minWidth?: string;
  align: 'left' | 'right' | 'center';
  headerAlign?: 'left' | 'right' | 'center';
  sortable: boolean;
  resizable: boolean;
  isVisible: boolean;
}

$effect(() => {
  const colIdx = resizingColIndex;
  if (colIdx !== null) {
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStartX;
      const col = visibleColumns[colIdx]; // Use visible ref so indexes match rendered order
      const startW = parseFloat(dragStartWidth.slice(0, -2));
      const minW = parseFloat(col.minWidth?.slice(0, -2) ?? '60');
      const newWidth = Math.max(minW, startW + delta);
      const actualDelta = newWidth - startW;
      col.width = `${newWidth}px`; // Mutates original via ref
      const nextIdx = colIdx + 1;
      if (nextIdx < visibleColumns.length && dragStartRightWidth) {
        // NEW: visible length
        const nextCol = visibleColumns[nextIdx];
        const rightStartW = parseFloat(dragStartRightWidth.slice(0, -2));
        const rightMin = parseFloat(nextCol.minWidth?.slice(0, -2) ?? '60');
        nextCol.width = `${Math.max(rightMin, rightStartW - actualDelta)}px`;
      }
    };
    const handleMouseUp = () => {
      resizingColIndex = null;
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
    };
  }
});

function handleSelectAll(event: Event) {
  const target = event.target as HTMLInputElement;
  if (target.checked) {
    selectedTorrents.set(filteredTorrents.map((t) => t.id));
  } else {
    selectedTorrents.set([]);
  }
  lastSelectedId = -1;
}

function handleToggle(event: MouseEvent, id: number) {
  const target = event.target as HTMLInputElement;
  const currentSelected = $selectedTorrents;
  let newSelected: number[];

  if (event.shiftKey && lastSelectedId >= 0) {
    // Range select in current filtered view
    const index1 = filteredTorrents.findIndex((t) => t.id === lastSelectedId);
    const index2 = filteredTorrents.findIndex((t) => t.id === id);
    const minIdx = Math.min(index1, index2);
    const maxIdx = Math.max(index1, index2);
    newSelected = filteredTorrents.slice(minIdx, maxIdx + 1).map((t) => t.id);
  } else {
    if (target.checked) {
      newSelected = currentSelected.includes(id) ? currentSelected : [...currentSelected, id];
    } else {
      newSelected = currentSelected.filter((s) => s !== id);
    }
  }

  selectedTorrents.set(newSelected);
  lastSelectedId = id;
}

// Escape close effect (runs when modal open)
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

// FIXED: Exact table width (no stretch/distribution); checkbox 48px + actions 128px + sum cols
//const tableWidth = $derived(
//  `${48 + 128 + columns.reduce((sum, col) => sum + parseFloat(col.width.slice(0, -2)), 0)}px`
//);

// Computed sorted/filtered torrents (reactive via $derived)
const sortedTorrents = $derived(
  $torrents.toSorted((a, b) => {
    const valA = getSortValue(a, sortKey);
    const valB = getSortValue(b, sortKey);
    if (typeof valA === 'string' && typeof valB === 'string') {
      return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  })
);

const filteredTorrents = $derived(
  sortedTorrents.filter((t) => t.name.toLowerCase().includes(filterName.toLowerCase()))
);

// NEW: Dynamic display/sort values
function getDisplayValue(t: Torrent, key: string): string {
  // prettier-ignore
  switch (key) {
      case 'name': return t.name;
      case 'status': return statusText(t.status, t.error, t.errorString);
      case 'totalSize': return formatBytes(t.totalSize);
      case 'rateDownload': return formatSpeed(t.rateDownload);
      case 'eta': return t.eta < 0 ? '—' : `${Math.round(t.eta / 60)}m`;
      case 'private': return t.isPrivate ? '✓' : '✗';
      case 'ul': return formatSpeed(t.rateUpload ?? 0);
      case 'activeSeeders': return t.peersSendingToUs?.toString() ?? '—';
      case 'added': return t.addedDate ? new Date(t.addedDate * 1000).toLocaleDateString() : '—';
      case 'basePath': return t.downloadDir ?? '—';
      case 'done': return t.doneDate ? new Date(t.doneDate * 1000).toLocaleDateString() : '—';
      case 'error': return t.errorString ?? '—';
      case 'queuePos': return t.queuePosition?.toString() ?? '—';
      case 'seedRatio': return t.seedRatio ? t.seedRatio.toFixed(2) : '—';
      case 'leechers': return t.peersGettingFromUs?.toString() ?? '—';
      case 'trackers': return (t.trackers ?? []).map(tr => tr.announce.split('/')[2]).filter(Boolean).join(', ') || '—';
      default: return '';
    }
}

//function getSortValue(t: Torrent, key: typeof sortKey): string | number {
function getSortValue(t: Torrent, key: string): string | number {
  // prettier-ignore
  switch (key) {
      case 'name': return t.name.toLowerCase();
      case 'status': return t.status;
      case 'totalSize': return t.totalSize;
      case 'rateDownload': return t.rateDownload;
      case 'eta': return t.eta >= 0 ? t.eta : Infinity;  // Sort unknowns last
      case 'private': return t.isPrivate ? 1 : 0;
      case 'ul': return t.rateUpload ?? 0;
      case 'activeSeeders': return t.peersSendingToUs ?? 0;
      case 'added': return t.addedDate ?? 0;
      case 'basePath': return t.downloadDir ?? '';
      case 'done': return t.doneDate ?? 0;
      case 'error': return (t.errorString ?? '').toLowerCase();
      case 'queuePos': return t.queuePosition ?? Infinity;
      case 'seedRatio': return t.seedRatio ?? 0;
      case 'leechers': return t.peersGettingFromUs ?? 0;
      case 'trackers': return (t.trackers ?? []).length;
      default: return t.name.toLowerCase();
    }
}

// NEW: Status badge class
function statusClass(status: number, error: number): string {
  if (error > 0) return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200';
  if (status === 4) return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200';
  if (status === 0) return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
  return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200';
}

//function toggleSort(key: 'name' | 'status' | 'totalSize' | 'rateDownload' | 'eta') {
function toggleSort(key: string) {
  if (sortKey === key) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey = key;
    sortDir = 'asc';
  }
}

function openFiles(t: Torrent) {
  currentTorrent.set(t);
  refreshTorrent(t.id); // Fetch details
}

async function savePriorities() {
  if ($currentTorrent && Object.keys(filePriorities).length > 0) {
    try {
      await updateFilePriorities($currentTorrent.id, filePriorities);
      await refreshTorrent($currentTorrent.id);
      filePriorities = {}; // Reset
    } catch (err: unknown) {
      error.set(err instanceof Error ? err.message : 'Save failed');
    }
  }
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

function formatSpeed(bytesPerSec: number): string {
  return bytesPerSec > 0 ? formatBytes(bytesPerSec) + '/s' : '—';
}

function statusText(status: number, err: number, errString?: string): string {
  if (err > 0) return errString || 'Error';
  const map: Record<number, string> = {
    0: 'Stopped',
    1: 'Check Wait',
    2: 'Checking',
    3: 'DL Wait',
    4: 'Downloading',
    5: 'Seed Wait',
    6: 'Seeding'
  };
  return map[status] ?? 'Unknown';
}
</script>

<div class="flex min-h-0 flex-1 flex-col space-y-4" style="min-width: {minTableWidth}">
  <!-- Global Error (above table, flex space) -->
  <!-- Global Error (above table, flex space) -->
  {#if $error}
    <div
      class="rounded-xl border border-red-200 bg-red-100 p-4 text-red-800 dark:border-red-800 dark:bg-red-900/50 dark:text-red-200"
    >
      {$error}
    </div>
  {/if}
  <!-- Loading or Full Table (flex-1 fills viewport) -->
  {#if $isLoading && $torrents.length === 0}
    <div class="flex flex-1 items-center justify-center">
      <div class="text-lg text-gray-500 dark:text-gray-400">Loading torrents...</div>
    </div>
  {:else}
    <!-- Full-Height Table Wrapper -->
    <div
      class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/50 bg-white/80 shadow-xl backdrop-blur dark:border-gray-700/50 dark:bg-gray-800/80"
    >
      <!-- Fixed Filter Section -->
      <div
        class="flex-none rounded-tl-2xl rounded-tr-2xl border-b border-gray-200/50 bg-white/95 p-4 backdrop-blur-md dark:border-gray-700/50 dark:bg-gray-800/95"
      >
        <!-- The followign line is commented out to attempt replacing style="width: {tableWidth}" with w-full in the next div element --->
        <!-- <div class="flex flex-col md:flex-row gap-4 items-center justify-between" style="width: {tableWidth}"> -->
        <div class="flex w-full flex-col items-center justify-between gap-4 md:flex-row">
          <!-- Columns Toggle (left of filter input, above checkbox col; uses DDSelector SVG arrow) -->
          <DDSelector
            bind:value={selectedColumnKey}
            options={columnOptions}
            onChange={toggleColumnVisibility}
            stickyDropdownTitle={true}
            dummyValue="Columns"
            enableMultiSelect={true}
            setMDIstatusIcon="CircleMedium"
            iconClass="w-4 h-4 flex-shrink-0"
            class="h-7.5 w-28 flex-shrink-0"
          />
          <input
            bind:value={filterName}
            placeholder="Filter torrents by name..."
            class="flex-1 rounded-xl border border-gray-300 p-3 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
          <div class="flex-shrink-0 text-sm text-gray-500 dark:text-gray-400">
            {filteredTorrents.length} torrents ({$selectedTorrents.length} selected)
          </div>
        </div>
      </div>
      <!-- Fixed Table (thead) Section -->
      <div
        class="flex-none border-b border-gray-200/50 bg-gray-50/95 dark:border-gray-700/50 dark:bg-gray-700/95"
      >
        <table class="table-fixed" style="min-width: {minTableWidth}; width: 100%">
          <thead>
            <tr>
              <!-- Static Checkbox TH (tight padding, no gap) -->
              <!-- OLD <th> below for Static Checkbox TH, though the new one was adjusted to style="width: 48px; from 44px; -->
              <!-- th class="px-2 text-left font-medium text-sm w-[48px] h-12 flex items-center justify-center relative" style="width: 48px;"
              <th class="px-2 w-[48px] h-12 flex items-center justify-center relative sticky left-0 z-20 bg-gray-50/95 dark:bg-gray-700/95 border-r border-gray-200/50 dark:border-gray-700/50" style="width: 48px;"> -->
              <th
                class="relative h-12 w-[48px] px-2 pr-0 text-center align-middle"
                style="width: 48px;"
              >
                <input
                  type="checkbox"
                  checked={$selectedTorrents.length === filteredTorrents.length &&
                    filteredTorrents.length > 0}
                  indeterminate={$selectedTorrents.length > 0 &&
                    $selectedTorrents.length < filteredTorrents.length}
                  onchange={(event: Event) => handleSelectAll(event)}
                  class="h-4 w-4 rounded border-gray-300 text-blue-600 shadow-sm focus:ring-blue-500"
                />
              </th>
              <!-- Dynamic Resizable THs: Name pl-0 (abut checkbox), truncate all -->
              {#each visibleColumns as col, colIdx (col.key)}
                <th
                  class="{col.key === 'name'
                    ? 'pt-2 pr-2 pb-2 pl-2'
                    : 'p-2'} relative overflow-hidden text-xs font-medium {{
                    right: 'text-right',
                    center: 'text-center',
                    left: 'text-left'
                  }[col.headerAlign ?? col.align]}"
                  style={col.key === 'name'
                    ? `width: ${col.width}; min-width: ${col.minWidth ?? '120px'}`
                    : `width: ${col.width}; min-width: ${col.minWidth ?? '60px'}`}
                >
                  {#if col.key === 'name'}
                    <button
                      type="button"
                      class="inline-flex max-w-full cursor-pointer items-center justify-center truncate text-left text-xs font-medium whitespace-nowrap {sortKey ===
                      col.key
                        ? 'text-blue-600 [text-shadow:0_0_1px_currentColor] hover:text-gray-900 dark:text-blue-400 dark:hover:text-gray-400'
                        : 'text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-400'}"
                      title={col.label}
                      onmousedown={(e) => e.stopPropagation()}
                      onclick={(e) => {
                        e.stopPropagation();
                        toggleSort(col.key);
                      }}
                    >
                      {col.label}
                      {sortKey === col.key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="inline-flex max-w-full cursor-pointer items-center justify-center truncate text-xs font-medium whitespace-nowrap {sortKey ===
                      col.key
                        ? 'text-blue-600 [text-shadow:0_0_1px_currentColor] hover:text-gray-900 dark:text-blue-400 dark:hover:text-gray-400'
                        : 'text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-400'}"
                      title={col.label}
                      onmousedown={(e) => e.stopPropagation()}
                      onclick={(e) => {
                        e.stopPropagation();
                        toggleSort(col.key);
                      }}
                    >
                      {col.label}
                      {sortKey === col.key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  {/if}
                  {#if col.resizable}
                    <div
                      role="slider"
                      tabindex="0"
                      aria-valuenow={parseFloat(col.width.slice(0, -2))}
                      aria-valuemin={parseFloat(col.minWidth?.slice(0, -2) ?? '60')}
                      aria-valuemax="500"
                      //class="absolute right-0 inset-y-0 cursor-col-resize opacity-70 hover:opacity-100 transition-all duration-200 ease-in-out"
                      class="absolute inset-y-0 right-0 w-[2.5px] cursor-col-resize bg-gradient-to-b from-transparent via-gray-400/60 to-transparent opacity-50 transition-all duration-400 ease-in-out hover:bg-gray-400 hover:opacity-100 dark:via-gray-950/60 dark:hover:bg-gray-800"
                      //style="width:2.25px; background: linear-gradient(to bottom, rgba(248,250,252,0.95) 0%, rgba(248,250,252,0.95) 32%, #9ca3af 68%, rgba(248,250,252,0.95) 100%)"
                      onmousedown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        resizingColIndex = colIdx;
                        dragStartX = e.clientX;
                        dragStartWidth = col.width;
                        dragStartRightWidth =
                          colIdx + 1 < visibleColumns.length
                            ? visibleColumns[colIdx + 1].width
                            : '';
                      }}
                      onclick={(e) => e.stopPropagation()}
                      onkeydown={(e: KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          resizingColIndex = colIdx;
                          dragStartX = 0;
                          dragStartWidth = col.width;
                        }
                      }}
                    ></div>
                  {/if}
                </th>
              {/each}
              <!-- Spacer TH: absorbs extra browser width so named columns stay fixed -->
              <th class="relative" aria-hidden="true"></th>
              <!-- Static Actions TH -->
              <!-- Last Attempt to Pin Actions TH
              <th class="px-2 text-left font-medium text-sm w-[128px] h-12 flex items-center justify-end relative" style="width: 128px;">
                Actions -->
              <th
                class="relative h-12 px-2 text-center align-middle text-xs font-medium"
                style="width: 128px;"
              >
                <div class="block truncate whitespace-nowrap" title="Actions">Actions</div>
              </th>
            </tr>
          </thead>
        </table>
      </div>
      <!-- Scrollable Tbody ONLY -->
      <div
        class="min-h-0 flex-1 overflow-y-auto"
        style="overflow-x: clip; scrollbar-gutter: stable"
      >
        <table class="table-fixed" style="min-width: {minTableWidth}; width: 100%">
          <tbody class="divide-y divide-gray-100/50 dark:divide-gray-700/50">
            {#each filteredTorrents as torrent (torrent.id)}
              {@const isSelected = $selectedTorrents.includes(torrent.id)}
              <tr
                class="h-12 cursor-pointer bg-white transition-colors hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700 {isSelected
                  ? 'bg-blue-50 ring-2 ring-blue-200/50 dark:bg-blue-900 dark:ring-blue-800/50'
                  : ''}"
                ondblclick={() => openFiles(torrent)}
              >
                <!-- Static Checkbox TD -->
                <!-- The following line is being replaced by the one after it
                <td class="px-2 w-[48px] flex items-center justify-center" style="width: 48px;">
                <td class="px-2 w-[48px] flex items-center justify-center relative sticky left-0 z-10 bg-white/80 dark:bg-gray-800/80 border-r border-gray-200/50 dark:border-gray-700/50" style="width: 48px;"> -->
                <td
                  class="relative h-12 w-[48px] px-2 pr-0 text-center align-middle"
                  style="width: 48px;"
                >
                  <input
                    type="checkbox"
                    checked={$selectedTorrents.includes(torrent.id)}
                    onclick={(event: MouseEvent) => {
                      event.stopPropagation();
                      handleToggle(event, torrent.id);
                    }}
                    class="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 shadow-sm focus:ring-blue-500"
                  />
                </td>
                <!-- Dynamic TDs: Name pl-0 (abut checkbox), truncate/overflow all -->
                {#each visibleColumns as col (col.key)}
                  <!-- The following line is being replaced by the one after it
                  <td class="p-2 text-xs overflow-hidden {col.align === 'right' ? 'text-right' : 'text-left'} {col.key === 'name' ? 'font-medium' : ''}" style="width: {col.width}; min-width: {col.minWidth ?? '60px'};"> -->
                  <td
                    class="{col.key === 'name'
                      ? 'pt-2 pr-2 pb-2 pl-2 font-medium'
                      : 'p-2'} relative overflow-hidden text-xs {{
                      right: 'text-right',
                      center: 'text-center',
                      left: 'text-left'
                    }[col.align]}"
                    style={col.key === 'name'
                      ? `width: ${col.width}; min-width: ${col.minWidth ?? '120px'}`
                      : `width: ${col.width}; min-width: ${col.minWidth ?? '60px'}`}
                  >
                    {#if col.key === 'name'}
                      <span
                        class="block truncate overflow-hidden text-left whitespace-nowrap"
                        title={torrent.name}>{getDisplayValue(torrent, col.key)}</span
                      >
                    {:else if col.key === 'status'}
                      <span
                        class="rounded-full px-1.5 py-0.5 font-medium {statusClass(
                          torrent.status,
                          torrent.error
                        )} max-w-full truncate"
                        title={statusText(torrent.status, torrent.error, torrent.errorString)}
                      >
                        {statusText(torrent.status, torrent.error, torrent.errorString)}
                      </span>
                    {:else}
                      <div
                        class="block truncate overflow-hidden whitespace-nowrap {{
                          right: 'text-right',
                          center: 'text-center',
                          left: 'text-left'
                        }[col.align]}"
                        title={getDisplayValue(torrent, col.key)}
                      >
                        {getDisplayValue(torrent, col.key)}
                      </div>
                    {/if}
                  </td>
                {/each}
                <!-- Spacer TD: absorbs extra browser width -->
                <td aria-hidden="true"></td>
                <!-- Pinned Actions TD: no border, lighter bg, tight space/shadow-none -->
                <!-- The following commented lines were replaced by the one after it
                <td class="px-2 flex items-center space-x-1 justify-end w-[128px]" style="width: 128px;">
                <td class="px-2 flex items-center space-x-1 justify-end w-[128px] relative sticky right-0 z-10 bg-white/80 dark:bg-gray-800/80 border-l border-gray-200/50 dark:border-gray-700/50" style="width: 128px;"> -->
                <td class="relative w-[128px] px-2 align-middle" style="width: 128px;">
                  <div class="flex items-center justify-center space-x-0.5">
                    <button
                      onclick={(event) => {
                        event.stopPropagation();
                        performActionAndRefresh([torrent.id], 'start');
                      }}
                      class="flex h-6 w-6 items-center justify-center rounded bg-green-600 p-0.5 text-white shadow-none transition-colors hover:bg-green-700"
                    >
                      <Play class="h-4 w-4" />
                    </button>
                    <button
                      onclick={(event) => {
                        event.stopPropagation();
                        performActionAndRefresh([torrent.id], 'stop');
                      }}
                      class="flex h-6 w-6 items-center justify-center rounded bg-yellow-600 p-0.5 text-white shadow-none transition-colors hover:bg-yellow-700"
                    >
                      <Pause class="h-4 w-4" />
                    </button>
                    <button
                      onclick={(event) => {
                        event.stopPropagation();
                        performActionAndRefresh([torrent.id], 'remove');
                      }}
                      class="flex h-6 w-6 items-center justify-center rounded bg-red-600 p-0.5 text-white shadow-none transition-colors hover:bg-red-700"
                    >
                      <Delete class="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>

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
              <th class="p-3 text-center font-medium">% Done</th>
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
                      class="relative mx-auto h-6 w-28 overflow-hidden rounded-2xl border border-gray-200/50 bg-gray-200/90 shadow-sm dark:border-gray-700/50 dark:bg-gray-700/90"
                    >
                      <!-- Progress Fill (absolute, behind text) -->
                      <div
                        class="absolute top-0 left-0 h-full rounded-2xl bg-gradient-to-r from-green-500 to-green-600 shadow-inner transition-all duration-500 dark:from-green-600 dark:to-green-700"
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
                      value={filePriorities[i] ?? stat.priority}
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

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
  type DropdownOption,
  type Torrent
} from '$lib';

import DDSelector from '$lib/components/DDSelector.svelte';
import SeedsTooltip from '$lib/components/SeedsTooltip.svelte';
import { defaultColumns, type ColumnConfig } from '$lib/config/columns';
import { formatBytes, formatSpeed } from '$lib/helpers';
import { Delete, Pause, Play } from '$lib/plugins';

let sortKey = $state<string>('name');
let sortDir = $state<'asc' | 'desc'>('asc');
let filterName = $state('');
let lastSelectedId = $state<number>(-1);
// Resize drag state (document-level drag)
let resizingColIndex = $state<number | null>(null);
let dragStartX = $state(0);
let dragStartWidth = $state('');
let dragStartRightWidth = $state('');

// Spread each entry so Svelte gets fresh, independently-proxied objects
const columns = $state<ColumnConfig[]>(defaultColumns.map((c) => ({ ...c })));

// Column toggle state ('' = no real selection; DDSelector shows "Columns" as sticky title)
let selectedColumnKey = $state<string>('');

const columnOptions = $derived(
  columns.map(
    (col): DropdownOption<string> => ({
      value: col.key,
      label: col.label,
      visible: col.isVisible
    })
  ) as DropdownOption<string>[]
);

function toggleColumnVisibility(key: string) {
  if (!key) return;
  const col = columns.find((c) => c.key === key);
  if (!col) return;
  const wasVisible = col.isVisible;
  col.isVisible = !col.isVisible;
  // Auto-redistribute if a column was just made visible so the table still fills the viewport
  if (!wasVisible) {
    setTimeout(redistributeWidths, 0);
  }
}

// Only visible columns for rendering and width calculations (object refs preserved for mutation)
const visibleColumns = $derived(columns.filter((col) => col.isVisible));

// Min table width: triggers horizontal scroll when columns exceed the container
const minTableWidth = $derived(
  `${48 + 128 + visibleColumns.reduce((sum, col) => sum + parseFloat(col.width.slice(0, -2)), 0)}px`
);

// Redistribute available viewport space proportionally across visible columns so the
// table fills the browser exactly at load time (no horizontal scroll needed by default).
function redistributeWidths() {
  // Sidebar is a flex sibling of <main>, so its width is subtracted directly.
  // <main> has px-6 (24px × 2 = 48px). Body div scrollbar-gutter: stable reserves 8px.
  const sidebarW = window.innerWidth >= 1024 ? 256 : 0;
  const hPad = 48;
  const scrollbarGutter = 8;
  const checkboxW = 48;
  const actionsW = 128;
  const available = window.innerWidth - sidebarW - hPad - scrollbarGutter - checkboxW - actionsW;
  const visibleCols = columns.filter((col) => col.isVisible);
  const defaultW = visibleCols.map((col) => parseFloat(col.width.slice(0, -2)));
  const totalDefault = defaultW.reduce((a, b) => a + b, 0);
  visibleCols.forEach((col, i) => {
    col.width = `${Math.max(
      parseFloat(col.minWidth?.slice(0, -2) ?? '60'),
      Math.floor((available * defaultW[i]) / totalDefault)
    )}px`;
  });
}

onMount(() => {
  redistributeWidths();
});

// Keep layoutMinWidth store in sync so +layout.svelte's inner wrapper knows the total
// content width (sidebar + table). Runs whenever minTableWidth changes (column resize).
$effect(() => {
  const sidebarW = window.innerWidth >= 1024 ? 256 : 0;
  const tableW = parseFloat(minTableWidth);
  layoutMinWidth.set(`${sidebarW + tableW}px`);
});

// Document-level mouse drag for column resizing
$effect(() => {
  const colIdx = resizingColIndex;
  if (colIdx !== null) {
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStartX;
      const col = visibleColumns[colIdx];
      const startW = parseFloat(dragStartWidth.slice(0, -2));
      const minW = parseFloat(col.minWidth?.slice(0, -2) ?? '60');
      const newWidth = Math.max(minW, startW + delta);
      const actualDelta = newWidth - startW;
      col.width = `${newWidth}px`;
      const nextIdx = colIdx + 1;
      if (nextIdx < visibleColumns.length && dragStartRightWidth) {
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
    // Range select within the current filtered view
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

function getDisplayValue(t: Torrent, key: string): string {
  // prettier-ignore
  switch (key) {
    case 'name':          return t.name;
    case 'status':        return statusText(t.status, t.error, t.errorString);
    case 'totalSize':     return formatBytes(t.totalSize);
    case 'rateDownload':  return formatSpeed(t.rateDownload);
    case 'eta':           return t.eta < 0 ? '—' : `${Math.round(t.eta / 60)}m`;
    case 'private':       return t.isPrivate ? '✓' : '✗';
    case 'ul':            return formatSpeed(t.rateUpload ?? 0);
    case 'activeSeeders': return `${t.peersSendingToUs ?? 0} : ${maxSeedersFor(t) >= 0 ? maxSeedersFor(t) : '—'}`;
    case 'added':         return t.addedDate ? new Date(t.addedDate * 1000).toLocaleDateString() : '—';
    case 'basePath':      return t.downloadDir ?? '—';
    case 'done':          return t.doneDate ? new Date(t.doneDate * 1000).toLocaleDateString() : '—';
    case 'error':         return t.errorString ?? '—';
    case 'queuePos':      return t.queuePosition?.toString() ?? '—';
    case 'seedRatio':     return t.seedRatio ? t.seedRatio.toFixed(2) : '—';
    case 'leechers':      return t.peersGettingFromUs?.toString() ?? '—';
    case 'trackers':      return (t.trackers ?? []).map(tr => tr.announce.split('/')[2]).filter(Boolean).join(', ') || '—';
    default:              return '';
  }
}

function getSortValue(t: Torrent, key: string): string | number {
  // prettier-ignore
  switch (key) {
    case 'name':          return t.name.toLowerCase();
    case 'status':        return t.status;
    case 'totalSize':     return t.totalSize;
    case 'rateDownload':  return t.rateDownload;
    case 'eta':           return t.eta >= 0 ? t.eta : Infinity;
    case 'private':       return t.isPrivate ? 1 : 0;
    case 'ul':            return t.rateUpload ?? 0;
    case 'activeSeeders': return t.peersSendingToUs ?? 0;
    case 'added':         return t.addedDate ?? 0;
    case 'basePath':      return t.downloadDir ?? '';
    case 'done':          return t.doneDate ?? 0;
    case 'error':         return (t.errorString ?? '').toLowerCase();
    case 'queuePos':      return t.queuePosition ?? Infinity;
    case 'seedRatio':     return t.seedRatio ?? 0;
    case 'leechers':      return t.peersGettingFromUs ?? 0;
    case 'trackers':      return (t.trackers ?? []).length;
    default:              return t.name.toLowerCase();
  }
}

function statusClass(status: number, err: number): string {
  if (err > 0) return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200';
  if (status === 4) return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200';
  if (status === 0) return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
  return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200';
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

function maxSeedersFor(t: Torrent): number {
  if (!t.trackerStats || t.trackerStats.length === 0) return -1;
  return Math.max(...t.trackerStats.map((ts) => ts.seederCount));
}

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
  refreshTorrent(t.id);
}
</script>

<div class="flex min-h-0 flex-1 flex-col space-y-4" style="min-width: {minTableWidth}">
  <!-- Global Error Banner -->
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
        <div class="flex w-full flex-col items-center justify-between gap-4 md:flex-row">
          <!-- Columns Toggle (left of filter input; uses DDSelector SVG arrow) -->
          <DDSelector
            bind:value={selectedColumnKey}
            options={columnOptions}
            onChange={toggleColumnVisibility}
            stickyDropdownTitle={true}
            dummyValue="Columns"
            enableMultiSelect={true}
            setMDIstatusIcon="CircleMedium"
            iconClass="w-4 h-4 flex-shrink-0"
            class="mx-auto w-28 flex-shrink-0"
            dropdownHeight="p-[4px]"
            dropdownBtnTxtSize="text-md"
          />
          <input
            bind:value={filterName}
            placeholder="Filter torrents by name..."
            class="border-ColorPalette-border-quaternary bg-ColorPalette-bg-tertiary/90 text-ColorPalette-text-primary text-md flex-1 rounded-md border p-[4px] focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <div class="text-ColorPalette-text-senary flex-shrink-0 text-sm">
            {filteredTorrents.length} torrents ({$selectedTorrents.length} selected)
          </div>
        </div>
      </div>
      <!-- Fixed Table Header (thead only) -->
      <div
        class="flex-none border-b border-gray-200/50 bg-gray-50/95 dark:border-gray-700/50 dark:bg-gray-700/95"
      >
        <table class="table-fixed" style="min-width: {minTableWidth}; width: 100%">
          <thead>
            <tr>
              <!-- Static Checkbox TH -->
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
                  class="h-4 w-4 rounded border-gray-300 text-blue-600 shadow-sm focus:ring-blue-500 focus:outline-none"
                />
              </th>
              <!-- Dynamic Resizable THs -->
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
                  <button
                    type="button"
                    class="inline-flex max-w-full cursor-pointer items-center {col.key === 'name'
                      ? 'justify-center text-left'
                      : 'justify-center'} truncate text-xs font-medium whitespace-nowrap {sortKey ===
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
                  {#if col.resizable}
                    <div
                      role="slider"
                      tabindex="0"
                      aria-valuenow={parseFloat(col.width.slice(0, -2))}
                      aria-valuemin={parseFloat(col.minWidth?.slice(0, -2) ?? '60')}
                      aria-valuemax="500"
                      class="absolute inset-y-0 right-0 w-[2.5px] cursor-col-resize bg-gradient-to-b from-transparent via-gray-400/60 to-transparent opacity-50 transition-all duration-400 ease-in-out hover:bg-gray-400 hover:opacity-100 dark:via-gray-950/60 dark:hover:bg-gray-800"
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
                <!-- Dynamic TDs -->
                {#each visibleColumns as col (col.key)}
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
                    {:else if col.key === 'activeSeeders'}
                      <div class="flex items-center justify-center gap-1.5">
                        <SeedsTooltip
                          torrentId={torrent.id}
                          seederCount={torrent.peersSendingToUs ?? 0}
                          maxSeeders={maxSeedersFor(torrent)}
                          trackerStats={torrent.trackerStats ?? []}
                        />
                        <span class="whitespace-nowrap tabular-nums">
                          {torrent.peersSendingToUs ?? 0}&nbsp;:&nbsp;{maxSeedersFor(torrent) >= 0
                            ? maxSeedersFor(torrent)
                            : '—'}
                        </span>
                      </div>
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
                <!-- Actions TD -->
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

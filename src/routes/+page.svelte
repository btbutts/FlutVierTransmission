<script lang="ts">
  import {
    torrents,
    selectedTorrents,
    isLoading,
    error,
    performActionAndRefresh,
    refreshTorrent,
    currentTorrent,
    updateFilePriorities,
  } from '$lib';
  import type { Torrent } from '$lib';
  import {
    Play,
    Pause,
    Delete,
  } from '$lib/plugins';

  let sortKey = $state<'name' | 'status' | 'totalSize' | 'rateDownload' | 'eta'>('name');
  let sortDir = $state<'asc' | 'desc'>('asc');
  let filterName = $state('');
  let filePriorities = $state<Record<string, number>>({});  // Temp priorities before save
  let lastSelectedId = $state<number>(-1);  // For shift-select (added in #6)

  function handleSelectAll(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.checked) {
      selectedTorrents.set(filteredTorrents.map(t => t.id));
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
      const index1 = filteredTorrents.findIndex(t => t.id === lastSelectedId);
      const index2 = filteredTorrents.findIndex(t => t.id === id);
      const minIdx = Math.min(index1, index2);
      const maxIdx = Math.max(index1, index2);
      newSelected = filteredTorrents.slice(minIdx, maxIdx + 1).map(t => t.id);
    } else {
      if (target.checked) {
        newSelected = currentSelected.includes(id) ? currentSelected : [...currentSelected, id];
      } else {
        newSelected = currentSelected.filter(s => s !== id);
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

  // Computed sorted/filtered torrents (reactive via $derived)
  // Pure reactive derives (fixes TS/store error: no mutation, toSorted() + explicit compare)
  const sortedTorrents = $derived($torrents.toSorted((a, b) => {
    const valA = getSortValue(a, sortKey);
    const valB = getSortValue(b, sortKey);
    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  }));

  const filteredTorrents = $derived(sortedTorrents.filter((t) =>
    t.name.toLowerCase().includes(filterName.toLowerCase())
  ));

  function getSortValue(t: Torrent, key: typeof sortKey): string | number {
    switch (key) {
      case 'name': return t.name.toLowerCase();
      case 'status': return t.status;
      case 'totalSize': return t.totalSize;
      case 'rateDownload': return t.rateDownload;
      case 'eta': return t.eta >= 0 ? t.eta : Infinity;  // Sort unknowns last
      default: return t.name;
    }
  }

  function toggleSort(key: 'name' | 'status' | 'totalSize' | 'rateDownload' | 'eta') {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
  }

  function openFiles(t: Torrent) {
    currentTorrent.set(t);
    refreshTorrent(t.id);  // Fetch details
  }

  async function savePriorities() {
    if ($currentTorrent && Object.keys(filePriorities).length > 0) {
      try {
        await updateFilePriorities($currentTorrent.id, filePriorities);
        await refreshTorrent($currentTorrent.id);
        filePriorities = {};  // Reset
      } catch (err: unknown) {
        error.set(err instanceof Error ? err.message : 'Save failed');
      }
    }
  }

  function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let val = bytes;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return `${val.toFixed(1)} ${units[i]}`;
  }

  function formatSpeed(bytesPerSec: number): string {
    return bytesPerSec > 0 ? formatBytes(bytesPerSec) + '/s' : '—';
  }

  function statusText(status: number, err: number, errString?: string): string {
    if (err > 0) return errString || 'Error';
    const map: Record<number, string> = {
      0: 'Stopped', 1: 'Check Wait', 2: 'Checking', 3: 'DL Wait',
      4: 'Downloading', 5: 'Seed Wait', 6: 'Seeding'
    };
    return map[status] ?? 'Unknown';
  }
</script>

<div class="h-full flex flex-col overflow-hidden space-y-4">
  <!-- Global Error -->
  {#if $error}
    <div class="bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200 p-4 rounded-xl border border-red-200 dark:border-red-800">
      {$error}
    </div>
  {/if}
  <!-- Toolbar -->
  {#if $isLoading && $torrents.length === 0}
    <div class="flex justify-center py-12">
      <div class="text-lg text-gray-500 dark:text-gray-400">Loading torrents...</div>
    </div>
  {:else}
    <!-- Sticky/Sliding Table (viewport fill) -->
    <div class="flex-1 bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-2xl shadow-xl overflow-hidden border border-gray-200/50 dark:border-gray-700/50">
      <div class="h-full overflow-auto">
        <!-- Sticky Filter Row (matches table min-w) -->
        <div class="sticky top-0 z-30 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md border-b border-gray-200/50 dark:border-gray-700/50 p-4">
          <div class="flex flex-col md:flex-row gap-4 items-center justify-between min-w-[800px]">
            <input
              bind:value={filterName}
              placeholder="Filter torrents by name..."
              class="flex-1 p-3 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
            />
            <div class="text-sm text-gray-500 dark:text-gray-400 flex-shrink-0">
              {filteredTorrents.length} torrents ({$selectedTorrents.length} selected)
            </div>
          </div>
        </div>
        <table class="w-full min-w-[800px] table-fixed">  <!-- table-fixed for sticky columns -->
          <thead class="sticky top-14 z-30 bg-gray-50/95 dark:bg-gray-700/95 backdrop-blur-sm border-b border-gray-200/50 dark:border-gray-700/50">
            <tr>
              <th class="p-3 text-left font-medium text-sm w-12 flex items-center">
                <input
                  type="checkbox"
                  checked={$selectedTorrents.length === filteredTorrents.length && filteredTorrents.length > 0}
                  indeterminate={$selectedTorrents.length > 0 && $selectedTorrents.length < filteredTorrents.length}
                  onchange={(event: Event) => handleSelectAll(event)}
                  class="rounded border-gray-300 text-blue-600 shadow-sm focus:ring-blue-500 h-4 w-4"
                />
              </th>  <!-- Fixed widths for scroll -->
              <th class="p-4 text-left font-medium text-sm cursor-pointer hover:text-blue-600" onclick={() => toggleSort('name')}>
                Name {sortKey === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </th>
              <th class="p-4 text-left font-medium text-sm cursor-pointer hover:text-blue-600" onclick={() => toggleSort('status')}>
                Status {sortKey === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </th>
              <th class="p-4 text-right font-medium text-sm cursor-pointer hover:text-blue-600 w-24" onclick={() => toggleSort('totalSize')}>
                Size {sortKey === 'totalSize' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </th>
              <th class="p-4 text-right font-medium text-sm cursor-pointer hover:text-blue-600 w-24" onclick={() => toggleSort('rateDownload')}>
                Down {sortKey === 'rateDownload' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </th>
              <th class="p-4 text-right font-medium text-sm cursor-pointer hover:text-blue-600 w-20" onclick={() => toggleSort('eta')}>
                ETA {sortKey === 'eta' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </th>
              <th class="p-3 text-left font-medium text-sm w-32">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100/50 dark:divide-gray-700/50">
            {#each filteredTorrents as torrent (torrent.id)}
              <tr
                class="hover:bg-gray-50/50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer {$selectedTorrents.includes(torrent.id) ? 'bg-blue-50/80 dark:bg-blue-900/30 ring-2 ring-blue-200/50 dark:ring-blue-800/50' : ''}"
                ondblclick={() => openFiles(torrent)}
              >
                <td class="p-3">
                  <input
                    type="checkbox"
                    checked={$selectedTorrents.includes(torrent.id)}
                    onclick={(event: MouseEvent) => {
                      event.stopPropagation();
                      handleToggle(event, torrent.id);
                    }}
                    class="rounded border-gray-300 text-blue-600 shadow-sm focus:ring-blue-500 h-4 w-4 cursor-pointer"
                  />
                </td>
                <td class="p-3 font-medium max-w-md truncate" title={torrent.name}>{torrent.name}</td>
                <td class="p-3">
                  <span class="px-2 py-1 rounded-full text-xs font-medium {
                    torrent.error > 0 ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200' :
                    torrent.status === 4 ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200' :
                    torrent.status === 0 ? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200' :
                    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200'
                  }">
                    {statusText(torrent.status, torrent.error, torrent.errorString)}
                  </span>
                </td>
                <td class="p-3 text-right text-sm">{formatBytes(torrent.totalSize)}</td>
                <td class="p-3 text-right text-sm">{formatSpeed(torrent.rateDownload)}</td>
                <td class="p-3 text-right text-sm">{torrent.eta < 0 ? '—' : `${Math.round(torrent.eta / 60)}m`}</td>
                <td class="p-3 flex items-center space-x-1 w-32">
                  <button onclick={(event) => { event.stopPropagation(); performActionAndRefresh([torrent.id], 'start'); }}
                          class="p-1 bg-green-600 hover:bg-green-700 text-white rounded transition-colors flex items-center justify-center w-6 h-6">
                    <Play class="w-5 h-5" />
                  </button>
                  <button onclick={(event) => { event.stopPropagation(); performActionAndRefresh([torrent.id], 'stop'); }}
                          class="p-1 bg-yellow-600 hover:bg-yellow-700 text-white rounded transition-colors flex items-center justify-center w-6 h-6">
                    <Pause class="w-5 h-5" />
                  </button>
                  <button onclick={(event) => { event.stopPropagation(); performActionAndRefresh([torrent.id], 'remove'); }}
                          class="p-1 bg-red-600 hover:bg-red-700 text-white rounded transition-colors flex items-center justify-center w-6 h-6">
                    <Delete class="w-5 h-5" />
                  </button>
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
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" 
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
    <div class="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <!-- Sticky Title + Buttons -->
      <div class="sticky top-0 z-20 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md border-b border-gray-200/50 dark:border-gray-700/50 p-8 flex justify-between items-center shrink-0">
        <h2 class="text-3xl font-bold flex-1 min-w-0 pr-4 break-words max-w-none" id="modal-title">Files: {$currentTorrent.name}</h2>
        <div class="flex space-x-2 flex-nowrap flex-shrink-0 min-w-[12rem]">
          <button onclick={() => refreshTorrent($currentTorrent!.id)} 
                  class="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm flex-shrink-0 transition-colors">Refresh</button>
          <button onclick={() => ($currentTorrent = null, filePriorities = {})} 
                  class="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg text-sm flex-shrink-0 transition-colors">Close</button>
          <button onclick={savePriorities} 
                  disabled={Object.keys(filePriorities).length === 0} 
                  class="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex-shrink-0 transition-colors">Save Priorities</button>
        </div>
      </div>
      <!-- Scrollable Table Container -->
      <div class="flex-1 min-h-0 overflow-y-auto p-8">
        <table class="w-full text-sm">
          <thead class="sticky top-0 z-10 bg-gray-50/95 dark:bg-gray-700/95 backdrop-blur-sm border-b border-gray-200/50 dark:border-gray-700/50">
            <tr>
              <th class="p-3 text-left font-medium">Name</th>
              <th class="p-3 text-right font-medium">Size</th>
              <th class="p-3 text-right font-medium">% Done</th>
              <th class="p-3 text-center font-medium">Priority</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100/50 dark:divide-gray-700/50">
            {#each $currentTorrent.files ?? [] as file, i (i)}
              {#if $currentTorrent.fileStats?.[i]}
                {@const stat = $currentTorrent.fileStats[i]}
                <tr class="hover:bg-gray-50/50 dark:hover:bg-gray-700/50 transition-colors">
                  <td class="p-3 font-medium max-w-md truncate" title={file.name}>{file.name}</td>
                  <td class="p-3 text-right">{formatBytes(file.length)}</td>
                  <td class="p-3 text-right">
                    <div class="w-24 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div class="bg-green-500 h-2 rounded-full transition-all" style="width: {(stat.bytesCompleted / file.length) * 100}%"></div>
                    </div>
                    <span class="ml-2 text-xs">{((stat.bytesCompleted / file.length) * 100).toFixed(1)}%</span>
                  </td>
                  <td class="p-3 text-center">
                    <select
                      value={filePriorities[i] ?? stat.priority}
                      class="p-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-xs bg-white/90 dark:bg-gray-700/90 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all cursor-pointer w-20 mx-auto appearance-none [&>option]:bg-white [&>option]:text-gray-900 dark:[&>option]:bg-gray-800 dark:[&>option]:text-gray-100"
                      onchange={(e) => {
                        const target = e.target as HTMLSelectElement;
                        filePriorities[i] = Number(target.value);
                      }}
                    >
                      <option value="-2">Skip</option>
                      <option value="-1">Low</option>
                      <option value="0">Normal</option>
                      <option value="1">High</option>
                    </select>
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

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

  let sortKey = $state<'name' | 'status' | 'totalSize' | 'rateDownload' | 'eta'>('name');
  let sortDir = $state<'asc' | 'desc'>('asc');
  let filterName = $state('');
  let filePriorities = $state<Record<string, number>>({});  // Temp priorities before save

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

<div class="p-8 space-y-6">
  <!-- Filter + Stats Row -->
  <div class="flex flex-col md:flex-row gap-4 items-center justify-between">
    <input
      bind:value={filterName}
      placeholder="Filter torrents by name..."
      class="flex-1 max-w-md p-3 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
    />
    <div class="text-sm text-gray-500 dark:text-gray-400">
      {$torrents.length} torrents ({$selectedTorrents.length} selected)
    </div>
  </div>

  {#if $error}
    <div class="bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200 p-4 rounded-xl border border-red-200 dark:border-red-800">
      {$error}
    </div>
  {/if}

  {#if $isLoading && $torrents.length === 0}
    <div class="flex justify-center py-12">
      <div class="text-lg text-gray-500 dark:text-gray-400">Loading torrents...</div>
    </div>
  {:else}
    <!-- Sortable Table -->
    <div class="bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-2xl shadow-xl overflow-hidden border border-gray-200/50 dark:border-gray-700/50">
      <table class="w-full">
        <thead>
          <tr class="bg-gray-50/50 dark:bg-gray-700/50">
            <th class="p-4 text-left font-medium text-sm">#</th>
            <th class="p-4 text-left font-medium text-sm cursor-pointer hover:text-blue-600" onclick={() => toggleSort('name')}>
              Name {sortKey === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </th>
            <th class="p-4 text-left font-medium text-sm cursor-pointer hover:text-blue-600" onclick={() => toggleSort('status')}>
              Status {sortKey === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </th>
            <th class="p-4 text-right font-medium text-sm cursor-pointer hover:text-blue-600" onclick={() => toggleSort('totalSize')}>
              Size {sortKey === 'totalSize' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </th>
            <th class="p-4 text-right font-medium text-sm cursor-pointer hover:text-blue-600" onclick={() => toggleSort('rateDownload')}>
              Down {sortKey === 'rateDownload' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </th>
            <th class="p-4 text-right font-medium text-sm cursor-pointer hover:text-blue-600" onclick={() => toggleSort('eta')}>
              ETA {sortKey === 'eta' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </th>
            <th class="p-4 text-left font-medium text-sm">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each filteredTorrents as torrent (torrent.id)}
            <tr
              class="hover:bg-gray-50/50 dark:hover:bg-gray-700/50 transition-colors border-t border-gray-100/50 dark:border-gray-700/50 cursor-pointer {$selectedTorrents.includes(torrent.id) ? 'bg-blue-50/80 dark:bg-blue-900/30 ring-2 ring-blue-200/50 dark:ring-blue-800/50' : ''}"
              onclick={() => openFiles(torrent)}
            >
              <td class="p-4">
                <input
                  type="checkbox"
                  bind:group={$selectedTorrents}
                  value={torrent.id}
                  class="rounded border-gray-300 text-blue-600 shadow-sm focus:ring-blue-500 h-4 w-4"
                />
              </td>
              <td class="p-4 font-medium max-w-md truncate" title={torrent.name}>{torrent.name}</td>
              <td class="p-4">
                <span class="px-2 py-1 rounded-full text-xs font-medium {
                  torrent.error > 0 ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200' :
                  torrent.status === 4 ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200' :
                  torrent.status === 0 ? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200' :
                  'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200'
                }">
                  {statusText(torrent.status, torrent.error, torrent.errorString)}
                </span>
              </td>
              <td class="p-4 text-right text-sm">{formatBytes(torrent.totalSize)}</td>
              <td class="p-4 text-right text-sm">{formatSpeed(torrent.rateDownload)}</td>
              <td class="p-4 text-right text-sm">{torrent.eta < 0 ? '—' : `${Math.round(torrent.eta / 60)}m`}</td>
              <td class="p-4 space-x-1">
                <button onclick={(event) => { event.stopPropagation(); performActionAndRefresh([torrent.id], 'start'); }}
                        class="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700">▶</button>
                <button onclick={(event) => { event.stopPropagation(); performActionAndRefresh([torrent.id], 'stop'); }}
                        class="px-2 py-1 bg-yellow-600 text-white text-xs rounded hover:bg-yellow-700">⏸</button>
                <button onclick={(event) => { event.stopPropagation(); performActionAndRefresh([torrent.id], 'remove'); }}
                        class="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700">🗑</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- Phase 2: Per-Torrent Files Modal -->
{#if $currentTorrent}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    <div class="bg-white dark:bg-gray-800 p-8 rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-3xl font-bold">Files: {$currentTorrent.name}</h2>
        <div class="space-x-2">
          <button onclick={() => refreshTorrent($currentTorrent!.id)}
                  class="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm">Refresh</button>
          <button onclick={() => (currentTorrent.set(null), filePriorities = {})}
                  class="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg text-sm">Close</button>
          <button onclick={savePriorities}
                  disabled={Object.keys(filePriorities).length === 0}
                  class="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">Save Priorities</button>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-gray-50/50 dark:bg-gray-700/50">
              <th class="p-3 text-left font-medium">Name</th>
              <th class="p-3 text-right font-medium">Size</th>
              <th class="p-3 text-right font-medium">% Done</th>
              <th class="p-3 text-center font-medium">Priority</th>
            </tr>
          </thead>
          <tbody>
            {#each $currentTorrent.files ?? [] as file, i (i)}
              {#if $currentTorrent.fileStats?.[i]}
                {@const stat = $currentTorrent.fileStats[i]}
                <tr class="border-t border-gray-100/50 dark:border-gray-700/50 hover:bg-gray-50/50 dark:hover:bg-gray-700/50">
                  <td class="p-3 font-medium max-w-md truncate" title={file.name}>{file.name}</td>
                  <td class="p-3 text-right">{formatBytes(file.length)}</td>
                  <td class="p-3 text-right">
                    <div class="w-24 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div class="bg-green-500 h-2 rounded-full" style="width: {(stat.bytesCompleted / file.length) * 100}%"></div>
                    </div>
                    <span class="ml-2 text-xs">{((stat.bytesCompleted / file.length) * 100).toFixed(1)}%</span>
                  </td>
                  <td class="p-3 text-center">
                    <select
                      value={filePriorities[i] ?? stat.priority}
                      class="p-1 border rounded text-xs bg-white dark:bg-gray-700 dark:text-white"
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
// src/lib/stores.ts
// Reactive state using Svelte 5 runes + stores (mirrors original Flood's state management)

import { writable } from 'svelte/store';
import { callRpc, ensureSessionId } from './rpc';
import type { Torrent } from './types';

// Shared layout min-width: set by page.svelte (sidebar + table), read by layout.svelte
export const layoutMinWidth = writable('100%');

// Add after existing stores
export const selectedTorrents = writable<number[]>([]);
export const currentTorrent = writable<Torrent | null>(null);

export const torrents = writable<Torrent[]>([]);
export const session = writable<Record<string, unknown>>({});
export const isLoading = writable(false);
export const error = writable<string | null>(null);

// Common fields we want for the torrent list (expand later)
const torrentFields = [
  'id', 'name', 'status', 'percentDone', 'totalSize', 'sizeWhenDone',
  'rateDownload', 'rateUpload', 'eta', 'downloadDir', 'files', 'fileStats',
  'uploadedEver', 'downloadedEver', 'error', 'errorString',
  // Additional optional fields
  'isPrivate', 'addedDate', 'doneDate', 'queuePosition', 'seedRatio',
  'peersSendingToUs', 'peersGettingFromUs', 'trackers'
] as const;

export async function refreshAll() {
  isLoading.set(true);
  error.set(null);

  await ensureSessionId();  // Ensure session before parallel calls

  try {
    const [torrentRes, sessionRes] = await Promise.all([
      callRpc<{ torrents?: Torrent[] }>('torrent-get', { 
        fields: torrentFields 
      }),
      callRpc('session-get')
    ]);

    torrents.set(torrentRes.torrents ?? []);
    session.set(sessionRes as Record<string, unknown>);
  } catch (err: unknown) {
    console.error('Refresh failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to connect to Transmission';
    error.set(message);
  } finally {
    isLoading.set(false);
  }
}

// Example helper for adding a torrent (magnet or URL) - we'll expand this soon
export async function addTorrent(
    filename: string,
    options: { paused?: boolean; downloadDir?: string } = {}) {
  return callRpc('torrent-add', {
    filename,
    paused: options.paused ?? false,
    'download-dir': options.downloadDir
  });
}

// Torrent actions (matches Flood: start/stop/pause/remove)
export async function startTorrents(ids: number[]) {
  return callRpc('torrent-start', { ids });
}

export async function stopTorrents(ids: number[]) {
  return callRpc('torrent-stop', { ids });
}

export async function removeTorrents(ids: number[], deleteData = false) {
  return callRpc('torrent-remove', { ids, 'delete-local-data': deleteData });
}

// Bulk/single action + auto-refresh
export async function performActionAndRefresh(ids: number[], action: 'start' | 'stop' | 'remove') {
  try {
    switch (action) {
      case 'start': await startTorrents(ids); break;
      case 'stop': await stopTorrents(ids); break;
      case 'remove': await removeTorrents(ids); break;
    }
    await refreshAll();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Action failed';
    console.error('Action failed:', err);
    error.set(message);
  }
}

// Phase 2: Refresh single torrent details (files/priorities)
export async function refreshTorrent(id: number) {
  isLoading.set(true);
  try {
    const res = await callRpc<{ torrents: Torrent[] }>('torrent-get', {
      ids: [id],
      fields: [...torrentFields, 'files', 'fileStats'] as const
    });
    if (res.torrents?.[0]) {
      currentTorrent.set(res.torrents[0]);
    }
  } catch (err: unknown) {
    error.set(err instanceof Error ? err.message : 'Torrent details failed');
  } finally {
    isLoading.set(false);
  }
}

// Phase 2: Set file priorities
export async function setFilePriorities(id: number, fileIds: number[], priority: number) {
  return callRpc('torrent-set', {
    ids: [id],
    'priority-high': priority === 1 ? fileIds : [],
    'priority-low': priority === -1 ? fileIds : [],
    'priority-normal': priority === 0 ? fileIds : [],
    'files-wanted': priority >= 0 ? fileIds : [],  // Skip = -2, no want
    'files-unwanted': priority === -2 ? fileIds : []
  });
}

export async function updateFilePriorities(torrentId: number, priorities: Record<number, number>) {
  const args: Record<string, number[]> = { ids: [torrentId] };
  const high: number[] = [];
  const low: number[] = [];
  const normal: number[] = [];
  const unwanted: number[] = [];

  for (const [idxStr, prio] of Object.entries(priorities)) {
    const idx = Number(idxStr);
    switch (prio) {
      case 1: high.push(idx); break;
      case -1: low.push(idx); break;
      case 0: normal.push(idx); break;
      case -2: unwanted.push(idx); break;
    }
  }

  args['priority-high'] = high;
  args['priority-low'] = low;
  args['priority-normal'] = normal;
  args['files-wanted'] = [...high, ...low, ...normal];
  args['files-unwanted'] = unwanted;

  return callRpc('torrent-set', args);
}

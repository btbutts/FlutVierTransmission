// src/lib/stores.ts
// Reactive state using Svelte 5 runes + stores (mirrors original Flood's state management)

import { writable } from 'svelte/store';

import { callRpc, ensureSessionId } from './rpc';
import type { Torrent, TrackerStat } from './types';

// Shared layout min-width: set by page.svelte (sidebar + table), read by layout.svelte
export const layoutMinWidth = writable('100%');

// Add after existing stores
export const selectedTorrents = writable<number[]>([]);
export const currentTorrent = writable<Torrent | null>(null);

export const torrents = writable<Torrent[]>([]);
export const session = writable<Record<string, unknown>>({});
export const isLoading = writable(false);
export const error = writable<string | null>(null);

// prettier-ignore
// Common fields we want for the torrent list (expand later)
const torrentFields = [
  'id', 'name', 'status', 'percentDone', 'totalSize', 'sizeWhenDone',
  'rateDownload', 'rateUpload', 'eta', 'downloadDir', 'files', 'fileStats',
  'uploadedEver', 'downloadedEver', 'error', 'errorString',
  // Additional optional fields
  'isPrivate', 'addedDate', 'doneDate', 'queuePosition', 'uploadRatio',
  'peersSendingToUs', 'peersGettingFromUs', 'trackers', 'trackerStats'
] as const;

export async function refreshAll() {
  isLoading.set(true);
  error.set(null);

  await ensureSessionId(); // Ensure session before parallel calls

  try {
    const [torrentRes, sessionRes] = await Promise.all([
      callRpc<{ torrents?: Torrent[] }>('torrent-get', {
        fields: torrentFields
      }),
      callRpc('session-get')
    ]);

    torrents.set(torrentRes.torrents ?? []);
    session.set(sessionRes as Record<string, unknown>);
    await refreshSession(); // Ensure full session fields
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
  options: { paused?: boolean; downloadDir?: string } = {}
) {
  return callRpc('torrent-add', {
    filename,
    paused: options.paused ?? false,
    'download-dir': options.downloadDir
  });
}

// Add a torrent from a local .torrent file via base64-encoded metainfo
export async function addTorrentMetainfo(
  metainfo: string,
  options: { paused?: boolean; downloadDir?: string } = {}
) {
  return callRpc('torrent-add', {
    metainfo,
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

// prettier-ignore
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
    'files-wanted': priority >= 0 ? fileIds : [], // wanted for high/low/normal, unwanted for -2
    'files-unwanted': priority === -2 ? fileIds : []
  });
}

export async function updateFilePriorities(torrentId: number, priorities: Record<number, number>) {
  const args: Record<string, number[]> = { ids: [torrentId] };
  const high: number[] = [];
  const low: number[] = [];
  const normal: number[] = [];
  const unwanted: number[] = [];

  // prettier-ignore
  for (const [idxStr, prio] of Object.entries(priorities)) {
    const idx = Number(idxStr);
    switch (prio) {
      case 1: high.push(idx); break;
      case -1: low.push(idx); break;
      case 0: normal.push(idx); break;
      case -2: unwanted.push(idx); break;
    }
  }

  if (high.length > 0) args['priority-high'] = high;
  if (low.length > 0) args['priority-low'] = low;
  if (normal.length > 0) args['priority-normal'] = normal;

  const wanted = [...high, ...low, ...normal];
  if (wanted.length > 0) args['files-wanted'] = wanted;
  if (unwanted.length > 0) args['files-unwanted'] = unwanted;

  return callRpc('torrent-set', args);
}

// Phase 3: Dedicated session refresh/update (for Settings modal)
export async function refreshSession() {
  try {
    const res = await callRpc('session-get');
    session.set(res as Record<string, unknown>);
  } catch (err: unknown) {
    error.set(err instanceof Error ? err.message : 'Session refresh failed');
  }
}

export async function updateSession(updates: Record<string, unknown>) {
  try {
    await callRpc('session-set', updates);
    await refreshSession(); // Auto-refresh after apply
  } catch (err: unknown) {
    error.set(err instanceof Error ? err.message : 'Settings save failed');
  }
}

export async function updateBlocklist(): Promise<number> {
  const res = await callRpc<{ 'blocklist-size': number }>('blocklist-update');
  await refreshSession();
  return res['blocklist-size'];
}

// ─── File-Select Workflow Helpers ─────────────────────────────────────────────

interface TorrentAddRpcEntry {
  id: number;
  name: string;
  hashString: string;
}
interface TorrentAddRpcResponse {
  'torrent-added'?: TorrentAddRpcEntry;
  'torrent-duplicate'?: TorrentAddRpcEntry;
}

/**
 * Add a magnet link or .torrent URL for the file-select workflow.
 * The torrent is started immediately (paused: false) so peers can serve
 * the metadata — required before a file list is available.
 * Returns the server-assigned ID, display name, and duplicate flag.
 */
export async function addTorrentForSelect(
  filename: string
): Promise<{ id: number; name: string; isDuplicate: boolean }> {
  const res = await callRpc<TorrentAddRpcResponse>('torrent-add', {
    filename,
    paused: false
  });
  const entry = res['torrent-added'] ?? res['torrent-duplicate'];
  if (!entry) throw new Error('torrent-add returned no torrent entry');
  return { id: entry.id, name: entry.name, isDuplicate: !!res['torrent-duplicate'] };
}

/**
 * Add a local .torrent file (base64-encoded metainfo) for the file-select workflow.
 * The torrent is always added paused because full metadata is already local.
 * Returns the server-assigned ID, display name, and duplicate flag.
 */
export async function addTorrentMetainfoForSelect(
  metainfo: string
): Promise<{ id: number; name: string; isDuplicate: boolean }> {
  const res = await callRpc<TorrentAddRpcResponse>('torrent-add', {
    metainfo,
    paused: true
  });
  const entry = res['torrent-added'] ?? res['torrent-duplicate'];
  if (!entry) throw new Error('torrent-add returned no torrent entry');
  return { id: entry.id, name: entry.name, isDuplicate: !!res['torrent-duplicate'] };
}

/**
 * Fetch the live peer list for a single torrent on demand (e.g., on tooltip hover).
 * Returns both seeders (isDownloadingFrom === true) and leechers (isUploadingTo === true)
 * so callers can use whichever subset they need.
 */
export async function fetchTorrentPeers(id: number): Promise<import('./types').Peer[]> {
  const res = await callRpc<{ torrents: Array<{ peers?: import('./types').Peer[] }> }>(
    'torrent-get',
    { ids: [id], fields: ['peers'] }
  );
  return res.torrents?.[0]?.peers ?? [];
}

/**
 * Fetch the name, file list, and metadata-completion percentage for a single torrent.
 * Used to poll magnet metadata download progress and to read .torrent file lists.
 */
export async function getTorrentFilesList(id: number): Promise<{
  id: number;
  name: string;
  metadataPercentComplete: number;
  files?: Array<{ name: string; length: number }>;
} | null> {
  const res = await callRpc<{
    torrents: Array<{
      id: number;
      name: string;
      metadataPercentComplete: number;
      files?: Array<{ name: string; length: number }>;
    }>;
  }>('torrent-get', {
    ids: [id],
    fields: ['id', 'name', 'metadataPercentComplete', 'files']
  });
  return res.torrents?.[0] ?? null;
}

// ─── Peers Tooltip Portal Store ───────────────────────────────────────────────

export interface PeersTooltipState {
  torrentId: number;
  /** Number of peers actively connected for this direction (seeding to us / we're uploading to) */
  activePeerCount: number;
  /** Max peers reported by tracker (seederCount for Seeds column, leecherCount for Leechers column) */
  maxPeerCount: number;
  trackerStats: TrackerStat[];
  /** Determines which peer direction the tooltip displays */
  mode: 'seeders' | 'leechers';
  x: number;
  y: number;
  above: boolean;
}

// null = tooltip hidden; non-null = visible with those coordinates + data
export const peersTooltipStore = writable<PeersTooltipState | null>(null);

let _peersHideTimer: ReturnType<typeof setTimeout> | null = null;

export function showPeersTooltip(data: PeersTooltipState) {
  if (_peersHideTimer) {
    clearTimeout(_peersHideTimer);
    _peersHideTimer = null;
  }
  peersTooltipStore.set(data);
}

export function hidePeersTooltip() {
  _peersHideTimer = setTimeout(() => {
    peersTooltipStore.set(null);
    _peersHideTimer = null;
  }, 150);
}

export function cancelHidePeersTooltip() {
  if (_peersHideTimer) {
    clearTimeout(_peersHideTimer);
    _peersHideTimer = null;
  }
}

// ─── Bandwidth History ────────────────────────────────────────────────────────

export interface BandwidthPoint {
  download: number; // bytes/sec
  upload: number;   // bytes/sec
  timestamp: number; // Date.now()
}

const MAX_BW_HISTORY = 43200; // 12 h at 1 sample/sec
export const bandwidthHistory = writable<BandwidthPoint[]>([]);
export const bandwidthLastPollTime = writable<number>(Date.now());

export async function pollBandwidth(): Promise<void> {
  try {
    const res = await callRpc<{ downloadSpeed: number; uploadSpeed: number }>('session-stats');
    const point: BandwidthPoint = {
      download: res.downloadSpeed ?? 0,
      upload: res.uploadSpeed ?? 0,
      timestamp: Date.now()
    };
    bandwidthHistory.update((h) => {
      const next = [...h, point];
      return next.length > MAX_BW_HISTORY ? next.slice(next.length - MAX_BW_HISTORY) : next;
    });
    bandwidthLastPollTime.set(Date.now());
  } catch {
    // Silently skip — graph will not update this tick
  }
}

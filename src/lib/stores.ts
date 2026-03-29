// src/lib/stores.ts
// Reactive state using Svelte 5 runes + stores (mirrors original Flood's state management)

import { writable } from 'svelte/store';
import { callRpc, ensureSessionId } from './rpc';
import type { Torrent } from './types';

export const torrents = writable<Torrent[]>([]);
export const session = writable<Record<string, unknown>>({});
export const isLoading = writable(false);
export const error = writable<string | null>(null);

// Common fields we want for the torrent list (expand later)
const torrentFields = [
  'id', 'name', 'status', 'percentDone', 'totalSize', 'sizeWhenDone',
  'rateDownload', 'rateUpload', 'eta', 'downloadDir', 'files', 'fileStats',
  'uploadedEver', 'downloadedEver', 'error', 'errorString'
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
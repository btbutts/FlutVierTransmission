// src/lib/PollAgent/db.ts
// In-memory cache ("mini database") for Transmission torrent and session data.
// Acts as a module-level singleton that the polling engine writes to and
// on-demand fetch functions read from — keeping RPC call counts low.

import type { Torrent, TorrentInfoFull, TorrentQuickStats, TorrentSessionUpdate } from '../types';

// ─── Field Sets ───────────────────────────────────────────────────────────────
// Defined here so both the poller and on-demand refresh functions share the
// exact same request shapes without duplicating or importing from each other.

/** Fields requested on every 1-second light poll (bandwidth + status only). */
// prettier-ignore
export const QUICK_STATS_FIELDS = [
  'id', 'rateDownload', 'rateUpload', 'status'
] as const;

/** All fields requested on the 20-second full poll (everything the UI needs). */
// prettier-ignore
export const FULL_INFO_FIELDS = [
  'id', 'name', 'status', 'percentDone', 'totalSize', 'sizeWhenDone',
  'rateDownload', 'rateUpload', 'eta', 'downloadDir', 'files', 'fileStats',
  'uploadedEver', 'downloadedEver', 'error', 'errorString',
  'isPrivate', 'addedDate', 'doneDate', 'queuePosition', 'uploadRatio',
  'peersSendingToUs', 'peersGettingFromUs', 'trackers', 'trackerStats'
] as const;

// ─── TransmissionDB ───────────────────────────────────────────────────────────

class TransmissionDB {
  private torrentMap = new Map<number, TorrentInfoFull>();
  private sessionData: Record<string, unknown> | null = null;

  /**
   * Called from the 1-second light poll.
   * Merges only the quick-stat fields into existing full records.
   * Torrents not yet in the map are silently skipped — the next full poll
   * will add them.
   */
  updateTorrentQuickStats(updates: TorrentQuickStats[]): void {
    const now = Date.now();
    for (const qStat of updates) {
      const existing = this.torrentMap.get(qStat.id);
      if (existing) {
        this.torrentMap.set(qStat.id, {
          ...existing,
          rateDownload: qStat.rateDownload,
          rateUpload: qStat.rateUpload,
          status: qStat.status,
          timestamp: now
        });
      }
    }
  }

  /**
   * Called from the 20-second full poll and any on-demand manual refresh.
   * Fully replaces each torrent entry; also merges the optional session update.
   */
  updateTorrentInfoFull(updates: Torrent[], sessionUpdate?: TorrentSessionUpdate): void {
    const now = Date.now();
    for (const torrent of updates) {
      this.torrentMap.set(torrent.id, { ...torrent, timestamp: now });
    }
    if (sessionUpdate) {
      this.sessionData = { ...this.sessionData, ...sessionUpdate, timestamp: now };
    }
  }

  getAll(): { torrents: TorrentInfoFull[]; session: Record<string, unknown> | null } {
    return {
      torrents: Array.from(this.torrentMap.values()),
      session: this.sessionData
    };
  }

  getById(id: number): TorrentInfoFull | undefined {
    return this.torrentMap.get(id);
  }

  /**
   * Returns true when the torrent is absent from the cache or its last update
   * is older than maxAgeMs (default 30 seconds).
   */
  isStale(id: number, maxAgeMs = 30000): boolean {
    const torrent = this.torrentMap.get(id);
    return !torrent || Date.now() - torrent.timestamp > maxAgeMs;
  }

  clear(): void {
    this.torrentMap.clear();
    this.sessionData = null;
  }
}

/** Module-level singleton — the single source of truth for all Transmission data. */
export const transmissionDataStore = new TransmissionDB();

// src/lib/PollAgent/poller.ts
// Single polling engine that drives all automatic Transmission RPC requests.
// Replaces the separate pollBandwidth / refreshAll setIntervals that were
// previously managed in +layout.svelte.
//
// Poll cadence:
//   Every tick (1 s):  light poll  — rateDownload / rateUpload / status
//   Tick 1 + every 20th tick (20 s): full poll — all torrent fields + session-get
//
// The full poll fires on tick 1 so the UI is populated immediately on startup
// rather than waiting 20 seconds for the first full refresh.

import { transmissionCallRPC } from '../rpc';
import { bandwidthHistory, bandwidthLastPollTime, liveBandwidthRates, session, tableDisplayTorrents, torrents } from '../stores';
import type { Torrent, TorrentQuickStats, TorrentSessionUpdate } from '../types';
import { FULL_INFO_FIELDS, QUICK_STATS_FIELDS, transmissionDataStore } from './db';

let intervalId: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;

export function startPolling(): void {
  if (intervalId) return;

  tickCount = 0;

  intervalId = setInterval(async () => {
    tickCount++;
    const isFullPollTick = tickCount === 1 || tickCount % 20 === 0;
    // Table display refreshes every 15 s so that sorting by UL/DL doesn't
    // reorder rows every second. Also fires on tick 1 to populate on startup.
    const isTableDisplayTick = tickCount === 1 || tickCount % 15 === 0;

    try {
      if (isFullPollTick) {
        // Full poll: all torrent fields + session in parallel.
        // rateDownload / rateUpload are included in FULL_INFO_FIELDS so we
        // can compute the bandwidth point from this response instead of
        // making a separate light-poll request.
        const [fullInfoResponse, sessionInfoResponse] = await Promise.all([
          transmissionCallRPC<{ torrents: Torrent[] }>('torrent-get', {
            fields: [...FULL_INFO_FIELDS]
          }),
          transmissionCallRPC<TorrentSessionUpdate>('session-get')
        ]);

        const fullTorrents: Torrent[] = fullInfoResponse.torrents ?? [];

        // Compute aggregate bandwidth from the full response.
        const now = Date.now();
        const dlFull = fullTorrents.reduce((sum, t) => sum + (t.rateDownload ?? 0), 0);
        const ulFull = fullTorrents.reduce((sum, t) => sum + (t.rateUpload ?? 0), 0);
        bandwidthHistory.update((history) => {
          const point = { download: dlFull, upload: ulFull, timestamp: now };
          const next = [...history, point];
          return next.length > 43200 ? next.slice(-43200) : next;
        });
        liveBandwidthRates.set({ download: dlFull, upload: ulFull });
        bandwidthLastPollTime.set(now);

        // Update DB and Svelte stores.
        transmissionDataStore.updateTorrentInfoFull(fullTorrents, sessionInfoResponse);
        const fullList = transmissionDataStore.getAll().torrents;
        torrents.set(fullList);
        if (isTableDisplayTick) tableDisplayTorrents.set(fullList);
        if (sessionInfoResponse) {
          session.set(sessionInfoResponse as Record<string, unknown>);
        }
      } else {
        // Light poll: bandwidth + status only.
        const quickStatsResponse = await transmissionCallRPC<{ torrents: TorrentQuickStats[] }>(
          'torrent-get',
          { fields: [...QUICK_STATS_FIELDS] }
        );
        const quickStatsTorrents: TorrentQuickStats[] = quickStatsResponse.torrents ?? [];

        // Compute aggregate bandwidth from the light response.
        const now = Date.now();
        const dlQuick = quickStatsTorrents.reduce((sum, t) => sum + (t.rateDownload ?? 0), 0);
        const ulQuick = quickStatsTorrents.reduce((sum, t) => sum + (t.rateUpload ?? 0), 0);
        bandwidthHistory.update((history) => {
          const point = { download: dlQuick, upload: ulQuick, timestamp: now };
          const next = [...history, point];
          return next.length > 43200 ? next.slice(-43200) : next;
        });
        liveBandwidthRates.set({ download: dlQuick, upload: ulQuick });
        bandwidthLastPollTime.set(now);

        // Merge into DB and push updated list to Svelte store.
        transmissionDataStore.updateTorrentQuickStats(quickStatsTorrents);
        const lightList = transmissionDataStore.getAll().torrents;
        torrents.set(lightList);
        if (isTableDisplayTick) tableDisplayTorrents.set(lightList);
      }
    } catch (err) {
      console.error('Transmission poll failed:', err);
    }
  }, 1000);
}

export function stopPolling(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    tickCount = 0;
  }
}

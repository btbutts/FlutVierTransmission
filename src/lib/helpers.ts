// This file is for general helper functions that don't fit into a specific category like stores or components.
// It can be imported by any other module in the project without creating circular dependencies.
// src/lib/helpers.ts

import type { Torrent } from './types';

// Example helper function to create a pop-up element that is appended to the document body
export function windowPopUp(node: HTMLElement) {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    }
  };
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return bytesPerSec > 0 ? formatBytes(bytesPerSec) + '/s' : '—';
}

/**
 * Returns a deduped, sorted list of download directories from all fully
 * completed torrents (percentDone === 1) that have a valid downloadDir.
 * This can be used to populate the "Common Paths" list in the settings modal
 * for easier selection when adding new torrents.
 */
export function getCompletedTorrentPaths(torrentList: Torrent[]): string[] {
  return Array.from(
    new Set(
      torrentList
        .filter((t) => t.percentDone >= 1 && t.downloadDir)
        // Strip trailing slashes before dedup so "/path/foo" and "/path/foo/" collapse to one entry.
        // Covers both POSIX (/) and Windows (\) path separators.
        .map((t) => t.downloadDir.replace(/[/\\]+$/, ''))
    )
  ).sort();
}

// This file is for general helper functions that don't fit into a specific category like stores or components.
// It can be imported by any other module in the project without creating circular dependencies.
// src/lib/helpers.ts

import type { GeoInfo, Torrent } from './types';

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

export const CACHE_KEY = 'ip_geo_cache';
export const CACHE_TTL = 48 * 60 * 60 * 1000; // 48 hours ms

export function getCachedGeoLookup(ip: string): GeoInfo | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache: Record<string, GeoInfo> = JSON.parse(raw);
    const entry = cache[ip];
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > CACHE_TTL) return null;
    return entry;
  } catch {
    return null;
  }
}

export function setCachedGeoLookup(ip: string, info: GeoInfo) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const cache: Record<string, GeoInfo> = raw ? JSON.parse(raw) : {};
    cache[ip] = { ...info, cachedAt: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage may be unavailable
  }
}

/**
 * Formats a positive ETA (in seconds) into a human-readable string with at
 * most two time units. Negative values (unknown ETA) should be handled by
 * the caller; this function treats them as 0.
 *
 * Tiers:
 *   ≤ 60s              → "X sec"
 *   61–3 600s          → "X min [Y sec]"   (sec omitted when 0)
 *   3 601–86 400s      → "X hr[s] [Y min]" (min omitted when 0)
 *   86 401–2 592 000s  → "X day[s] [Y hr[s]]"
 *   2 592 001–31 536 000s → "X mo[s] [Y day[s]]" (30-day months)
 *   > 31 536 000s      → "X yr[s] [Y mo[s]]"
 */
export function formatEta(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));

  if (s <= 60) {
    return `${s} sec`;
  }

  if (s <= 3600) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return sec === 0 ? `${m} min` : `${m} min ${sec} sec`;
  }

  if (s <= 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const hLabel = h === 1 ? 'hr' : 'hrs';
    return m === 0 ? `${h} ${hLabel}` : `${h} ${hLabel} ${m} min`;
  }

  if (s <= 2592000) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const dLabel = d === 1 ? 'day' : 'days';
    const hLabel = h === 1 ? 'hr' : 'hrs';
    return h === 0 ? `${d} ${dLabel}` : `${d} ${dLabel} ${h} ${hLabel}`;
  }

  if (s <= 31536000) {
    const totalDays = Math.floor(s / 86400);
    const mo = Math.floor(totalDays / 30);
    const d = totalDays % 30;
    const moLabel = mo === 1 ? 'mo' : 'mos';
    const dLabel = d === 1 ? 'day' : 'days';
    return d === 0 ? `${mo} ${moLabel}` : `${mo} ${moLabel} ${d} ${dLabel}`;
  }

  const totalDays = Math.floor(s / 86400);
  const y = Math.floor(totalDays / 365);
  const remainDays = totalDays % 365;
  const mo = Math.floor(remainDays / 30);
  const yLabel = y === 1 ? 'yr' : 'yrs';
  const moLabel = mo === 1 ? 'mo' : 'mos';
  return mo === 0 ? `${y} ${yLabel}` : `${y} ${yLabel} ${mo} ${moLabel}`;
}

// Uses ip-api.com for free IP geolocation — no API key required,
// but rate-limited to 45 req/min per IP. Caching is essential
// to avoid hitting limits and ensure responsive tooltips.
export async function ipGeoLookup(ip: string): Promise<GeoInfo | null> {
  const cached = getCachedGeoLookup(ip);
  if (cached) return cached;
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== 'success') return null;
    const info: GeoInfo = {
      countryCode: json.countryCode ?? '',
      country: json.country ?? '',
      city: json.city ?? '',
      regionName: json.regionName ?? '',
      cachedAt: Date.now()
    };
    setCachedGeoLookup(ip, info);
    return info;
  } catch {
    return null;
  }
}

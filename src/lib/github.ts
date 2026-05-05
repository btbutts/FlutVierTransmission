// src/lib/github.ts
// Fetches release metadata from releases.json committed to the main branch.
//
// releases.json is updated manually (or via CI) whenever a new package is
// published to GitHub Releases. Fetching from the raw file rather than the
// GitHub Releases API means the correct asset URLs are always returned
// regardless of whether the most recent *overall* release belongs to the SPA
// or the PollService — the two packages are versioned and released independently.

const RELEASES_MANIFEST_URL =
  'https://raw.githubusercontent.com/btbutts/FlutVierTransmission/main/releases.json';

interface ReleasesManifest {
  pollservice?: {
    version: string;
    tag: string;
    installerUrl: string;
    zipUrl: string;
  };
  spa?: {
    version: string;
    tag: string;
    downloadUrl: string;
  };
}

export interface PollServiceRelease {
  /** Git tag of the release, e.g. "pollservice-v0.2.0" */
  version: string;
  /** Direct download URL for the install.sh script asset */
  installerUrl: string;
  /** Direct download URL for the pollservice-*.zip asset */
  zipUrl: string;
}

/**
 * Fetches the latest PollService release from the releases.json manifest
 * committed to the main branch. Returns null when the manifest is unreachable,
 * unparseable, or when no PollService release has been published yet.
 *
 * Called lazily (on demand from the UI) — never at app startup.
 */
export async function fetchLatestPollServiceRelease(): Promise<PollServiceRelease | null> {
  try {
    const res = await fetch(RELEASES_MANIFEST_URL, {
      // Always bypass the browser cache so the UI reflects the latest published version.
      cache: 'no-cache'
    });
    if (!res.ok) return null;
    const manifest = (await res.json()) as ReleasesManifest;
    const ps = manifest.pollservice;
    // version "0.0.0" and empty URLs are the placeholder state before the first release.
    if (!ps || !ps.installerUrl || !ps.zipUrl || ps.version === '0.0.0') return null;
    return {
      version: ps.version,
      installerUrl: ps.installerUrl,
      zipUrl: ps.zipUrl
    };
  } catch {
    return null;
  }
}

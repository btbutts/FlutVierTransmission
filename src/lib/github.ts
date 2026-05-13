// src/lib/github.ts
// Fetches release metadata from releases/releases.json committed to the master branch.
//
// releases/releases.json is updated by npm run publish:release whenever a new package
// is published to GitHub Releases. Fetching from the raw file rather than the
// GitHub Releases API means the correct asset URLs are always returned
// regardless of whether the most recent overall release belongs to the
// web-frontend or the PollService — the two packages are versioned and
// released independently.

const RELEASES_MANIFEST_URL =
  'https://raw.githubusercontent.com/btbutts/FlutVierTransmission/master/releases/releases.json';

interface ReleasesManifest {
  repo?: string;
  PollService?: {
    latest: string;
    installerUrl: string;
    releases: Array<{
      version: string;
      tag: string;
      filename: string;
      zipUrl: string;
    }>;
  };
  'web-frontend'?: {
    latest: string;
    releases: Array<{
      version: string;
      tag: string;
      filename: string;
      downloadUrl: string;
    }>;
  };
}

export interface PollServiceRelease {
  /** Version string of the active release, e.g. "0.1.0" */
  version: string;
  /** Raw GitHub URL to releases/pollservice/installation/install.sh on master */
  installerUrl: string;
  /** GitHub Release asset download URL for the pollservice zip */
  zipUrl: string;
}

/**
 * Fetches the active PollService release from the releases/releases.json manifest on
 * the master branch. Uses the PollService.latest field to locate the correct
 * entry in the releases array.
 *
 * Returns null when the manifest is unreachable, unparseable, the PollService
 * section is missing, or the active release has an empty zipUrl (i.e. the
 * first release has not been published yet).
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
    const ps = manifest['PollService'];
    if (!ps?.latest || !ps.installerUrl || !ps.releases?.length) return null;

    // Find the release entry that matches the declared latest version.
    const entry = ps.releases.find((r) => r.version === ps.latest);
    // An empty zipUrl means this version exists in the manifest but the
    // GitHub release upload has not been completed yet.
    if (!entry?.zipUrl) return null;

    return {
      version: entry.version,
      installerUrl: ps.installerUrl,
      zipUrl: entry.zipUrl
    };
  } catch {
    return null;
  }
}

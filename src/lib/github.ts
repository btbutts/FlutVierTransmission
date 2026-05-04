// src/lib/github.ts
// Fetches the latest PollService release metadata from the GitHub Releases API.
// Called lazily (on demand from the UI) — never at app startup.

const GITHUB_RELEASES_API =
  'https://api.github.com/repos/btbutts/FlutVierTransmission/releases/latest';

export interface PollServiceRelease {
  /** Git tag of the release, e.g. "v0.2.0" */
  version: string;
  /** Direct download URL for the install.sh script asset */
  installerUrl: string;
  /** Direct download URL for the pollservice-*.zip asset */
  zipUrl: string;
}

/**
 * Fetches the latest PollService release from GitHub and returns asset URLs.
 * Returns null if the request fails, the release has no assets, or the
 * expected assets (install.sh and pollservice-*.zip) are not found.
 */
export async function fetchLatestPollServiceRelease(): Promise<PollServiceRelease | null> {
  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!res.ok) return null;
    const release = (await res.json()) as {
      tag_name: string;
      assets: Array<{ name: string; browser_download_url: string }>;
    };
    const assets = release.assets ?? [];
    const installerAsset = assets.find((a) => a.name === 'install.sh');
    const zipAsset = assets.find((a) => /^pollservice-.+\.zip$/.test(a.name));
    if (!installerAsset || !zipAsset) return null;
    return {
      version: release.tag_name,
      installerUrl: installerAsset.browser_download_url,
      zipUrl: zipAsset.browser_download_url
    };
  } catch {
    return null;
  }
}

#!/usr/bin/env node
// scripts/publish.mjs
//
// Creates versioned GitHub releases, uploads the zip archives produced by
// build:release, appends the new entries (with accurate download URLs) to
// releases.json, and commits + pushes the updated manifest.
//
// Prerequisites:
//   - gh CLI installed and authenticated  (gh auth login)
//   - npm run build:release has been run and zip archives are present in releases/
//
// Usage:
//   npm run publish:release                       publish both packages
//   npm run publish:release -- --only=pollservice publish PollService only
//   npm run publish:release -- --only=web-frontend publish web-frontend only
//
// How download URLs are determined:
//   GitHub Release asset URLs follow the permanent, documented pattern:
//     https://github.com/{owner}/{repo}/releases/download/{tag}/{filename}
//   Since we control the tag and filename, the URL is computed before the
//   release is created and is guaranteed to match once the release exists.

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2);
  let only = null;
  for (const arg of argv) {
    if (arg.startsWith('--only=')) only = arg.slice('--only='.length);
  }
  if (only && only !== 'pollservice' && only !== 'web-frontend') {
    console.error(`Unknown --only value "${only}". Valid options: pollservice | web-frontend`);
    process.exit(1);
  }
  return { only };
}

function readVersion(pkgPath) {
  return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
}

// Use execFileSync for gh and git commands to safely handle paths/strings
// that may contain spaces without shell quoting issues.
function gh(...args) {
  execFileSync('gh', args, { stdio: 'inherit', cwd: REPO_ROOT });
}

function ghCapture(...args) {
  return execFileSync('gh', args, { encoding: 'utf8', cwd: REPO_ROOT }).trim();
}

function git(...args) {
  execFileSync('git', args, { stdio: 'inherit', cwd: REPO_ROOT });
}

function releaseExists(tag, repo) {
  try {
    ghCapture('release', 'view', tag, '--repo', repo);
    return true;
  } catch {
    return false;
  }
}

function versionAlreadyInManifest(releases, version) {
  return releases.some((r) => r.version === version);
}

// ── Preflight ─────────────────────────────────────────────────────────────────

function checkGhAuth() {
  try {
    execFileSync('gh', ['auth', 'status'], { encoding: 'utf8', cwd: REPO_ROOT });
  } catch {
    console.error('[publish] Error: gh CLI is not authenticated.');
    console.error('          Run: gh auth login');
    process.exit(1);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { only } = parseArgs();
const publishWebFrontend = !only || only === 'web-frontend';
const publishPollService = !only || only === 'pollservice';

checkGhAuth();

const releasesJsonPath = resolve(REPO_ROOT, 'releases.json');
const manifest = JSON.parse(readFileSync(releasesJsonPath, 'utf8'));
const repo = manifest.repo;
const published = [];

// ── Publish web-frontend ──────────────────────────────────────────────────────

if (publishWebFrontend) {
  const version = readVersion(resolve(REPO_ROOT, 'package.json'));
  const tag = `web-frontend-v${version}`;
  const filename = `flutvier-web-frontend-v${version}.zip`;
  const zipPath = resolve(REPO_ROOT, 'releases', 'web-frontend', filename);
  const downloadUrl = `https://github.com/${repo}/releases/download/${tag}/${filename}`;

  // Guard: version already in manifest?
  if (versionAlreadyInManifest(manifest['web-frontend'].releases, version)) {
    console.error(`[publish] Error: web-frontend v${version} is already recorded in releases.json.`);
    console.error(`         Bump the version first: npm run bump -- --package=web-frontend --bump=patch`);
    process.exit(1);
  }

  // Guard: zip produced by build:release?
  if (!existsSync(zipPath)) {
    console.error(`[publish] Error: ${filename} not found in releases/web-frontend/.`);
    console.error(`         Run: npm run build:release -- --only=web-frontend`);
    process.exit(1);
  }

  // Create GitHub release (skip if already exists — partial re-run recovery).
  if (releaseExists(tag, repo)) {
    console.log(`[publish] GitHub release ${tag} already exists — skipping creation.`);
  } else {
    console.log(`\n[publish] Creating GitHub release ${tag}...`);
    gh(
      'release', 'create', tag, zipPath,
      '--repo', repo,
      '--title', `FlutVier Web Frontend v${version}`,
      '--notes', `Web frontend build v${version}`
    );
  }

  // Append to manifest in memory.
  manifest['web-frontend'].releases.push({ version, tag, filename, downloadUrl });
  manifest['web-frontend'].latest = version;
  published.push(tag);
  console.log(`[publish] web-frontend v${version} → ${downloadUrl}`);
}

// ── Publish PollService ───────────────────────────────────────────────────────

if (publishPollService) {
  const version = readVersion(resolve(REPO_ROOT, 'PollService', 'package.json'));
  const tag = `PollService-v${version}`;
  const filename = `flutvier-pollservice-v${version}.zip`;
  const zipPath = resolve(REPO_ROOT, 'releases', 'pollservice', filename);
  const zipUrl = `https://github.com/${repo}/releases/download/${tag}/${filename}`;

  // Guard: version already in manifest?
  if (versionAlreadyInManifest(manifest['PollService'].releases, version)) {
    console.error(`[publish] Error: PollService v${version} is already recorded in releases.json.`);
    console.error(`         Bump the version first: npm run bump -- --package=pollservice --bump=patch`);
    process.exit(1);
  }

  // Guard: zip produced by build:release?
  if (!existsSync(zipPath)) {
    console.error(`[publish] Error: ${filename} not found in releases/pollservice/.`);
    console.error(`         Run: npm run build:release -- --only=pollservice`);
    process.exit(1);
  }

  // Create GitHub release (skip if already exists — partial re-run recovery).
  if (releaseExists(tag, repo)) {
    console.log(`[publish] GitHub release ${tag} already exists — skipping creation.`);
  } else {
    console.log(`\n[publish] Creating GitHub release ${tag}...`);
    gh(
      'release', 'create', tag, zipPath,
      '--repo', repo,
      '--title', `FlutVier PollService v${version}`,
      '--notes', `PollService companion v${version}`
    );
  }

  // Append to manifest in memory.
  manifest['PollService'].releases.push({ version, tag, filename, zipUrl });
  manifest['PollService'].latest = version;
  published.push(tag);
  console.log(`[publish] PollService v${version} → ${zipUrl}`);
}

// ── Write updated releases.json and commit ────────────────────────────────────

writeFileSync(releasesJsonPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('\n[publish] Updated releases.json');

git('add', 'releases.json', 'PollService/scripts/install.sh');

const commitMsg = `chore: publish ${published.join(' + ')}`;
git('commit', '-m', commitMsg);
git('push');

console.log(`\n[publish] Done — committed and pushed releases.json.\n`);

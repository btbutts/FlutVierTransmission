#!/usr/bin/env node
// build-scripts/build.mjs
//
// Full build + packaging pipeline. Compiles both packages (or one, via --only),
// regenerates PollService/scripts/install.sh from its template, and produces
// versioned zip archives in releases/ for use by publish:release.
//
// This script does NOT commit anything and does NOT touch releases.json.
// Run npm run publish:release after this to upload and record the releases.
//
// Usage:
//   npm run build:release                       build both packages
//   npm run build:release -- --only=pollservice build PollService only
//   npm run build:release -- --only=web-frontend build web-frontend only
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

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

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', cwd: REPO_ROOT, ...opts });
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { only } = parseArgs();
const buildWebFrontend = !only || only === 'web-frontend';
const buildPollService = !only || only === 'pollservice';

// Step 1 — Always regenerate install.sh from the template.
// This ensures the generated script is always in sync regardless of which
// packages are being built.
console.log('\n[build] Step 1 — Generating PollService/scripts/install.sh from template...');
run('node build-scripts/generate-install.mjs');

// Step 2 — Web frontend
if (buildWebFrontend) {
  const version = readVersion(resolve(REPO_ROOT, 'package.json'));
  const filename = `flutvier-web-frontend-v${version}.zip`;
  const releaseDir = resolve(REPO_ROOT, 'releases', 'web-frontend');
  const zipPath = resolve(releaseDir, filename);
  const distDir = resolve(REPO_ROOT, 'dist', 'web-frontend');

  console.log(`\n[build] Step 2 — Building web-frontend v${version}...`);
  run('npm run build');

  if (!existsSync(distDir)) {
    console.error(
      `[build] Error: expected dist/web-frontend/ after vite build but it was not found.`
    );
    process.exit(1);
  }

  console.log(`\n[build] Packaging web-frontend → releases/web-frontend/${filename}`);
  mkdirSync(releaseDir, { recursive: true });
  run(`zip -r "${zipPath}" .`, { cwd: distDir });

  console.log(`[build]   web-frontend v${version} → releases/web-frontend/${filename}`);
}

// Step 3 — PollService
if (buildPollService) {
  const version = readVersion(resolve(REPO_ROOT, 'PollService', 'package.json'));
  const filename = `flutvier-pollservice-v${version}.zip`;
  const releaseDir = resolve(REPO_ROOT, 'releases', 'pollservice');
  const zipPath = resolve(releaseDir, filename);
  const distDir = resolve(REPO_ROOT, 'dist', 'pollservice');

  console.log(`\n[build] Step 3 — Building PollService v${version}...`);
  run('npm run build:pollservice');

  if (!existsSync(distDir)) {
    console.error(
      `[build] Error: expected dist/pollservice/ after tsc build but it was not found.`
    );
    process.exit(1);
  }

  console.log(`\n[build] Packaging PollService → releases/pollservice/${filename}`);
  mkdirSync(releaseDir, { recursive: true });
  run(`zip -r "${zipPath}" .`, { cwd: distDir });

  console.log(`[build]   PollService v${version} → releases/pollservice/${filename}`);
}

// Summary
console.log('\n[build] Build complete.');
console.log('[build] Next step: npm run publish:release\n');

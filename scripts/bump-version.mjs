#!/usr/bin/env node
// scripts/bump-version.mjs
//
// Bumps the version field in the appropriate package.json file(s).
// This sets the version that will be used the next time build:release and
// publish:release are run. releases.json is NOT modified here — it is only
// updated by publish:release after a successful GitHub release upload.
//
// Usage:
//   npm run bump -- --package=pollservice --bump=minor
//   npm run bump -- --package=web-frontend --bump=patch
//   npm run bump -- --package=pollservice --bump=major
//   npm run bump -- --package=pollservice --set=1.2.0
//   npm run bump -- --package=web-frontend --set=0.3.0
//   npm run bump -- --all --bump=patch
//
// Bump types:
//   major  — x.y.z → (x+1).0.0
//   minor  — x.y.z → x.(y+1).0
//   patch  — x.y.z → x.y.(z+1)

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// ── CLI argument parsing ──────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2);
  const result = { package: null, bump: null, set: null, all: false };
  for (const arg of argv) {
    if (arg === '--all') result.all = true;
    else if (arg.startsWith('--package=')) result.package = arg.slice('--package='.length);
    else if (arg.startsWith('--bump=')) result.bump = arg.slice('--bump='.length);
    else if (arg.startsWith('--set=')) result.set = arg.slice('--set='.length);
  }
  return result;
}

// ── Version helpers ───────────────────────────────────────────────────────────

function validateSemver(ver) {
  if (!/^\d+\.\d+\.\d+$/.test(ver)) {
    throw new Error(`Invalid version "${ver}". Expected format: x.y.z  (e.g. 1.2.0)`);
  }
}

function applyBump(current, bump) {
  validateSemver(current);
  const [major, minor, patch] = current.split('.').map(Number);
  switch (bump) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump type "${bump}". Valid options: major | minor | patch`);
  }
}

// ── Read / write a package.json preserving its original indentation ───────────

function detectIndent(raw) {
  const match = raw.match(/^(\s+)"/m);
  return match ? match[1] : '  ';
}

function updatePackageVersion(pkgPath, label, args) {
  const raw = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);
  const current = pkg.version;
  if (!current) {
    throw new Error(`No "version" field found in ${pkgPath}`);
  }

  let next;
  if (args.set) {
    validateSemver(args.set);
    next = args.set;
  } else if (args.bump) {
    next = applyBump(current, args.bump);
  } else {
    throw new Error('Provide either --bump=<major|minor|patch> or --set=<x.y.z>');
  }

  if (next === current) {
    console.log(`[bump] ${label}: already at ${current} — no change.`);
    return;
  }

  pkg.version = next;
  const indent = detectIndent(raw);
  writeFileSync(pkgPath, JSON.stringify(pkg, null, indent) + '\n');
  console.log(`[bump] ${label}: ${current} → ${next}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = parseArgs();

if (!args.all && !args.package) {
  console.error('Error: specify a target package.');
  console.error('  --package=pollservice    update PollService/package.json');
  console.error('  --package=web-frontend   update root package.json');
  console.error('  --all                    update both');
  process.exit(1);
}

if (!args.bump && !args.set) {
  console.error('Error: specify a version change.');
  console.error('  --bump=major|minor|patch   increment a version segment');
  console.error('  --set=x.y.z               set an exact version');
  process.exit(1);
}

const targets = args.all ? ['pollservice', 'web-frontend'] : [args.package];

for (const target of targets) {
  if (target === 'pollservice') {
    updatePackageVersion(
      resolve(REPO_ROOT, 'PollService', 'package.json'),
      'pollservice',
      args
    );
  } else if (target === 'web-frontend') {
    updatePackageVersion(
      resolve(REPO_ROOT, 'package.json'),
      'web-frontend',
      args
    );
  } else {
    console.error(`Unknown package "${target}". Valid options: pollservice | web-frontend`);
    process.exit(1);
  }
}

# Building FlutVier

This document covers the full development, build, and release workflow for
FlutVier. The project consists of two independently versioned packages:

| Package | Source | Description |
|---|---|---|
| **web-frontend** | `src/` (project root) | SvelteKit SPA compiled to static HTML/CSS/JS |
| **PollService** | `PollService/src/` | TypeScript companion server (port 19091) |

---

## Prerequisites

- **Node.js 22+** (both packages require it)
- **npm** (comes with Node)
- **gh CLI** — required only for `publish:release` ([install](https://cli.github.com/))
  ```bash
  gh auth login    # authenticate once before first publish
  ```
- **zip** — required for `build:release` (pre-installed on macOS and most Linux distros)

---

## Development

### Start the web-frontend dev server

```bash
npm run dev
```

Starts the Vite dev server at `http://localhost:5173`. Vite is configured with
two dev-only proxies:

- **`/api/*`** — forwards to `http://localhost:19091`. This routes API requests
  to a locally running PollService instance. Run `npm run dev:pollservice` in a
  second terminal alongside this command to activate the full local stack.
- **`/transmission`** — forwards to your Transmission RPC host (configured via
  `.env`). Allows the frontend to reach Transmission during development without
  CORS issues.

Create a `.env` file at the project root (see `.env.example`) to configure
your Transmission RPC credentials:

```env
VITE_TRANSMISSION_USERNAME=your-username
VITE_TRANSMISSION_PASSWORD=your-password
```

### Start the PollService dev server

```bash
npm run dev:pollservice
```

Starts the PollService from its TypeScript source files using `tsx --watch`
for hot-reload. Listens on port `19091`. A `PollService/data/` directory is
created automatically on first run to hold the SQLite database and runtime
state.

### Running both together

Open two terminal tabs and run each command in its own tab:

```
Tab 1:  npm run dev
Tab 2:  npm run dev:pollservice
```

The Vite proxy forwards `/api/*` requests from the frontend to the PollService
automatically. No extra configuration is needed.

---

## Building (compile only)

The following commands compile source files into `dist/` but do **not** create
release archives or update `releases.json`. Use these during development to
verify builds succeed without going through the full release pipeline.

```bash
npm run build:all
```

Runs both builds in sequence:

1. `vite build` — compiles the web-frontend SvelteKit SPA to `dist/web-frontend/`
2. `tsc` — compiles PollService TypeScript to `dist/pollservice/`, then
   copies `package.json` and `drizzle/` migrations alongside the output JS

To compile only one package:

```bash
npm run build                  # web-frontend only  →  dist/web-frontend/
npm run build:pollservice      # PollService only   →  dist/pollservice/
```

> `dist/` is gitignored. These are temporary build outputs, not release artifacts.

---

## Version management

Before creating a release, set the version for whichever package(s) have
changed. Versions follow **semver** (`major.minor.patch`).

```bash
npm run bump -- --package=<target> --bump=<type>
npm run bump -- --package=<target> --set=<version>
npm run bump -- --all --bump=<type>
```

**Targets:**
- `pollservice` — updates `PollService/package.json`
- `web-frontend` — updates the root `package.json`

**Bump types:**
- `major` — `1.2.3` → `2.0.0`
- `minor` — `1.2.3` → `1.3.0`
- `patch` — `1.2.3` → `1.2.4`

**Examples:**

```bash
# Increment patch version for PollService (bug fix / minor update)
npm run bump -- --package=pollservice --bump=patch

# Increment minor version for web-frontend (new feature)
npm run bump -- --package=web-frontend --bump=minor

# Bump major version for both packages at the same time
npm run bump -- --all --bump=major

# Set an exact version for PollService (e.g. after a correction)
npm run bump -- --package=pollservice --set=1.0.0
```

> `releases.json` is **not** touched by `bump`. It is only updated after a
> successful `publish:release` run.

---

## Release workflow

A full release requires two commands. Run them in order.

### Step 1 — Build and package

```bash
npm run build:release
```

This command:

1. Regenerates `PollService/scripts/install.sh` from the template, substituting
   `NODE_MAJOR` from `PollService/package.json` and `REPO` from `releases.json`
2. Compiles the web-frontend → `dist/web-frontend/`
3. Zips `dist/web-frontend/` → `releases/web-frontend/flutvier-web-frontend-v{ver}.zip`
4. Compiles PollService → `dist/pollservice/`
5. Zips `dist/pollservice/` → `releases/pollservice/flutvier-pollservice-v{ver}.zip`

Nothing is committed and nothing is uploaded. You can inspect the zip archives
in `releases/` before proceeding to Step 2.

### Step 2 — Publish

```bash
npm run publish:release
```

Requires `gh auth login` to have been completed previously.

This command:

1. Verifies `gh` CLI is authenticated
2. Checks that neither version is already recorded in `releases.json`
   (prevents accidental double-publishing the same version)
3. Creates a GitHub Release for each package with its versioned tag and zip archive
4. Constructs the deterministic GitHub asset download URLs for each archive
5. Appends the new release entries to `releases.json` and updates `latest`
6. Commits `releases.json` and `PollService/scripts/install.sh` to `master`
7. Pushes to `master`

After this runs, `install.sh` and the app's Settings UI will immediately
reflect the newly published versions on the next fetch.

### Force re-publishing an existing version

By default, `publish:release` aborts if the version being published is already
recorded in `releases.json`. Pass `--force` (or `-force`) to bypass this guard:

```bash
npm run publish:release -- --force
```

With `--force`, instead of appending a duplicate entry, the script finds the
existing record for that version and updates its URL fields in-place. The
`latest` pointer is also updated.

This is useful in two situations:

- **Initial publish of a placeholder entry** — `releases.json` ships with
  `v0.1.0` entries pre-populated but with empty `zipUrl`/`downloadUrl` fields.
  The first-ever publish requires `--force` to fill those fields in.
- **Partial run recovery** — the GitHub Release was created successfully but
  the script failed before committing `releases.json`. Re-running with `--force`
  skips re-creating the already-existing GitHub Release and re-writes the
  manifest correctly.

`--force` can be combined with `--only`:

```bash
npm run publish:release -- --force --only=pollservice
npm run publish:release -- --force --only=web-frontend
```

### Selective releases (one package only)

When only one package has changed, use the `--only` flag to build and publish
just that package. The other package is left completely untouched.

```bash
# Release PollService only
npm run build:release -- --only=pollservice
npm run publish:release -- --only=pollservice

# Release web-frontend only
npm run build:release -- --only=web-frontend
npm run publish:release -- --only=web-frontend
```

### Full example: releasing a PollService patch

```bash
# 1. Bump the version
npm run bump -- --package=pollservice --bump=patch

# 2. Build and package
npm run build:release -- --only=pollservice

# 3. Review the output (optional — inspect before uploading)
ls releases/pollservice/

# 4. Publish
npm run publish:release -- --only=pollservice
```

### Full example: releasing both packages together

```bash
# 1. Bump versions
npm run bump -- --all --bump=minor

# 2. Build and package both
npm run build:release

# 3. Publish both
npm run publish:release
```

---

## Rollback

To revert users to a previous release, edit `releases.json` and change the
`latest` field under the affected package to any prior version string that
exists in its `releases` array:

```json
"PollService": {
  "latest": "0.1.0",
  ...
}
```

Then commit and push:

```bash
git add releases.json
git commit -m "chore: revert PollService latest to v0.1.0"
git push
```

`install.sh` and the Settings UI fetch `releases.json` fresh on each use, so
they pick up the rollback immediately on the next run or page open. No rebuild
or republish is needed.

---

## The install.sh template system

`PollService/scripts/install.sh` is a **generated file**. Do not edit it
directly — changes will be overwritten on the next `build:release` run.

Edit the source template instead:

```
PollService/templates/PollService-install-template.sh
```

The template supports two substitution placeholders:

| Placeholder | Source | Resolved example |
|---|---|---|
| `{{NODE_MAJOR}}` | `PollService/package.json` → `devDependencies["@types/node"]` | `22` |
| `{{REPO}}` | `releases.json` → `repo` | `btbutts/FlutVierTransmission` |

Substitution is performed by `scripts/generate-install.mjs`, which runs
automatically as the first step of `build:release`. To regenerate `install.sh`
on its own without triggering a full build (useful when only the template has
changed):

```bash
node scripts/generate-install.mjs
```

---

## releases.json structure

`releases.json` is the release manifest consumed by:

- `PollService/scripts/install.sh` — determines which release archives to
  download and where
- `src/lib/github.ts` / Settings UI — surfaces installer info and version
  details to the user

```json
{
  "repo": "btbutts/FlutVierTransmission",
  "PollService": {
    "latest": "0.1.0",
    "installerUrl": "https://raw.githubusercontent.com/.../install.sh",
    "releases": [
      {
        "version": "0.1.0",
        "tag": "PollService-v0.1.0",
        "filename": "flutvier-pollservice-v0.1.0.zip",
        "zipUrl": "https://github.com/.../releases/download/..."
      }
    ]
  },
  "web-frontend": {
    "latest": "0.1.0",
    "releases": [
      {
        "version": "0.1.0",
        "tag": "web-frontend-v0.1.0",
        "filename": "flutvier-web-frontend-v0.1.0.zip",
        "downloadUrl": "https://github.com/.../releases/download/..."
      }
    ]
  }
}
```

The `releases` arrays are **append-only** and grow over time, providing a full
version history for both packages. The `latest` field is a simple string
pointer into that array — changing it is all that is required to roll back or
roll forward to any published version.

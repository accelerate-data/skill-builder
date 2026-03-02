# Release Pipeline

CI/CD workflows and what gets built on release.

---

## Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci` | Every push / PR (ignores docs) | Frontend type-check + unit tests; Rust tests + clippy |
| `release` | Manual (`workflow_dispatch`) with a version string | Builds desktop app + publishes GitHub Release |

Three additional workflows exist unrelated to the release pipeline: `claude.yml` (Claude-assisted issue/PR responses), `claude-code-review.yml` (automated code review on PRs), `docs.yml` (deploys user guide to GitHub Pages).

---

## Release Workflow (`release.yml`)

Triggered manually with a version string (e.g. `0.3.0`). Two jobs:

### `build` (macOS + Windows, parallel)

1. Stamps version into `tauri.conf.json`, `package.json`, and `Cargo.toml`. Tauri requires `X.Y.Z` — pre-release suffixes are stripped (`0.9.7-rc1` → `0.9.7`).
2. Downloads and bundles a Node.js 22.14.0 binary (SHA-256 verified) so the app runs without Node installed.
3. Builds the Tauri app and packages:
   - **macOS**: `SkillBuilder-v{VERSION}-macos.zip` — `.app` bundle + `run.sh` (strips quarantine before launch)
   - **Windows**: `SkillBuilder-v{VERSION}-windows.zip` — `.exe` + sidecar JS files + bundled Node + agents directory

### `release` (ubuntu, after `build`)

1. Downloads the macOS and Windows ZIPs
2. Generates release notes by calling Claude Haiku via the Anthropic API to summarize commits; falls back to a plain commit list if the API key is unavailable
3. Creates a GitHub Release tagged `v{VERSION}` with release notes and both platform ZIPs attached

---

## Credentials

| Secret | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | Release notes generation (optional — falls back gracefully) |

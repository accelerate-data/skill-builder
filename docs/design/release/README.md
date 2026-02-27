# Release Pipeline

CI/CD workflows, what gets built, and how plugin packages are assembled on release.

---

## Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci` | Every push / PR (ignores docs) | Frontend type-check + unit tests; Rust tests + clippy |
| `plugin` | Push/PR touching `agents/`, `skills/`, `agent-sources/`, `.claude-plugin/`, plugin tests, or validation scripts | Structural plugin validation (`test:plugin:structural` only — no API calls) |
| `release` | Manual (`workflow_dispatch`) with a version string | Builds desktop app + assembles plugin packages + publishes GitHub Release |

Three additional workflows exist unrelated to the release pipeline: `claude.yml` (Claude-assisted issue/PR responses), `claude-code-review.yml` (automated code review on PRs), `docs.yml` (deploys user guide to GitHub Pages).

---

## Release Workflow (`release.yml`)

Triggered manually with a version string (e.g. `0.3.0`). Three jobs:

### `build` (macOS + Windows, parallel)

1. Stamps version into `tauri.conf.json`, `package.json`, and `Cargo.toml`. Tauri requires `X.Y.Z` — pre-release suffixes are stripped (`0.9.7-rc1` → `0.9.7`).
2. Downloads and bundles a Node.js 22.14.0 binary (SHA-256 verified) so the app runs without Node installed.
3. Builds the Tauri app and packages:
   - **macOS**: `SkillBuilder-v{VERSION}-macos.zip` — `.app` bundle + `run.sh` (strips quarantine before launch)
   - **Windows**: `SkillBuilder-v{VERSION}-windows.zip` — `.exe` + sidecar JS files + bundled Node + agents directory

### `package-plugins` (ubuntu, after `build`)

Assembles the four Claude Code plugin packages from source — does not depend on the build artifacts. Steps:

1. Runs `scripts/build-plugin-skill.sh` to ensure skill references under `skills/` are current
2. Assembles each plugin under `plugins/<name>/` — stamps `.claude-plugin/plugin.json` with the release version, copies skill files from source
3. Writes `.claude-plugin/marketplace.json` listing all four plugins

Uploads the result as a GitHub Actions artifact. **Does not push to the marketplace repo** — that is a separate manual step.

### `release` (ubuntu, after `build` and `package-plugins`)

1. Downloads the macOS and Windows ZIPs
2. Generates release notes by calling Claude Haiku via the Anthropic API to summarize commits; falls back to a plain commit list if the API key is unavailable
3. Creates a GitHub Release tagged `v{VERSION}` with release notes and both platform ZIPs attached

---

## Plugin Package Structure

What `package-plugins` assembles:

```text
hbanerjee74/skills/
├── .claude-plugin/
│   └── marketplace.json          ← lists all 4 plugins
└── plugins/
    ├── skill-builder/            ← coordinator + agents
    ├── skill-builder-research/   ← research skill
    ├── skill-builder-validate/   ← validate skill
    └── skill-builder-practices/  ← content guidelines skill
```

Users install from this marketplace:

```bash
claude plugin marketplace add hbanerjee74/skills
claude plugin install skill-builder
```

---

## Credentials

| Secret | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | Release notes generation (optional — falls back gracefully) |

---

## Source of Truth

All plugin content originates from this repo:

| Source | Published as |
|---|---|
| `agent-sources/workspace/CLAUDE.md` | `skill-builder/references/workspace-context.md` |
| `agent-sources/workspace/skills/research/` | `skill-builder-research` plugin |
| `agent-sources/workspace/skills/validate-skill/` | `skill-builder-validate` plugin |
| `agent-sources/workspace/skills/skill-builder-practices/` | `skill-builder-practices` plugin |
| `skills/building-skills/` + `agents/` | `skill-builder` plugin |

`scripts/build-plugin-skill.sh` materialises the three inner skill packages into `skills/`. Run it locally after editing anything in `agent-sources/workspace/skills/`. CI uses `--check` mode to catch stale builds.

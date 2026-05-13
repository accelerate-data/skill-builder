---
functional-specs: [custom-plugin-management]
---

# Per-Skill Git Repositories

> **Status:** Draft
> **Functional specs:** [`custom-plugin-management`](../../functional/custom-plugin-management/README.md)

## Overview

The skills path is currently a single shared git repository (`~/skill-builder/.git/`). Every skill's commits and version tags land in the same history. When the user resets step 3 and re-runs skill generation, `create_skill_version_tag` fails with "tag already exists" because the `1.0.0` tag from the previous run is still in the shared repo. Deleting just that skill's tags is a workaround, but the root cause is shared history: no operation on one skill can be fully isolated from another.

This design moves each skill to its own git repository at `{skills_path}/{plugin_slug}/{skill_name}/.git/`.

## Design Scope

**Covers**

- Repo topology: where `.git/` lives after the change
- Tag format: simplified from `{plugin_slug}/{skill_name}/v{version}` to `v{version}`
- Repo initialization: when and how per-skill repos are created
- Migration: converting an existing shared-repo skills path on startup
- Impact on step reset: tag cleanup and history isolation
- Impact on `restore_version` and `extract_skill_at_tag`
- Impact on startup reconciliation and one-time git upgrade
- Skills path move (Settings)
- Publish (future-facing note)

**Does not cover**

- Implementation task sequencing (see implementation plan)
- GitHub publish implementation (not yet implemented; addressed as a future note)

## Key Decisions

| Decision | Rationale |
|---|---|
| `.git/` at `resolve_skill_dir(skills_path, plugin_slug, skill_name)` | Scopes all history and tags to one skill; reset/retag never touches another skill |
| Tags simplify to `v{version}` (drop `{plugin_slug}/{skill_name}/` prefix) | The repo is already scoped to the skill; the prefix is redundant. `plugin-paths.json` `tag_prefix`/`tag_glob` updated accordingly; tag function signatures simplified |
| Repo initialized at skill creation, not lazily | `ensure_repo(skill_dir)` runs in `create_skill`; every skill has a repo before any git operation touches it |
| Migration is a fresh start (no history extraction) | Extracting per-skill history from a shared repo requires `git filter-repo` (external dep) and handles tag namespaces that are no longer relevant. A fresh initial commit per skill with current files is safe, fast, and reversible |
| One-time migration detects `{skills_path}/.git/` on startup | If the shared root `.git/` exists, the startup path init a per-skill repo for every skill directory found, commits their current files, then removes `{skills_path}/.git/`. Skills with no content (no `SKILL.md`) get a bare initialized repo |
| Commit messages drop the skill-name prefix | E.g., `generated skill` instead of `my-skill: generated skill` — the repo is the skill, so the prefix is redundant. Messages that reference multiple skills (reconcile, settings backfill) keep the skill name for clarity since those code paths loop over skills |
| Skills path move (`fs::rename`) unchanged | Renaming the root directory moves all per-skill `.git/` directories atomically. No per-skill fixup needed |

## Architecture / How It Works

### Repository Topology

**Before (shared repo):**

```text
~/skill-builder/
├── .git/                        ← one repo, all skills
├── skills/
│   ├── my-skill/
│   │   ├── SKILL.md
│   │   └── references/
│   └── other-skill/
│       └── SKILL.md
└── custom-plugin/
    └── domain-skill/
        └── SKILL.md
```

**After (per-skill repos):**

```text
~/skill-builder/                 ← plain directory, no .git/ at root
├── skills/
│   ├── my-skill/
│   │   ├── .git/                ← per-skill repo
│   │   ├── SKILL.md
│   │   └── references/
│   └── other-skill/
│       ├── .git/
│       └── SKILL.md
└── custom-plugin/
    └── domain-skill/
        ├── .git/
        └── SKILL.md
```

### Tag Format

`plugin-paths.json` changes:

```json
"tag_prefix": "v",
"tag_glob":   "v*"
```

`skill_tag_prefix(plugin_slug, skill_name)` → returns `"v"` (parameters unused).
`skill_tag_glob(plugin_slug, skill_name)` → returns `"v*"`.

Version tags: `v1.0.0`, `v1.0.1`, etc. The `delete_skill_version_tags` and `skill_has_any_tag` functions already use glob-based listing so they work with the new format without logic changes — only the path argument changes from `skills_root` to `skill_dir`.

### Initialization

`create_skill` (Rust) calls `ensure_repo(skill_dir)` immediately after creating the skill directory. `ensure_repo` initializes the git repo and makes an initial `.gitignore` commit. Subsequent workflow steps find a valid repo already in place.

Imported skills (`upload.rs`, `github_import/commands.rs`) call `ensure_repo(skill_dir)` before committing and tagging. Currently they call `ensure_repo(skills_root)` — that call site moves to the skill level.

### Step Reset and Tag Cleanup

`clean_step_output(step_id=3)` already calls `delete_skill_version_tags`. The only change is the path argument: from `skills_path` (root) to `resolve_skill_dir(skills_path, plugin_slug, skill_name)`. Step reset now operates entirely within one skill's isolated repo.

### `restore_version` and `extract_skill_at_tag`

Both functions already receive a `plugin_slug` and `skill_name` pair and operate on a subtree of the skills repo. After the migration, their `path` argument changes from `skills_root` to `skill_dir`. No logic changes.

`get_skill_history` similarly moves its `path` from root to `skill_dir` and no longer needs to filter commits by skill path.

### Startup Reconciliation

`reconcile_on_startup` calls `commit_all(output_path, ...)` when it finds untracked skill folders. `output_path` here is `skills_root` — it changes to the per-skill dir resolved from each skill's location.

### One-Time Git Upgrade (Migration)

`workspace.rs` currently handles a one-time upgrade: if `skills_path` has content but no `.git/`, init a repo and snapshot. This logic extends to handle the inverse: if `{skills_path}/.git/` **exists** (legacy shared repo), run the per-skill migration:

1. Enumerate all `{skills_path}/{plugin_slug}/{skill_name}/` directories.
2. For each, call `ensure_repo(skill_dir)` — skips if `.git/` already exists.
3. Stage and commit all current files in the skill directory as `"initial commit"`.
4. Remove `{skills_path}/.git/` with a best-effort `fs::remove_dir_all`.
5. Log the migration; silently continue if any per-skill step fails.

The migration runs once. After it completes, `{skills_path}/.git/` is gone and will not trigger again.

### Skills Path Change (Settings)

No changes needed. `settings.rs` uses `fs::rename` to move the skills root, which atomically relocates all per-skill `.git/` directories with their parent directories. If the old path and new path are on different filesystems, the rename falls back to a copy+delete which also moves `.git/` correctly.

### Publish (Future)

The functional spec describes publishing the entire plugin to a remote GitHub repository. With per-skill repos, the natural unit is the skill repo itself. A future publish implementation can push each skill's repo individually, or assemble a delivery monorepo from skill subtrees. This design does not constrain that choice — it only ensures each skill has a git repo that can serve as a push source.

## States / Transitions

| State | `.git/` location | Tag format | Version operations |
|---|---|---|---|
| **Legacy shared** | `{skills_path}/.git/` | `{plugin}/{skill}/v{ver}` | Shared history; tag collision on reset |
| **Migrated (per-skill)** | `{skill_dir}/.git/` | `v{ver}` | Isolated history; reset deletes skill's own tags only |

Migration is a one-way transition triggered once on startup when the shared root `.git/` is detected.

## Relationship to Existing Design Specs

| Spec | Relationship |
|---|---|
| `docs/design/openhands-runtime-contract/README.md` | **Partial supersedes** — the runtime contract now owns canonical skills-tree and storage-root language; this doc narrows the per-skill git topology decision |
| `docs/design/workflow-artifact-storage/README.md` | **No change** — skills path layout (`SKILL.md`, `references/`) is unchanged |

## Key Source Files

| File | Change |
|---|---|
| `app/plugin-paths.json` | `tag_prefix` → `"v"`, `tag_glob` → `"v*"` |
| `app/src-tauri/src/skill_paths.rs` | `skill_tag_prefix`/`skill_tag_glob` simplify (params become unused or removed) |
| `app/src-tauri/src/git.rs` | Tag functions simplify; all call sites that pass `skills_root` as path move to `skill_dir` |
| `app/src-tauri/src/commands/workspace.rs` | One-time migration logic; `ensure_repo` calls move to skill level |
| `app/src-tauri/src/commands/skill/crud.rs` | `commit_all` path → `skill_dir` |
| `app/src-tauri/src/commands/workflow/output_format.rs` | Already uses `skills_dir` (= skill_dir); minimal change |
| `app/src-tauri/src/commands/workflow/evaluation.rs` | `commit_all` path → `skill_dir` |
| `app/src-tauri/src/commands/refine/output.rs` | `commit_all` + `create_skill_version_tag` path → `skill_dir` |
| `app/src-tauri/src/commands/imported_skills/upload.rs` | `ensure_repo` + `commit_all` + tag → `skill_dir` |
| `app/src-tauri/src/commands/github_import/commands.rs` | `commit_all` + tag → `skill_dir` |
| `app/src-tauri/src/commands/imported_skills/lifecycle.rs` | `commit_all` path → `skill_dir` |
| `app/src-tauri/src/commands/reconciliation.rs` | `commit_all` path → `skill_dir` |
| `app/src-tauri/src/commands/settings.rs` | Backfill + version tag calls → `skill_dir`; `ensure_repo` → skill level |
| `app/src-tauri/src/commands/workspace.rs` (marketplace layout migration) | `commit_all(root, "migrate to marketplace plugin layout")` operates at root level — this one-time migration must run before per-skill repos exist, or be re-expressed as per-skill commits |
| `app/src-tauri/src/commands/git.rs` | `restore_skill_version` path → `skill_dir` |
| `app/src-tauri/src/cleanup.rs` | `delete_skill_version_tags` path → `skill_dir` (already receives `skills_path`; update resolver call) |

## Open Questions

None blocking.

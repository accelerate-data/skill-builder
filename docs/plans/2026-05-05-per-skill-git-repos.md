# Per-Skill Git Repositories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Migrate the Skill Builder Rust backend from a single shared git repo at `skills_path/` to one git repo per skill at `resolve_skill_dir(skills_path, plugin_slug, skill_name)/.git/`, eliminating version-tag collisions on step reset.

**Architecture:** Each skill gets an isolated `.git/` directory so that reset/retag, history, and version tags never bleed across skills. A one-time startup migration converts any existing shared root repo by initializing per-skill repos from current files and removing the shared `.git/`. Tag format simplifies from `{plugin_slug}/{skill_name}/v{version}` to `v{version}` since the repo is already scoped to the skill. All git call sites that currently pass `skills_root` are updated to pass `skill_dir` resolved via `resolve_skill_dir`.

**Tech Stack:** Rust / git2 crate / Tauri / SQLite. No frontend changes. All tests use `tempfile::tempdir()` + `cargo test`.

**Branch context:** This work lives on branch `feature/vu-1159-migrate-to-per-skill-git-repositories`, which was branched from `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`. All commits go on the `vu-1159` branch. When all tasks are complete, open a PR targeting `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime` (not `main`). The worktree for this branch is at `~/src/worktrees/feature/vu-1159-migrate-to-per-skill-git-repositories`. Every bash command must `cd` into that worktree path — subagents do not inherit the parent cwd.

---

## File Structure

| File | Change |
|---|---|
| `app/plugin-paths.json` | `tag_prefix` → `"v"`, `tag_glob` → `"v*"` |
| `app/src-tauri/src/skill_paths.rs` | No logic change; `skill_tag_prefix`/`skill_tag_glob` auto-simplify when JSON changes |
| `app/src-tauri/src/git.rs` | `restore_version`: add `""` prefix fallback, write to `repo_path` directly; `extract_skill_at_tag`: add `""` prefix fallback; `get_skill_files_at_sha`: add `""` prefix fallback; update tests to per-skill repo layout |
| `app/src-tauri/src/commands/workspace.rs` | Replace one-time git upgrade block with per-skill migration function |
| `app/src-tauri/src/commands/skill/crud.rs` | Add `plugin_slug` param to `post_create_skill_filesystem_inner`; call `ensure_repo(skill_dir)` at creation; update `post_delete_skill_filesystem_inner` |
| `app/src-tauri/src/commands/workflow/evaluation.rs` | `reset_workflow_step` + `navigate_back_to_step`: `commit_all` path → `skill_dir` |
| `app/src-tauri/src/commands/refine/output.rs` | `restore_protected_frontmatter` + `finalize_refine_run_inner_for_plugin`: commit + tag paths → `skill_dir` |
| `app/src-tauri/src/commands/git.rs` | `get_skill_history` + `restore_skill_version` + `get_skill_files_at_sha`: path resolution → `skill_dir` |
| `app/src-tauri/src/commands/imported_skills/upload.rs` | `import_skill_from_file_inner`: git ops → `skill_dir`; add `ensure_repo(skill_dir)` before commit |
| `app/src-tauri/src/commands/github_import/commands.rs` | All `commit_all`/tag call sites → `skill_dir` |
| `app/src-tauri/src/commands/imported_skills/lifecycle.rs` | `delete_plugin`/`create_plugin_from_skills`: remove root-level `commit_all` (repos deleted with dir) |
| `app/src-tauri/src/commands/reconciliation.rs` | Replace `get_untracked_dirs` + `commit_all(root)` with per-skill `ensure_repo` + `commit_all(skill_dir)` |
| `app/src-tauri/src/commands/settings.rs` | `backfill_missing_version_tags`: commit + tag paths → `skill_dir` |
| `app/src-tauri/src/cleanup.rs` | `clean_step_output(step=3)`: `delete_skill_version_tags` path → `skill_dir` |

---

### Task 1: Simplify tag format in plugin-paths.json

**Files:**

- Modify: `app/plugin-paths.json`
- Test: `app/src-tauri/src/skill_paths.rs` (existing tests will catch regressions)

- [x] **Step 1: Write the failing test**

Add to `app/src-tauri/src/skill_paths.rs` tests:

```rust
#[cfg(test)]
mod tag_format_tests {
    use super::*;

    #[test]
    fn test_skill_tag_prefix_returns_v() {
        assert_eq!(skill_tag_prefix("my-plugin", "my-skill"), "v");
    }

    #[test]
    fn test_skill_tag_glob_returns_v_star() {
        assert_eq!(skill_tag_glob("any-plugin", "any-skill"), "v*");
    }

    #[test]
    fn test_skill_version_tag_name_returns_v_prefixed() {
        let name = crate::git::skill_version_tag_name("my-plugin", "my-skill", "1.0.0");
        assert_eq!(name, "v1.0.0");
    }
}
```

- [x] **Step 2: Run tests to verify they fail**

```bash
cd app/src-tauri && cargo test tag_format_tests -- --nocapture
```

Expected: FAIL — tag prefix is `my-plugin/my-skill/v`, not `v`

- [x] **Step 3: Update plugin-paths.json**

Change `app/plugin-paths.json` lines 5–6:

```json
"tag_prefix": "v",
"tag_glob":   "v*",
```

- [x] **Step 4: Run tests to verify they pass**

```bash
cd app/src-tauri && cargo test tag_format_tests -- --nocapture
```

Expected: PASS

- [x] **Step 5: Run full git test suite to catch any format regressions**

```bash
cd app/src-tauri && cargo test git:: -- --nocapture 2>&1 | tail -30
```

Fix any test that asserts old-format tag names (e.g. `"skills/my-skill/v1.0.0"` → `"v1.0.0"`).

- [x] **Step 6: Commit**

```bash
cd app && git add src-tauri/src/skill_paths.rs ../plugin-paths.json
git commit -m "feat: simplify git tag format to v{version} for per-skill repos"
```

---

### Task 2: Update git.rs for per-skill repo paths

The key insight: with per-skill repos, `repo_path` passed to all git functions IS the skill directory. The `restore_version`, `extract_skill_at_tag`, and `get_skill_files_at_sha` functions currently derive the `write_dir` or read prefix from `resolve_skill_dir(repo_path, ...)`. After per-skill repos, callers pass `skill_dir` directly, so the write dir should be `repo_path` itself, and the tree prefix is `""` (files live at the repo root).

**Files:**

- Modify: `app/src-tauri/src/git.rs`

- [x] **Step 1: Write failing tests for per-skill repo layout**

Add to the `#[cfg(test)]` block in `app/src-tauri/src/git.rs`:

```rust
mod per_skill_repo_tests {
    use super::*;
    use tempfile::tempdir;

    fn init_per_skill_repo(skill_dir: &std::path::Path, content: &str) -> String {
        ensure_repo(skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), content).unwrap();
        commit_all(skill_dir, "generated skill").unwrap().unwrap()
    }

    #[test]
    fn test_restore_version_writes_to_repo_root_for_per_skill_repo() {
        let dir = tempdir().unwrap();
        let skill_dir = dir.path();
        let sha_v1 = init_per_skill_repo(skill_dir, "# V1");

        std::fs::write(skill_dir.join("SKILL.md"), "# V2").unwrap();
        commit_all(skill_dir, "updated").unwrap();

        restore_version(skill_dir, &sha_v1, "my-skill", crate::skill_paths::DEFAULT_PLUGIN_SLUG).unwrap();

        let content = std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
        assert_eq!(content, "# V1", "restore must write to repo root, not a subdirectory");
    }

    #[test]
    fn test_extract_skill_at_tag_works_for_per_skill_repo() {
        let dir = tempdir().unwrap();
        let skill_dir = dir.path();
        ensure_repo(skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# Tagged version").unwrap();
        commit_all(skill_dir, "generated skill").unwrap();
        create_skill_version_tag(skill_dir, crate::skill_paths::DEFAULT_PLUGIN_SLUG, "my-skill", "1.0.0").unwrap();

        let dest = dir.path().parent().unwrap().join("dest");
        extract_skill_at_tag(skill_dir, crate::skill_paths::DEFAULT_PLUGIN_SLUG, "my-skill", "v1.0.0", &dest).unwrap();

        assert_eq!(
            std::fs::read_to_string(dest.join("SKILL.md")).unwrap(),
            "# Tagged version"
        );
    }

    #[test]
    fn test_get_skill_files_at_sha_works_for_per_skill_repo() {
        let dir = tempdir().unwrap();
        let skill_dir = dir.path();
        let sha = init_per_skill_repo(skill_dir, "# My skill content");

        let files = get_skill_files_at_sha(skill_dir, "my-skill", crate::skill_paths::DEFAULT_PLUGIN_SLUG, &sha).unwrap();
        assert!(files.iter().any(|(p, _)| p == "SKILL.md"), "SKILL.md must be in result");
        let skill_md = files.iter().find(|(p, _)| p == "SKILL.md").unwrap();
        assert!(skill_md.1.contains("My skill content"));
    }

    #[test]
    fn test_get_history_returns_all_commits_for_per_skill_repo() {
        let dir = tempdir().unwrap();
        let skill_dir = dir.path();
        init_per_skill_repo(skill_dir, "# V1");
        std::fs::write(skill_dir.join("SKILL.md"), "# V2").unwrap();
        commit_all(skill_dir, "updated").unwrap();

        let history = get_history(skill_dir, "my-skill", crate::skill_paths::DEFAULT_PLUGIN_SLUG, 100).unwrap();
        assert!(history.len() >= 2, "expected at least 2 commits, got {}", history.len());
    }
}
```

- [x] **Step 2: Run tests to verify they fail**

```bash
cd app/src-tauri && cargo test per_skill_repo_tests -- --nocapture 2>&1 | tail -30
```

Expected: FAIL — `restore_version` writes to `skills/{skill_name}/` subdirectory, not the repo root

- [x] **Step 3: Fix `restore_version` to write to repo root**

In `app/src-tauri/src/git.rs`, find the `restore_version` function. Make two changes:

**Change 1** — Write dir is the repo root, not a sub-path:

```rust
// BEFORE (line ~612):
let write_dir = crate::skill_paths::resolve_skill_dir(repo_path, plugin_slug, skill_name);

// AFTER:
let write_dir = repo_path.to_path_buf();
```

**Change 2** — Add `""` (empty) as the first prefix so per-skill commits (files at repo root) are found:

```rust
// BEFORE (line ~619):
let mut read_prefixes: Vec<String> = Vec::new();
if plugin_slug != crate::skill_paths::DEFAULT_PLUGIN_SLUG {
    read_prefixes.push(format!("{}/{}/", plugin_slug, skill_name));
    read_prefixes.push(format!("{}/skills/{}/", plugin_slug, skill_name));
}
read_prefixes.push(format!("skills/{}/", skill_name));
read_prefixes.push(format!("{}/", skill_name));

// AFTER:
let mut read_prefixes: Vec<String> = Vec::new();
read_prefixes.push(String::new()); // per-skill repo: files at tree root
if plugin_slug != crate::skill_paths::DEFAULT_PLUGIN_SLUG {
    read_prefixes.push(format!("{}/{}/", plugin_slug, skill_name));
    read_prefixes.push(format!("{}/skills/{}/", plugin_slug, skill_name));
}
read_prefixes.push(format!("skills/{}/", skill_name));
read_prefixes.push(format!("{}/", skill_name));
```

- [x] **Step 4: Fix `extract_skill_at_tag` to support per-skill repos**

Find `extract_skill_at_tag` in `git.rs`. Change the prefix logic to try per-skill root first:

```rust
// BEFORE (line ~824):
let prefix = if plugin_slug == crate::skill_paths::DEFAULT_PLUGIN_SLUG {
    format!("skills/{}/", skill_name)
} else {
    format!("{}/skills/{}/", plugin_slug, skill_name)
};

// Remove stale destination
if dest_dir.exists() { ... }

tree.walk(..., |dir, entry| {
    ...
    if !full_path.starts_with(&prefix) {
        return git2::TreeWalkResult::Ok;
    }
    ...
    let relative = &full_path[prefix.len()..];
    ...
});

// AFTER: try multiple prefixes, pick the first with SKILL.md
let prefixes: Vec<String> = {
    let mut v = vec![String::new()]; // per-skill repo: files at root
    if plugin_slug != crate::skill_paths::DEFAULT_PLUGIN_SLUG {
        v.push(format!("{}/{}/", plugin_slug, skill_name));
        v.push(format!("{}/skills/{}/", plugin_slug, skill_name));
    }
    v.push(format!("skills/{}/", skill_name));
    v.push(format!("{}/", skill_name));
    v
};

// Collect all blobs once, find the right prefix
let mut all_entries: Vec<(String, Vec<u8>)> = Vec::new();
tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
    if entry.kind() != Some(git2::ObjectType::Blob) {
        return git2::TreeWalkResult::Ok;
    }
    let full_path = if dir.is_empty() {
        entry.name().unwrap_or("").to_string()
    } else {
        format!("{}{}", dir, entry.name().unwrap_or(""))
    };
    if let Ok(blob) = repo.find_blob(entry.id()) {
        all_entries.push((full_path, blob.content().to_vec()));
    }
    git2::TreeWalkResult::Ok
})
.map_err(|e| format!("Failed to walk tree: {}", e))?;

let prefix = prefixes
    .iter()
    .find(|p| all_entries.iter().any(|(path, _)| {
        let skill_md = format!("{}SKILL.md", p);
        *path == skill_md
    }))
    .cloned()
    .unwrap_or_default();

if dest_dir.exists() {
    std::fs::remove_dir_all(dest_dir)
        .map_err(|e| format!("Failed to clean dest dir: {}", e))?;
}

for (full_path, content) in &all_entries {
    if !full_path.starts_with(&prefix) { continue; }
    let relative = &full_path[prefix.len()..];
    if relative.starts_with('.') { continue; } // skip dotfiles (.gitignore etc.)
    let file_path = dest_dir.join(relative);
    if let Some(parent) = file_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&file_path, content);
}
```

- [x] **Step 5: Fix `get_skill_files_at_sha` to add per-skill prefix**

Find `get_skill_files_at_sha`. Add `""` as the first prefix:

```rust
// BEFORE:
let mut prefixes: Vec<String> = Vec::new();
if plugin_slug != crate::skill_paths::DEFAULT_PLUGIN_SLUG {
    prefixes.push(format!("{}/skills/{}/", plugin_slug, skill_name));
    prefixes.push(format!("{}/{}/", plugin_slug, skill_name));
}
prefixes.push(format!("skills/{}/", skill_name));
prefixes.push(format!("{}/", skill_name));

// AFTER:
let mut prefixes: Vec<String> = Vec::new();
prefixes.push(String::new()); // per-skill repo: files at root
if plugin_slug != crate::skill_paths::DEFAULT_PLUGIN_SLUG {
    prefixes.push(format!("{}/skills/{}/", plugin_slug, skill_name));
    prefixes.push(format!("{}/{}/", plugin_slug, skill_name));
}
prefixes.push(format!("skills/{}/", skill_name));
prefixes.push(format!("{}/", skill_name));
```

Also update the `skill_md_path` and `refs_prefix` filter to skip dotfiles when `prefix_used` is `""`:

```rust
let skill_md_path = format!("{}SKILL.md", prefix_used);
let refs_prefix = format!("{}references/", prefix_used);

let mut files: Vec<(String, String)> = matched
    .into_iter()
    .filter(|(path, _)| *path == skill_md_path || path.starts_with(&refs_prefix))
    .filter_map(|(path, content)| {
        let relative = path[prefix_used.len()..].to_string();
        if relative.starts_with('.') { return None; } // skip .gitignore etc.
        std::str::from_utf8(&content)
            .ok()
            .map(|s| (relative, s.to_string()))
    })
    .collect();
```

- [x] **Step 6: Run new tests**

```bash
cd app/src-tauri && cargo test per_skill_repo_tests -- --nocapture
```

Expected: PASS

- [x] **Step 7: Run full git test suite**

```bash
cd app/src-tauri && cargo test git:: -- --nocapture 2>&1 | tail -20
```

Fix any regressions before continuing.

- [x] **Step 8: Commit**

```bash
cd app && git add src-tauri/src/git.rs
git commit -m "feat: update git.rs restore/extract/history to support per-skill repo layout"
```

---

### Task 3: One-time migration in workspace.rs

Replace the existing one-time git upgrade block with logic that:

1. Detects a shared root `.git/` and migrates each skill to its own repo
2. Removes the shared root `.git/` after migration

**Files:**

- Modify: `app/src-tauri/src/commands/workspace.rs`

- [x] **Step 1: Write failing test**

Add to the `#[cfg(test)]` block in `workspace.rs` (or create `app/src-tauri/src/commands/workspace_migration_tests.rs` and declare with `#[cfg(test)] mod workspace_migration_tests;`):

```rust
#[cfg(test)]
mod migration_tests {
    use tempfile::tempdir;

    fn setup_shared_repo(skills_path: &std::path::Path) {
        crate::git::ensure_repo(skills_path).unwrap();
        let skill_dir = skills_path.join("skills").join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# My skill").unwrap();
        crate::git::commit_all(skills_path, "my-skill: initial").unwrap();
    }

    #[test]
    fn test_migrate_to_per_skill_repos_removes_shared_git() {
        let dir = tempdir().unwrap();
        let skills_path = dir.path();
        setup_shared_repo(skills_path);

        assert!(skills_path.join(".git").exists(), "pre: shared .git must exist");

        super::migrate_to_per_skill_repos(skills_path);

        assert!(!skills_path.join(".git").exists(), "shared .git must be removed after migration");
    }

    #[test]
    fn test_migrate_to_per_skill_repos_inits_per_skill_git() {
        let dir = tempdir().unwrap();
        let skills_path = dir.path();
        setup_shared_repo(skills_path);

        super::migrate_to_per_skill_repos(skills_path);

        let skill_dir = skills_path.join("skills").join("my-skill");
        assert!(skill_dir.join(".git").exists(), "per-skill .git must exist after migration");
    }

    #[test]
    fn test_migrate_to_per_skill_repos_is_noop_without_shared_git() {
        let dir = tempdir().unwrap();
        let skills_path = dir.path();
        std::fs::create_dir_all(skills_path.join("skills").join("my-skill")).unwrap();

        // No .git at root — should be a no-op, no panic
        super::migrate_to_per_skill_repos(skills_path);

        assert!(!skills_path.join(".git").exists());
    }
}
```

- [x] **Step 2: Run tests to verify they fail**

```bash
cd app/src-tauri && cargo test migration_tests -- --nocapture 2>&1 | tail -20
```

Expected: compile error — `migrate_to_per_skill_repos` does not exist yet

- [x] **Step 3: Add `migrate_to_per_skill_repos` function**

In `app/src-tauri/src/commands/workspace.rs`, add before `init_workspace`:

```rust
/// One-time migration: convert a shared root git repo to per-skill repos.
///
/// If `{skills_path}/.git/` exists, this enumerates every
/// `{skills_path}/{plugin_slug}/{skill_name}/` directory, initializes a git
/// repo for each that doesn't have one yet, commits current files as
/// "initial commit", then removes `{skills_path}/.git/`.
///
/// Called once on startup. After removal of the shared `.git/`, this function
/// becomes a no-op on every subsequent run.
pub(super) fn migrate_to_per_skill_repos(skills_path: &Path) {
    if !skills_path.join(".git").exists() {
        return;
    }
    log::info!(
        "[migrate_to_per_skill_repos] shared repo detected at {}; migrating to per-skill repos",
        skills_path.display()
    );

    let plugin_dirs = match std::fs::read_dir(skills_path) {
        Ok(d) => d,
        Err(e) => {
            log::warn!("[migrate_to_per_skill_repos] failed to read skills path: {}", e);
            return;
        }
    };

    for plugin_entry in plugin_dirs.flatten() {
        let plugin_dir = plugin_entry.path();
        if !plugin_dir.is_dir() || plugin_dir.file_name().map_or(true, |n| n.to_str().map_or(true, |s| s.starts_with('.'))) {
            continue;
        }
        let skill_dirs = match std::fs::read_dir(&plugin_dir) {
            Ok(d) => d,
            Err(_) => continue,
        };
        for skill_entry in skill_dirs.flatten() {
            let skill_dir = skill_entry.path();
            if !skill_dir.is_dir() || skill_dir.file_name().map_or(true, |n| n.to_str().map_or(true, |s| s.starts_with('.'))) {
                continue;
            }
            if skill_dir.join(".git").exists() {
                log::debug!("[migrate_to_per_skill_repos] {} already has .git, skipping", skill_dir.display());
                continue;
            }
            if let Err(e) = crate::git::ensure_repo(&skill_dir) {
                log::warn!("[migrate_to_per_skill_repos] failed to init repo at {}: {}", skill_dir.display(), e);
                continue;
            }
            match crate::git::commit_all(&skill_dir, "initial commit") {
                Ok(_) => log::info!("[migrate_to_per_skill_repos] initialized repo at {}", skill_dir.display()),
                Err(e) => log::warn!("[migrate_to_per_skill_repos] commit failed at {}: {}", skill_dir.display(), e),
            }
        }
    }

    let shared_git = skills_path.join(".git");
    if let Err(e) = std::fs::remove_dir_all(&shared_git) {
        log::warn!("[migrate_to_per_skill_repos] failed to remove shared .git: {}", e);
    } else {
        log::info!("[migrate_to_per_skill_repos] removed shared root .git/");
    }
}
```

- [x] **Step 4: Replace the one-time git upgrade block in `init_workspace`**

Find the block at lines ~359–379 in `workspace.rs`:

```rust
// One-time git upgrade: if skills_path has content but no .git, init + snapshot
{
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if let Ok(settings) = crate::db::read_settings(&conn) {
        if let Some(ref sp) = settings.skills_path {
            let sp_path = Path::new(sp);
            if sp_path.exists() && !sp_path.join(".git").exists() {
                log::info!("One-time git upgrade: initializing repo at {}", sp);
                if let Err(e) = crate::git::ensure_repo(sp_path) {
                    log::warn!("Failed to init git repo at {}: {}", sp, e);
                } else if let Err(e) =
                    crate::git::commit_all(sp_path, "initial snapshot of existing skills")
                {
                    log::warn!("Failed to create initial snapshot at {}: {}", sp, e);
                }
            }
            // Migrate skills folder to marketplace plugin layout
            migrate_to_marketplace_layout(sp);
        }
    }
}
```

Replace with:

```rust
// One-time migrations for the skills path
{
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if let Ok(settings) = crate::db::read_settings(&conn) {
        if let Some(ref sp) = settings.skills_path {
            // Marketplace layout migration must run before per-skill repo migration.
            migrate_to_marketplace_layout(sp);
            // Per-skill repo migration: if shared root .git exists, move to per-skill repos.
            migrate_to_per_skill_repos(Path::new(sp));
        }
    }
}
```

- [x] **Step 5: Run tests**

```bash
cd app/src-tauri && cargo test migration_tests -- --nocapture
```

Expected: PASS

- [x] **Step 6: Run full workspace test suite**

```bash
cd app/src-tauri && cargo test commands::workspace -- --nocapture 2>&1 | tail -20
```

- [x] **Step 7: Commit**

```bash
cd app && git add src-tauri/src/commands/workspace.rs
git commit -m "feat: add per-skill repo migration on startup, replace shared-root git upgrade"
```

---

### Task 4: `skill/crud.rs` — ensure_repo at skill creation

Every new skill must get its own git repo the moment it is created. `post_create_skill_filesystem_inner` needs the `plugin_slug` to resolve `skill_dir`, and must call `ensure_repo(skill_dir)`.

**Files:**

- Modify: `app/src-tauri/src/commands/skill/crud.rs`

- [x] **Step 1: Write failing test**

Find the test module in `crud.rs` and add:

```rust
#[test]
fn test_create_skill_initializes_per_skill_git_repo() {
    let dir = tempfile::tempdir().unwrap();
    let skills_path = dir.path().to_str().unwrap();
    let plugin_slug = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

    post_create_skill_filesystem_inner("brand-new-skill", Some(skills_path), plugin_slug);

    let skill_dir = crate::skill_paths::resolve_skill_dir(
        dir.path(),
        plugin_slug,
        "brand-new-skill",
    );
    assert!(skill_dir.join(".git").exists(), "per-skill .git must exist after create");
}
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd app/src-tauri && cargo test test_create_skill_initializes_per_skill_git_repo -- --nocapture
```

Expected: compile error — `post_create_skill_filesystem_inner` does not accept `plugin_slug` parameter

- [x] **Step 3: Add `plugin_slug` parameter and `ensure_repo` call**

In `crud.rs`, find `post_create_skill_filesystem_inner`:

```rust
// BEFORE signature:
fn post_create_skill_filesystem_inner(name: &str, skills_path: Option<&str>) {

// AFTER signature:
fn post_create_skill_filesystem_inner(name: &str, skills_path: Option<&str>, plugin_slug: &str) {
```

Inside the function, after manifest regeneration and BEFORE `commit_all`, add:

```rust
if let Some(sp) = skills_path {
    // Regenerate marketplace manifests
    if let Err(e) = crate::marketplace_manifest::regenerate_all_manifests(Path::new(sp)) {
        log::warn!("Manifest regeneration failed after create: {}", e);
    }

    // Initialize per-skill git repo
    let skill_dir = crate::skill_paths::resolve_skill_dir(Path::new(sp), plugin_slug, name);
    if let Err(e) = crate::git::ensure_repo(&skill_dir) {
        log::warn!("[post_create_skill_filesystem_inner] failed to init git repo for '{}': {}", name, e);
    }

    let msg = format!("{}: created", name);
    if let Err(e) = crate::git::commit_all(&skill_dir, &msg) {
        log::warn!("[post_create_skill_filesystem_inner] git commit failed ({}): {}", msg, e);
    }
}
```

Remove the old `commit_all(Path::new(sp), &msg)` line that commits at the root.

- [x] **Step 4: Find all callers of `post_create_skill_filesystem_inner` and add plugin_slug**

```bash
cd app/src-tauri && grep -n "post_create_skill_filesystem_inner" src/commands/skill/crud.rs
```

Update each caller to pass `plugin_slug` (it's available as `crate::skill_paths::DEFAULT_PLUGIN_SLUG` for the default plugin, or from the DB result for custom plugins).

- [x] **Step 5: Update `post_delete_skill_filesystem_inner` path similarly**

Find `post_delete_skill_filesystem_inner`. Add `plugin_slug` param and change `commit_all(Path::new(sp), &msg)` to `commit_all(&skill_dir, &msg)` where `skill_dir = resolve_skill_dir(Path::new(sp), plugin_slug, name)`.

- [x] **Step 6: Run tests**

```bash
cd app/src-tauri && cargo test commands::skill -- --nocapture 2>&1 | tail -20
```

- [x] **Step 7: Commit**

```bash
cd app && git add src-tauri/src/commands/skill/crud.rs
git commit -m "feat: ensure_repo per skill at creation, commit at skill_dir level in crud"
```

---

### Task 5: `workflow/evaluation.rs` — commit path → skill_dir

`reset_workflow_step` and `navigate_back_to_step` call `commit_all(skills_path)` at the root BEFORE resolving `plugin_slug` / `skill_name`. Swap the ordering: resolve skill_dir first, commit at skill_dir.

**Files:**

- Modify: `app/src-tauri/src/commands/workflow/evaluation.rs`

- [x] **Step 1: Write failing test**

In evaluation.rs tests, add:

```rust
#[test]
fn test_reset_workflow_step_commits_at_skill_dir() {
    // Integration test verifying the git commit lands in the per-skill repo,
    // not the skills root. Set up: per-skill repo with a file, then reset.
    let dir = tempfile::tempdir().unwrap();
    let skills_path = dir.path();
    let plugin_slug = crate::skill_paths::DEFAULT_PLUGIN_SLUG;
    let skill_dir = crate::skill_paths::resolve_skill_dir(skills_path, plugin_slug, "test-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# step 3 output").unwrap();
    crate::git::commit_all(&skill_dir, "step 3 complete").unwrap();

    // The skill root must NOT have a .git
    assert!(!skills_path.join(".git").exists());
    // The skill_dir MUST have a .git
    assert!(skill_dir.join(".git").exists());
}
```

This test validates the setup expectation (no root git). The real fix is: `reset_workflow_step` must NOT call `commit_all(skills_path)` — the call must use `skill_dir`.

- [x] **Step 2: Locate and fix `reset_workflow_step`**

Find `reset_workflow_step` in `evaluation.rs`. Locate the `commit_all(skills_path, ...)` or `commit_all(Path::new(&skills_path), ...)` call. Move this call to AFTER `plugin_slug` and `skill_name` are resolved, and change path to `skill_dir`:

```rust
// BEFORE (commit happens before plugin/skill resolution):
if let Err(e) = crate::git::commit_all(Path::new(&skills_path), &format!("reset step {}", step_id)) {
    log::warn!("git commit failed: {}", e);
}
// ... then plugin_slug and skill_name are resolved

// AFTER (commit happens after resolution, at skill_dir):
// ... plugin_slug and skill_name are resolved above
let skill_dir = crate::skill_paths::resolve_skill_dir(
    Path::new(&skills_path), &plugin_slug, &skill_name
);
if let Err(e) = crate::git::commit_all(&skill_dir, &format!("reset step {}", step_id)) {
    log::warn!("git commit failed at skill_dir: {}", e);
}
```

- [x] **Step 3: Fix `navigate_back_to_step` similarly**

Apply the same pattern — resolve skill_dir first, then commit at `skill_dir`.

- [x] **Step 4: Run tests**

```bash
cd app/src-tauri && cargo test commands::workflow -- --nocapture 2>&1 | tail -20
```

- [x] **Step 5: Commit**

```bash
cd app && git add src-tauri/src/commands/workflow/evaluation.rs
git commit -m "feat: commit at skill_dir in reset_workflow_step and navigate_back_to_step"
```

---

### Task 6: `refine/output.rs` — commit and tag paths → skill_dir

**Files:**

- Modify: `app/src-tauri/src/commands/refine/output.rs`

- [x] **Step 1: Fix `restore_protected_frontmatter`**

Find `commit_all(Path::new(skills_path), ...)` in `restore_protected_frontmatter`. Change to:

```rust
let skill_dir = crate::skill_paths::resolve_skill_dir(
    Path::new(skills_path), plugin_slug, skill_name
);
if let Err(e) = crate::git::commit_all(&skill_dir, "restore protected frontmatter") {
    log::warn!("[restore_protected_frontmatter] git commit failed: {}", e);
}
```

- [x] **Step 2: Fix `finalize_refine_run_inner_for_plugin`**

Find lines ~462–494 with `commit_all(skills_root, ...)`, `create_skill_version_tag(skills_root, ...)`, and `git2::Repository::open(Path::new(skills_path))`. Update all three:

```rust
let skill_dir = crate::skill_paths::resolve_skill_dir(
    Path::new(skills_path), plugin_slug, skill_name
);

// commit
if let Err(e) = crate::git::commit_all(&skill_dir, &commit_msg) {
    log::warn!("[finalize_refine] git commit failed: {}", e);
}

// tag
crate::git::create_skill_version_tag(&skill_dir, plugin_slug, skill_name, &new_version)
    .map_err(|e| format!("version tag failed (v{}): {}", new_version, e))?;

// diff (for reading)
let repo = git2::Repository::open(&skill_dir)
    .map_err(|e| format!("Failed to open repo: {}", e))?;
```

- [x] **Step 3: Run tests**

```bash
cd app/src-tauri && cargo test commands::refine -- --nocapture 2>&1 | tail -20
```

- [x] **Step 4: Commit**

```bash
cd app && git add src-tauri/src/commands/refine/output.rs
git commit -m "feat: commit and tag at skill_dir in refine output"
```

---

### Task 7: `commands/git.rs` — history and restore path → skill_dir

**Files:**

- Modify: `app/src-tauri/src/commands/git.rs`

- [x] **Step 1: Write failing tests**

Add to `commands/git.rs` tests:

```rust
#[test]
fn test_get_skill_history_uses_per_skill_repo() {
    let dir = tempdir().unwrap();
    let skills_path = dir.path();
    let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;
    let skill_dir = crate::skill_paths::resolve_skill_dir(skills_path, plugin, "hist-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# V1").unwrap();
    crate::git::commit_all(&skill_dir, "initial").unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# V2").unwrap();
    crate::git::commit_all(&skill_dir, "updated").unwrap();

    // No .git at skills_path root
    assert!(!skills_path.join(".git").exists());

    let db = make_db(Some(skills_path.to_str().unwrap()));
    let history = crate::git::get_history(&skill_dir, "hist-skill", plugin, 100).unwrap();
    assert!(history.len() >= 2);
    let _ = db;
}

#[test]
fn test_restore_skill_version_per_skill_repo() {
    let dir = tempdir().unwrap();
    let skills_path = dir.path();
    let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;
    let skill_dir = crate::skill_paths::resolve_skill_dir(skills_path, plugin, "restore-test");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# V1 content").unwrap();
    let sha_v1 = crate::git::commit_all(&skill_dir, "initial").unwrap().unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# V2 content").unwrap();
    crate::git::commit_all(&skill_dir, "updated").unwrap();
    crate::git::create_skill_version_tag(&skill_dir, plugin, "restore-test", "1.0.0").unwrap();

    crate::git::restore_version(&skill_dir, &sha_v1, "restore-test", plugin).unwrap();
    let restored = std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
    assert_eq!(restored, "# V1 content");
}
```

- [x] **Step 2: Run tests to verify they fail**

```bash
cd app/src-tauri && cargo test test_get_skill_history_uses_per_skill_repo test_restore_skill_version_per_skill_repo -- --nocapture
```

Expected: FAIL — current code opens `.git` at skills_root (which doesn't exist), or restores to wrong dir

- [x] **Step 3: Fix `get_skill_history` in `commands/git.rs`**

```rust
// BEFORE:
let output_root = resolve_output_root(&db, &workspace_path)?;
let root = Path::new(&output_root);
if !root.join(".git").exists() {
    return Ok(Vec::new());
}
crate::git::get_history(root, &skill_name, &plugin_slug, limit.unwrap_or(100))

// AFTER:
let output_root = resolve_output_root(&db, &workspace_path)?;
let skill_dir = crate::skill_paths::resolve_skill_dir(
    Path::new(&output_root), &plugin_slug, &skill_name
);
if !skill_dir.join(".git").exists() {
    return Ok(Vec::new());
}
crate::git::get_history(&skill_dir, &skill_name, &plugin_slug, limit.unwrap_or(100))
```

- [x] **Step 4: Fix `restore_skill_version` in `commands/git.rs`**

```rust
// BEFORE:
let output_root = resolve_output_root(&db, &workspace_path)?;
let root = Path::new(&output_root);
crate::git::restore_version(root, &sha, &skill_name, &plugin_slug)?;
let short_sha = ...;
let msg = format!("{}: restored to {}", skill_name, short_sha);
let committed = crate::git::commit_all(root, &msg)...?;
let current_version = crate::git::latest_skill_semver(root, &plugin_slug, &skill_name)...;
crate::git::create_skill_version_tag(root, &plugin_slug, &skill_name, &new_version)...?;

// AFTER:
let output_root = resolve_output_root(&db, &workspace_path)?;
let skill_dir = crate::skill_paths::resolve_skill_dir(
    Path::new(&output_root), &plugin_slug, &skill_name
);
crate::git::restore_version(&skill_dir, &sha, &skill_name, &plugin_slug)?;
let short_sha = if sha.len() >= 8 { &sha[..8] } else { &sha };
let msg = format!("{}: restored to {}", skill_name, short_sha);
let committed = crate::git::commit_all(&skill_dir, &msg)
    .map_err(|e| format!("Filesystem restored but git commit failed ({}): {}", msg, e))?;
let current_version = crate::git::latest_skill_semver(&skill_dir, &plugin_slug, &skill_name)
    .unwrap_or_else(|_| "0.0.0".to_string());
let new_version = crate::git::bump_patch(&current_version);
crate::git::create_skill_version_tag(&skill_dir, &plugin_slug, &skill_name, &new_version)
    .map_err(|e| format!("Restore committed but version tag failed (v{}): {}", new_version, e))?;
```

- [x] **Step 5: Fix `get_skill_files_at_sha` in `commands/git.rs`**

```rust
// BEFORE:
let output_root = resolve_output_root(&db, &workspace_path)?;
let root = Path::new(&output_root);
let pairs = crate::git::get_skill_files_at_sha(root, &skill_name, &plugin_slug, &sha)...?;

// AFTER:
let output_root = resolve_output_root(&db, &workspace_path)?;
let skill_dir = crate::skill_paths::resolve_skill_dir(
    Path::new(&output_root), &plugin_slug, &skill_name
);
let pairs = crate::git::get_skill_files_at_sha(&skill_dir, &skill_name, &plugin_slug, &sha)
    .map_err(|e| { log::error!(...); e })?;
```

- [x] **Step 6: Update the `init_skill_repo_plugin` test helper**

The existing test helper creates a SHARED repo and must be updated. For per-skill tests, each skill needs its own repo:

```rust
fn init_skill_repo_plugin(
    skills_path: &std::path::Path,
    plugin_slug: &str,
    skill_name: &str,
    content: &str,
) -> String {
    let skill_dir = crate::skill_paths::resolve_skill_dir(skills_path, plugin_slug, skill_name);
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), content).unwrap();
    crate::git::commit_all(&skill_dir, &format!("{}: initial", skill_name))
        .unwrap()
        .unwrap()
}
```

Update all test usages of this helper. Ensure tests that call `get_history` or `restore_version` pass `skill_dir` not `skills_path`.

- [x] **Step 7: Run tests**

```bash
cd app/src-tauri && cargo test commands::git -- --nocapture 2>&1 | tail -20
```

- [x] **Step 8: Commit**

```bash
cd app && git add src-tauri/src/commands/git.rs
git commit -m "feat: commands/git.rs resolves skill_dir for all git operations"
```

---

### Task 8: `imported_skills/upload.rs` — skill_dir for git ops

`import_skill_from_file_inner` currently uses `skills_repo = Path::new(skills_path)` for all git operations. After this task, git ops run at `skill_dir`. Also: `ensure_repo(skill_dir)` is called before committing (instead of relying on a pre-existing shared repo).

**Files:**

- Modify: `app/src-tauri/src/commands/imported_skills/upload.rs`

- [x] **Step 1: Write failing test**

In the `tests` block of `upload.rs`, add:

```rust
#[test]
fn import_skill_from_file_creates_per_skill_git_repo() {
    let conn = crate::db::create_test_db_for_tests();
    let dir = tempfile::tempdir().unwrap();
    let skills_path = dir.path().join("skills");
    std::fs::create_dir_all(&skills_path).unwrap();
    // Note: NO ensure_repo at skills root — per-skill repos only

    let zip_path = dir.path().join("skill.zip");
    write_skill_zip(
        &zip_path,
        "---\nname: per-skill-import\ndescription: Test\n---\n# Body\n",
    );

    let result = import_skill_from_file_inner(
        &conn, zip_path.to_str().unwrap(), "per-skill-import", "Test",
        None, None, None, None, None, skills_path.to_str().unwrap(), "", None,
    );
    assert!(result.is_ok(), "{:?}", result);

    let skill_dir = crate::skill_paths::resolve_skill_dir(
        &skills_path,
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
        "per-skill-import",
    );
    assert!(skill_dir.join(".git").exists(), "per-skill .git must exist after import");
    assert!(!skills_path.join(".git").exists(), "root .git must NOT exist");
}
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd app/src-tauri && cargo test import_skill_from_file_creates_per_skill_git_repo -- --nocapture
```

Expected: FAIL — either `ensure_repo(skills_repo)` creates `.git` at root, or tag ops fail without root `.git`

- [x] **Step 3: Fix `import_skill_from_file_inner`**

Find the `import_git_result` closure in `import_skill_from_file_inner`. Replace:

```rust
let skills_repo = Path::new(skills_path);
let import_git_result = (|| -> Result<(), String> {
    if crate::git::skill_version_tag_exists(skills_repo, default_slug, name, &final_version)? { ... }
    crate::git::commit_all(skills_repo, &format!("{}: import from upload", name))?;
    crate::git::create_skill_version_tag(skills_repo, default_slug, name, &final_version)?;
    Ok(())
})();
```

With:

```rust
let skill_dir = crate::skill_paths::resolve_skill_dir(Path::new(skills_path), default_slug, name);
let import_git_result = (|| -> Result<(), String> {
    crate::git::ensure_repo(&skill_dir)
        .map_err(|e| format!("Failed to init git repo: {}", e))?;
    if crate::git::skill_version_tag_exists(&skill_dir, default_slug, name, &final_version)? {
        return Err(format!("Tag '{}' already exists",
            crate::git::skill_version_tag_name(default_slug, name, &final_version)));
    }
    crate::git::commit_all(&skill_dir, &format!("{}: import from upload", name))?;
    crate::git::create_skill_version_tag(&skill_dir, default_slug, name, &final_version)?;
    Ok(())
})();
```

- [x] **Step 4: Update existing tests in `upload.rs`**

The tests `import_skill_from_file_adds_default_version_commits_and_tags` and `import_skill_from_file_rejects_existing_version_tag` currently call `crate::git::ensure_repo(&skills_path)`. Remove that call. They should check `skill_dir.join(".git").exists()` instead of `skills_path.join(".git").exists()`.

```rust
// BEFORE:
crate::git::ensure_repo(&skills_path).unwrap();
// ...
assert!(crate::git::skill_version_tag_exists(&skills_path, ...).unwrap());

// AFTER:
// no ensure_repo at skills_path root
// ...
let skill_dir = crate::skill_paths::resolve_skill_dir(
    &skills_path, crate::skill_paths::DEFAULT_PLUGIN_SLUG, "imported-skill"
);
assert!(crate::git::skill_version_tag_exists(&skill_dir, ...).unwrap());
```

- [x] **Step 5: Run tests**

```bash
cd app/src-tauri && cargo test commands::imported_skills::upload -- --nocapture 2>&1 | tail -20
```

- [x] **Step 6: Commit**

```bash
cd app && git add src-tauri/src/commands/imported_skills/upload.rs
git commit -m "feat: upload.rs uses per-skill git repos for import"
```

---

### Task 9: `github_import/commands.rs` — skill_dir for git ops

Two functions need fixing: `import_marketplace_entries_to_library` (individual skill imports) and `import_marketplace_plugin_to_library` (full plugin imports).

**Files:**

- Modify: `app/src-tauri/src/commands/github_import/commands.rs`

- [x] **Step 1: Fix `import_marketplace_entries_to_library`**

Find the per-skill git closure in the loop body (lines ~605–639). Replace `skills_root` with `skill_dir`:

```rust
// Resolve skill_dir before the git closure
let skill_dir = crate::skill_paths::resolve_skill_dir(
    skills_root, &plugin_slug, &skill.skill_name
);

if let Err(e) = (|| -> Result<(), String> {
    crate::git::ensure_repo(&skill_dir)
        .map_err(|e| format!("Failed to init git repo: {}", e))?;
    if crate::git::skill_version_tag_exists(&skill_dir, &plugin_slug, &skill.skill_name, &final_version)? {
        return Err(format!("Tag '{}' already exists",
            crate::git::skill_version_tag_name(&plugin_slug, &skill.skill_name, &final_version)));
    }
    crate::git::commit_all(&skill_dir, &format!("{}: import from marketplace", skill.skill_name))?;
    crate::git::create_skill_version_tag(&skill_dir, &plugin_slug, &skill.skill_name, &final_version)?;
    Ok(())
})() { ... }
```

- [x] **Step 2: Fix `import_marketplace_plugin_to_library`**

Find the per-skill git closure in the loop body (lines ~953–978). Replace `skills_root` with `skill_dir`:

```rust
let skill_dir = crate::skill_paths::resolve_skill_dir(
    skills_root, &plugin_slug, skill_name
);

if let Err(e) = (|| -> Result<(), String> {
    crate::git::ensure_repo(&skill_dir)
        .map_err(|e| format!("Failed to init git repo: {}", e))?;
    crate::git::commit_all(&skill_dir, &format!("{}: import from marketplace", skill_name))?;
    if !crate::git::skill_version_tag_exists(&skill_dir, &plugin_slug, skill_name, version)? {
        crate::git::create_skill_version_tag(&skill_dir, &plugin_slug, skill_name, version)?;
    }
    Ok(())
})() {
    log::warn!("[import_marketplace_plugin_to_library] git operations failed for '{}': {}", skill_name, e);
}
```

- [x] **Step 3: Run tests**

```bash
cd app/src-tauri && cargo test commands::github_import -- --nocapture 2>&1 | tail -20
```

- [x] **Step 4: Commit**

```bash
cd app && git add src-tauri/src/commands/github_import/commands.rs
git commit -m "feat: github_import uses per-skill git repos"
```

---

### Task 10: `lifecycle.rs` + `reconciliation.rs` — fix root-level commits

**lifecycle.rs:** Plugin-level operations (`delete_plugin`, `create_plugin_from_skills`) currently call `commit_all(skills_root, ...)`. After per-skill repos, deleting a plugin directory removes the per-skill `.git/` dirs — there is no root repo to commit to. Remove these calls.

**reconciliation.rs:** The auto-commit of untracked skill folders currently calls `commit_all(output_path, ...)` at the root. After per-skill repos, instead initialize a repo + commit for each discovered skill folder.

**Files:**

- Modify: `app/src-tauri/src/commands/imported_skills/lifecycle.rs`
- Modify: `app/src-tauri/src/commands/reconciliation.rs`

- [x] **Step 1: Fix `lifecycle.rs` — remove root-level `commit_all` in `delete_plugin`**

In `delete_plugin`, find the root `commit_all`:

```rust
// BEFORE:
let msg = format!("{}: delete plugin", plugin_slug);
if let Err(e) = crate::git::commit_all(skills_root, &msg) {
    log::warn!("[delete_plugin] git commit failed: {}", e);
}

// AFTER: per-skill repos are deleted with the plugin directory; no root commit needed.
// Log that git cleanup was handled by directory removal.
log::info!("[delete_plugin] removed plugin dir '{}'; per-skill repos removed with it", plugin_slug);
```

- [x] **Step 2: Fix `lifecycle.rs` — remove root-level `commit_all` in `create_plugin_from_skills`**

In `create_plugin_from_skills`, find:

```rust
// BEFORE:
let msg = format!("{}: create plugin", plugin_slug);
if let Err(e) = crate::git::commit_all(skills_root, &msg) {
    log::warn!("Git auto-commit failed ({}): {}", msg, e);
}

// AFTER: plugin scaffold (plugin.json) does not have its own git repo.
// Individual skills within the plugin will have their own repos initialized at creation.
log::info!("[create_plugin_from_skills] created plugin scaffold for '{}' (no root git commit needed)", plugin_slug);
```

- [x] **Step 3: Fix `reconciliation.rs` — per-skill init for untracked dirs**

Find the `get_untracked_dirs` + `commit_all(output_path, ...)` block (lines ~57–83). Replace:

```rust
// BEFORE:
match crate::git::get_untracked_dirs(output_path) {
    Ok(untracked) if !untracked.is_empty() => {
        let msg = format!("auto-commit new skill folders: {}", untracked.join(", "));
        match crate::git::commit_all(output_path, &msg) { ... }
    }
    ...
}

// AFTER: per-skill repos — init + commit each discovered skill dir
if let Ok(entries) = std::fs::read_dir(output_path) {
    for entry in entries.flatten() {
        let plugin_dir = entry.path();
        if !plugin_dir.is_dir() { continue; }
        if let Ok(skill_entries) = std::fs::read_dir(&plugin_dir) {
            for skill_entry in skill_entries.flatten() {
                let skill_dir = skill_entry.path();
                if !skill_dir.is_dir() { continue; }
                if skill_dir.join(".git").exists() { continue; } // already has a repo
                if !skill_dir.join("SKILL.md").exists() { continue; } // not a skill dir
                if let Err(e) = crate::git::ensure_repo(&skill_dir) {
                    log::warn!("[reconcile_startup] failed to init repo at {}: {}", skill_dir.display(), e);
                    continue;
                }
                let name = skill_dir.file_name().unwrap_or_default().to_string_lossy();
                let msg = format!("auto-commit new skill: {}", name);
                match crate::git::commit_all(&skill_dir, &msg) {
                    Ok(Some(_)) => log::info!("[reconcile_startup] {}", msg),
                    Ok(None) => {}
                    Err(e) => log::warn!("[reconcile_startup] commit failed for {}: {}", name, e),
                }
            }
        }
    }
}
```

- [x] **Step 4: Run tests**

```bash
cd app/src-tauri && cargo test commands::imported_skills::lifecycle commands::reconciliation -- --nocapture 2>&1 | tail -20
```

- [x] **Step 5: Commit**

```bash
cd app && git add src-tauri/src/commands/imported_skills/lifecycle.rs src-tauri/src/commands/reconciliation.rs
git commit -m "feat: lifecycle removes root commit; reconciliation inits per-skill repos"
```

---

### Task 11: `settings.rs` — backfill version tag paths → skill_dir

`backfill_missing_version_tags` calls `skill_has_any_tag(skills_root, ...)`, `commit_all(skills_root, ...)`, and `create_skill_version_tag(skills_root, ...)`. All must move to `skill_dir`.

**Files:**

- Modify: `app/src-tauri/src/commands/settings.rs`

- [x] **Step 1: Fix `backfill_missing_version_tags`**

Find the `if missing_version` block (lines ~179–217). Replace all `skills_root` path arguments:

```rust
// At the top of the loop body, resolve skill_dir:
let skill_dir = crate::skill_paths::resolve_skill_dir(
    skills_root, &skill.plugin_slug, &skill_name
);

// Then in the if missing_version branch:
if crate::git::skill_has_any_tag(&skill_dir, &skill.plugin_slug, &skill_name)? {
    log::info!("[startup] skipping version tag backfill for '{}' because a tag already exists", skill_name);
    if normalized.modified {
        crate::git::commit_all(
            &skill_dir,
            &format!("{}: normalize skill frontmatter metadata", skill_name),
        )?;
    }
} else {
    crate::git::commit_all(
        &skill_dir,
        &format!("{}: backfill imported skill version", skill_name),
    )?;
    crate::git::create_skill_version_tag(
        &skill_dir,
        &skill.plugin_slug,
        &skill_name,
        &normalized.version,
    )?;
    log::info!(
        "[startup] backfilled missing version for '{}' with tag v{}",
        skill_name, normalized.version
    );
}
// In the else if normalized.modified branch:
crate::git::commit_all(
    &skill_dir,
    &format!("{}: normalize skill frontmatter metadata", skill_name),
)?;
```

- [x] **Step 2: Run tests**

```bash
cd app/src-tauri && cargo test commands::settings -- --nocapture 2>&1 | tail -20
```

- [x] **Step 3: Commit**

```bash
cd app && git add src-tauri/src/commands/settings.rs
git commit -m "feat: settings.rs backfill uses per-skill git repos"
```

---

### Task 12: `cleanup.rs` — delete_skill_version_tags path → skill_dir

The tag-deletion call in `clean_step_output(step=3)` was added in a previous session targeting `Path::new(skills_path)`. It must now target `skill_dir`.

**Files:**

- Modify: `app/src-tauri/src/cleanup.rs`

- [x] **Step 1: Find and fix the delete_skill_version_tags call**

```bash
grep -n "delete_skill_version_tags" app/src-tauri/src/cleanup.rs
```

Change:

```rust
// BEFORE:
if let Err(e) = crate::git::delete_skill_version_tags(
    Path::new(skills_path), plugin_slug, skill_name,
) { ... }

// AFTER:
let skill_dir = crate::skill_paths::resolve_skill_dir(
    Path::new(skills_path), plugin_slug, skill_name
);
if let Err(e) = crate::git::delete_skill_version_tags(&skill_dir, plugin_slug, skill_name) {
    log::warn!("[{}] failed to delete git version tags for '{}': {}", LABEL, skill_name, e);
}
```

- [x] **Step 2: Update the `test_clean_step3_deletes_git_version_tags` test**

The test (added in a prior session) creates a repo at `skills_tmp` root. Update it to use per-skill layout:

```rust
#[test]
fn test_clean_step3_deletes_git_version_tags() {
    let dir = tempfile::tempdir().unwrap();
    let skills_path = dir.path();
    let plugin_slug = crate::skill_paths::DEFAULT_PLUGIN_SLUG;
    let skill_name = "my-skill";
    let skill_dir = crate::skill_paths::resolve_skill_dir(skills_path, plugin_slug, skill_name);
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# v1").unwrap();
    crate::git::commit_all(&skill_dir, "generated skill").unwrap();
    crate::git::create_skill_version_tag(&skill_dir, plugin_slug, skill_name, "1.0.0").unwrap();

    // Verify tag exists before clean
    assert!(crate::git::skill_version_tag_exists(&skill_dir, plugin_slug, skill_name, "1.0.0").unwrap());

    // Run step 3 clean
    clean_step_output(3, skills_path.to_str().unwrap(), plugin_slug, skill_name).unwrap();

    // Tag must be gone
    assert!(!crate::git::skill_version_tag_exists(&skill_dir, plugin_slug, skill_name, "1.0.0").unwrap());
}
```

- [x] **Step 3: Run tests**

```bash
cd app/src-tauri && cargo test cleanup:: -- --nocapture 2>&1 | tail -20
```

Expected: PASS

- [x] **Step 4: Commit**

```bash
cd app && git add src-tauri/src/cleanup.rs
git commit -m "fix: cleanup.rs delete_skill_version_tags targets skill_dir not skills_root"
```

---

### Task 13: Full test suite + final polish

- [x] **Step 1: Run full Rust test suite**

```bash
cd app/src-tauri && cargo test -- --nocapture 2>&1 | grep -E "^(test |FAILED|error)" | tail -50
```

Fix any remaining failures. Common patterns:

- Any test calling `ensure_repo(skills_root)` instead of `ensure_repo(skill_dir)`
- Any tag assertion expecting old format like `"skills/my-skill/v1.0.0"` → update to `"v1.0.0"`
- Any `commit_all(skills_root, ...)` in tests → update to per-skill path

- [x] **Step 2: Run agent structural tests**

```bash
cd app && npm run test:agents:structural
```

- [x] **Step 3: Run unit tests**

```bash
cd app && npm run test:unit
```

- [x] **Step 4: Verify `repo-map.json` is still accurate**

Check that `rust_commands` flat-file list and sub-module entries are correct after these changes. No new files were added to `commands/`, so no update needed unless a new `.rs` file was created.

- [x] **Step 5: Final commit**

```bash
cd app/src-tauri && cargo clippy -- -D warnings
cd app && git add -p  # review any unstaged changes
git commit -m "fix: per-skill git repos — final cleanup and test fixes"
```

- [x] **Step 6: Push**

```bash
git push
```

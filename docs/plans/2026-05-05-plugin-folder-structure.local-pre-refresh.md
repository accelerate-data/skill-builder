# Plugin Folder Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the canonical skill path from `{skills_dir}/{plugin_slug}/{skill_name}` to `{skills_dir}/{plugin_name}/skills/{skill_name}`, making `skills/` a fixed subdirectory inside the plugin root and enabling sibling directories (`evals/`) at the plugin level.

**Architecture:** `plugin-paths.json` is the source of truth for path templates. `skill_paths.rs` reads the JSON at compile time via `include_str!`. The `DEFAULT_PLUGIN_SLUG` constant changes from `"skills"` to `"default"`. `enumerate_skill_locations` is updated to scan the three-level canonical layout while retaining backward-compatible discovery for existing installations. Git read-prefix priority is fixed to match the new canonical. No file migration on disk — the app discovers both old and new layouts.

**Tech Stack:** Rust / Tauri / `plugin-paths.json`. Minimal frontend impact (template resolution is generic). No SQLite schema changes.

**Design doc:** `docs/design/plugin-path-restructure/README.md`

---

## File Structure

| File | Change |
|---|---|
| `app/plugin-paths.json` | `skill_dir`, `workspace_skill_dir`, `tag_prefix`, `tag_glob` templates gain `skills/` level; `default_plugin_slug` → `"default"` |
| `app/src-tauri/src/skill_paths.rs` | `DEFAULT_PLUGIN_SLUG` → `"default"`; `DEFAULT_PLUGIN_DISPLAY_NAME` → `"Default"`; `enumerate_skill_locations` updated for three-level scan + legacy fallback; unit tests updated |
| `app/src-tauri/src/git.rs` | Read-prefix priority swapped; `migrate_marketplace_skill_tags` removed |

---

### Task 1: Update `plugin-paths.json`

**Files:**
- Modify: `app/plugin-paths.json`
- Test: `app/src-tauri/src/skill_paths.rs` (existing tests catch regressions)

- [ ] **Step 1: Write failing tests**

Add to `app/src-tauri/src/skill_paths.rs` tests module:

```rust
#[test]
fn test_skill_dir_includes_skills_subdir() {
    let root = Path::new("/users/alice/my-plugins");
    let dir = resolve_skill_dir(root, "superpowers", "analyzing-bookings");
    assert_eq!(dir, Path::new("/users/alice/my-plugins/superpowers/skills/analyzing-bookings"));
}

#[test]
fn test_skill_tag_prefix_includes_skills_subdir() {
    assert_eq!(
        skill_tag_prefix("superpowers", "analyzing-bookings"),
        "superpowers/skills/analyzing-bookings/v"
    );
}

#[test]
fn test_workspace_skill_dir_includes_skills_subdir() {
    let workspace = Path::new("/data/workspace");
    let dir = workspace_skill_dir(workspace, "superpowers", "my-skill");
    assert_eq!(dir, Path::new("/data/workspace/superpowers/skills/my-skill"));
}
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml skill_paths 2>&1 | grep -E "FAILED|test result"
```

Expected: 3 failures with path mismatch.

- [ ] **Step 3: Update `plugin-paths.json`**

```json
{
  "default_plugin_slug": "default",
  "skill_dir": "{root}/{plugin_slug}/skills/{skill_name}",
  "workspace_skill_dir": "{workspace}/{plugin_slug}/skills/{skill_name}",
  "tag_prefix": "{plugin_slug}/skills/{skill_name}/v",
  "tag_glob": "{plugin_slug}/skills/{skill_name}/*",
  "_note": "plugin_slug is always required in skill paths. Never construct {root}/{skill_name} directly. Use skill_paths::resolve_skill_dir(root, plugin_slug, skill_name) in Rust.",
  "_examples": {
    "default_plugin_skill_dir": "C:/users/skill-builder/default/skills/my-skill",
    "custom_plugin_skill_dir": "C:/users/skill-builder/my-plugin/skills/my-skill",
    "workspace_skill_dir_example": "C:/AppData/workspace/default/skills/my-skill"
  }
}
```

- [ ] **Step 4: Run tests — verify 3 new tests pass**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml skill_paths::tests::test_skill_dir 2>&1 | grep -E "FAILED|ok"
```

- [ ] **Step 5: Commit**

```bash
git add app/plugin-paths.json app/src-tauri/src/skill_paths.rs
git commit -m "feat: add skills/ level to plugin-paths.json path templates"
```

---

### Task 2: Update `DEFAULT_PLUGIN_SLUG` constant

**Files:**
- Modify: `app/src-tauri/src/skill_paths.rs` (line 5–6)

- [ ] **Step 1: Write failing test**

```rust
#[test]
fn test_default_plugin_slug_is_default() {
    assert_eq!(DEFAULT_PLUGIN_SLUG, "default");
}
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml test_default_plugin_slug_is_default 2>&1 | grep -E "FAILED|ok"
```

- [ ] **Step 3: Update the constants**

In `app/src-tauri/src/skill_paths.rs`:

```rust
pub const DEFAULT_PLUGIN_SLUG: &str = "default";
pub const DEFAULT_PLUGIN_DISPLAY_NAME: &str = "Default";
```

- [ ] **Step 4: Run full skill_paths tests and fix any broken assertions**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml skill_paths 2>&1 | grep -E "FAILED|ok|error"
```

Fix any test that previously expected `"skills"` in a path or as the slug value. Each fix should be a mechanical substitution — `"skills"` → `"default"` in the expected path string, or `DEFAULT_PLUGIN_SLUG` usage.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/skill_paths.rs
git commit -m "feat: change DEFAULT_PLUGIN_SLUG from 'skills' to 'default'"
```

---

### Task 3: Update `enumerate_skill_locations` for new canonical layout

**Files:**
- Modify: `app/src-tauri/src/skill_paths.rs` (`enumerate_skill_locations` function, ~lines 169–250)

The new canonical is a three-level layout: `root/{plugin}/skills/{name}/`. The current function does a two-level scan (`root/{slug}/{name}/`). It needs to recognise `skills/` as the fixed subdirectory and scan one level deeper for it, while retaining discovery of old two-level layouts.

- [ ] **Step 1: Write failing tests**

```rust
#[test]
fn test_enumerate_discovers_new_canonical_layout() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_dir = tmp.path()
        .join("superpowers")
        .join("skills")
        .join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# My Skill").unwrap();

    let locations = enumerate_skill_locations(tmp.path()).unwrap();
    assert_eq!(locations.len(), 1);
    assert_eq!(locations[0].plugin_slug, "superpowers");
    assert_eq!(locations[0].skill_name, "my-skill");
    assert_eq!(locations[0].dir, skill_dir);
}

#[test]
fn test_enumerate_discovers_legacy_plugin_layout() {
    // Old two-level layout: root/{slug}/{name}/ — must still be found
    let tmp = tempfile::tempdir().unwrap();
    let skill_dir = tmp.path().join("analytics").join("weekly-report");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Weekly Report").unwrap();

    let locations = enumerate_skill_locations(tmp.path()).unwrap();
    assert_eq!(locations.len(), 1);
    assert_eq!(locations[0].plugin_slug, "analytics");
    assert_eq!(locations[0].skill_name, "weekly-report");
}

#[test]
fn test_enumerate_discovers_both_layouts_simultaneously() {
    let tmp = tempfile::tempdir().unwrap();
    // New canonical
    let new_skill = tmp.path().join("superpowers").join("skills").join("new-skill");
    std::fs::create_dir_all(&new_skill).unwrap();
    std::fs::write(new_skill.join("SKILL.md"), "# New").unwrap();
    // Legacy plugin layout
    let old_skill = tmp.path().join("analytics").join("old-skill");
    std::fs::create_dir_all(&old_skill).unwrap();
    std::fs::write(old_skill.join("SKILL.md"), "# Old").unwrap();

    let locations = enumerate_skill_locations(tmp.path()).unwrap();
    assert_eq!(locations.len(), 2);
}
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml test_enumerate_discovers_new_canonical 2>&1 | grep -E "FAILED|ok"
```

- [ ] **Step 3: Rewrite `enumerate_skill_locations`**

Replace the body of the function in `skill_paths.rs`:

```rust
pub fn enumerate_skill_locations(root: &Path) -> Result<Vec<SkillLocation>, String> {
    if !root.exists() {
        return Ok(vec![]);
    }

    let mut discovered = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for entry in
        fs::read_dir(root).map_err(|e| format!("Failed to read '{}': {}", root.display(), e))?
    {
        let entry = entry.map_err(|e| {
            format!("Failed to read entry in '{}': {}", root.display(), e)
        })?;
        let path = entry.path();
        if !path.is_dir() { continue; }
        let plugin_name = entry.file_name().to_string_lossy().to_string();
        if plugin_name.starts_with('.') { continue; }

        let is_default = plugin_name == DEFAULT_PLUGIN_SLUG;

        // New canonical: root/{plugin}/skills/{name}/
        let skills_subdir = path.join("skills");
        if skills_subdir.is_dir() {
            if let Ok(children) = fs::read_dir(&skills_subdir) {
                for skill_entry in children.flatten() {
                    let skill_path = skill_entry.path();
                    if !skill_path.is_dir() { continue; }
                    let skill_name = skill_entry.file_name().to_string_lossy().to_string();
                    if skill_name.starts_with('.') || !is_skill_dir(&skill_path) { continue; }
                    let key = (plugin_name.clone(), skill_name.clone());
                    if seen.insert(key) {
                        discovered.push(SkillLocation {
                            plugin_slug: plugin_name.clone(),
                            plugin_display_name: if is_default {
                                DEFAULT_PLUGIN_DISPLAY_NAME.to_string()
                            } else {
                                plugin_display_name(&plugin_name)
                            },
                            is_default_plugin: is_default,
                            skill_name,
                            dir: skill_path,
                        });
                    }
                }
            }
            continue; // plugin has skills/ subdir — don't also scan its root children
        }

        // Legacy plugin layout: root/{plugin}/{name}/ (old two-level format)
        let mut found_legacy_child = false;
        if let Ok(children) = fs::read_dir(&path) {
            for skill_entry in children.flatten() {
                let skill_path = skill_entry.path();
                if !skill_path.is_dir() { continue; }
                let skill_name = skill_entry.file_name().to_string_lossy().to_string();
                if skill_name.starts_with('.') || !is_skill_dir(&skill_path) { continue; }
                let key = (plugin_name.clone(), skill_name.clone());
                if seen.insert(key) {
                    discovered.push(SkillLocation {
                        plugin_slug: plugin_name.clone(),
                        plugin_display_name: if is_default {
                            DEFAULT_PLUGIN_DISPLAY_NAME.to_string()
                        } else {
                            plugin_display_name(&plugin_name)
                        },
                        is_default_plugin: is_default,
                        skill_name,
                        dir: skill_path,
                    });
                }
                found_legacy_child = true;
            }
        }
        if found_legacy_child { continue; }

        // Legacy flat: root/{name}/ with SKILL.md directly inside
        if is_skill_dir(&path) {
            let key = (DEFAULT_PLUGIN_SLUG.to_string(), plugin_name.clone());
            if seen.insert(key) {
                discovered.push(SkillLocation {
                    plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
                    plugin_display_name: DEFAULT_PLUGIN_DISPLAY_NAME.to_string(),
                    is_default_plugin: true,
                    skill_name: plugin_name,
                    dir: path,
                });
            }
        }
    }

    discovered.sort_by(|a, b| {
        a.plugin_slug.cmp(&b.plugin_slug)
            .then_with(|| a.skill_name.cmp(&b.skill_name))
    });
    Ok(discovered)
}
```

- [ ] **Step 4: Run all enumerate tests — verify they pass**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml enumerate 2>&1 | grep -E "FAILED|ok"
```

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/skill_paths.rs
git commit -m "feat: update enumerate_skill_locations for {plugin}/skills/{name}/ canonical layout"
```

---

### Task 4: Fix git read-prefix priority and remove `migrate_marketplace_skill_tags`

**Files:**
- Modify: `app/src-tauri/src/git.rs`

The current read-prefix order in the version restore path incorrectly labels `{plugin}/skills/{name}/` as "old marketplace layout". After this change it is the canonical format and must be first priority. The `migrate_marketplace_skill_tags` function migrated tags away from the correct canonical — remove it.

- [ ] **Step 1: Write failing test**

Find the test for `migrate_marketplace_skill_tags` in `git.rs` or its test module. The test should no longer pass (function is removed). Add a test for the correct read-prefix priority:

```rust
#[test]
fn test_canonical_read_prefix_is_plugin_skills_name() {
    // The canonical git object prefix for skill files is {plugin}/skills/{name}/
    // This is position 0 in the read-prefix list used by restore_version.
    let prefix = format!("{}/skills/{}/", "superpowers", "my-skill");
    assert_eq!(prefix, "superpowers/skills/my-skill/");
}
```

- [ ] **Step 2: In `git.rs`, update the read-prefix array**

Find the comment block around line 612–625 that lists read prefixes. Update to:

```rust
// Read prefixes in priority order (first match wins):
// 1. Canonical layout     ({plugin}/skills/{name}/)
// 2. Legacy plugin layout ({plugin}/{name}/)        — pre-restructure installs
// 3. Default plugin layout (default/skills/{name}/) — redundant with #1 but included for default slug alias
// 4. Legacy flat layout   ({name}/)
read_prefixes.push(format!("{}/skills/{}/", plugin_slug, skill_name)); // canonical
read_prefixes.push(format!("{}/{}/", plugin_slug, skill_name));        // legacy plugin
read_prefixes.push(format!("{}/", skill_name));                        // legacy flat
```

- [ ] **Step 3: Remove `migrate_marketplace_skill_tags`**

Delete the entire `migrate_marketplace_skill_tags` function and all its call sites. Search for callers:

```bash
grep -rn "migrate_marketplace_skill_tags" app/src-tauri/src/ | grep -v "^Binary"
```

Remove each call site. If it was called on startup (e.g., in `commands/workspace.rs` or `commands/settings.rs`), remove that call.

- [ ] **Step 4: Run git-related tests**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml git 2>&1 | grep -E "FAILED|ok|error"
```

Fix any test that referenced `migrate_marketplace_skill_tags`.

- [ ] **Step 5: Run full cargo test**

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "FAILED|test result"
```

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/git.rs
git commit -m "fix: promote {plugin}/skills/{name}/ to canonical git read-prefix, remove migrate_marketplace_skill_tags"
```

---

### Task 5: Update `plugin-paths.json` comment in README and design/README.md index

**Files:**
- Modify: `docs/design/README.md` (add entry for plugin-path-restructure)
- Modify: `app/plugin-paths.json` (already done in Task 1 — verify examples are correct)

- [ ] **Step 1: Add design doc entry**

In `docs/design/README.md`, add a row to the table:

```markdown
| [plugin-path-restructure/](plugin-path-restructure/README.md) | Plugin directory restructure: adds skills/ fixed subdirectory inside plugin root, enables evals/ sibling |
```

- [ ] **Step 2: Run unit + integration tests**

```bash
cd app && npm run test:unit && cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

All passing.

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs: add plugin-path-restructure design doc to index"
```

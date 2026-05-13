# Canonical Skill Identity for Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove name-based skill resolution from the artifact resolution path and enforce `skills.id` as the only persistence identity for clarifications and decisions.

**Architecture:** Introduce a `SkillIdentifier` enum that parses structured identifiers (integer ID, `skill-builder:plugin:name`, `imported:id`) and rejects bare skill names. All artifact DB operations resolve through this type. Name-based resolution requires `(skill_name, plugin_slug)`. Dead code paths are removed.

**Tech Stack:** Rust (rusqlite), Tauri commands, SQLite

---

### Task 1: Create `SkillIdentifier` type and parser

**Files:**
- Create: `app/src-tauri/src/db/skill_identifier.rs`
- Modify: `app/src-tauri/src/db/mod.rs`

- [ ] **Step 1: Create the `SkillIdentifier` module**

Create `app/src-tauri/src/db/skill_identifier.rs`:

```rust
use rusqlite::Connection;

/// A structured skill identifier that can be resolved to a `skills.id` integer.
///
/// Bare skill names are intentionally excluded — name-based resolution requires
/// `(skill_name, plugin_slug)` via `get_skill_master_id_in_plugin`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillIdentifier {
    /// Direct `skills.id` integer (e.g. `"42"`).
    ById(i64),
    /// Builder library key (e.g. `"skill-builder:default:my-skill"`).
    ByBuilderKey { plugin: String, name: String },
    /// Imported skill ID (e.g. `"imported:123"`). After migration 51, these are
    /// `skills.id` integers. Kept as a separate variant for backward-compatible
    /// parsing of external callers still using the `imported:` prefix.
    ByImportedId(i64),
}

/// Errors returned by `SkillIdentifier::parse`.
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("skill_id is required")]
    Empty,
    #[error("skill_id must be a numeric ID or structured key (skill-builder:plugin:name or imported:id)")]
    InvalidFormat,
}

impl SkillIdentifier {
    /// Parse a string into a `SkillIdentifier`. Rejects bare skill names.
    pub fn parse(input: &str) -> Result<Self, ParseError> {
        let input = input.trim();
        if input.is_empty() {
            return Err(ParseError::Empty);
        }

        // Try raw integer first
        if let Ok(id) = input.parse::<i64>() {
            return Ok(SkillIdentifier::ById(id));
        }

        // Try structured prefixes
        if let Some(rest) = input.strip_prefix("skill-builder:") {
            if let Some((plugin, name)) = rest.split_once(':') {
                if !plugin.is_empty() && !name.is_empty() {
                    return Ok(SkillIdentifier::ByBuilderKey {
                        plugin: plugin.to_string(),
                        name: name.to_string(),
                    });
                }
            }
        }

        if let Some(rest) = input.strip_prefix("imported:") {
            if let Ok(id) = rest.parse::<i64>() {
                return Ok(SkillIdentifier::ByImportedId(id));
            }
        }

        Err(ParseError::InvalidFormat)
    }

    /// Resolve this identifier to a `skills.id` integer.
    pub fn resolve_to_db_id(&self, conn: &Connection) -> Result<i64, String> {
        match self {
            SkillIdentifier::ById(id) => {
                let row = conn
                    .query_row(
                        "SELECT id FROM skills WHERE id = ?1 AND COALESCE(deleted_at, '') = ''",
                        rusqlite::params![id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
                row.ok_or_else(|| format!("Skill not found: {}", id))
            }
            SkillIdentifier::ByBuilderKey { plugin, name } => {
                crate::db::get_skill_master_id_in_plugin(conn, name, plugin)?
                    .ok_or_else(|| {
                        format!("Skill not found: skill-builder:{}:{}", plugin, name)
                    })
            }
            SkillIdentifier::ByImportedId(id) => {
                let row = conn
                    .query_row(
                        "SELECT id FROM skills WHERE id = ?1 AND COALESCE(deleted_at, '') = ''",
                        rusqlite::params![id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
                row.ok_or_else(|| format!("Skill not found: imported:{}", id))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{create_test_db_for_tests, ensure_default_plugin, upsert_skill_in_plugin};

    #[test]
    fn parse_integer_id() {
        assert_eq!(SkillIdentifier::parse("42"), Ok(SkillIdentifier::ById(42)));
        assert_eq!(SkillIdentifier::parse("-1"), Ok(SkillIdentifier::ById(-1)));
        assert_eq!(SkillIdentifier::parse("0"), Ok(SkillIdentifier::ById(0)));
    }

    #[test]
    fn parse_builder_key() {
        assert_eq!(
            SkillIdentifier::parse("skill-builder:default:my-skill"),
            Ok(SkillIdentifier::ByBuilderKey {
                plugin: "default".to_string(),
                name: "my-skill".to_string(),
            })
        );
    }

    #[test]
    fn parse_imported_id() {
        assert_eq!(
            SkillIdentifier::parse("imported:123"),
            Ok(SkillIdentifier::ByImportedId(123))
        );
    }

    #[test]
    fn parse_rejects_bare_name() {
        assert!(matches!(
            SkillIdentifier::parse("my-skill"),
            Err(ParseError::InvalidFormat)
        ));
    }

    #[test]
    fn parse_rejects_empty() {
        assert!(matches!(
            SkillIdentifier::parse(""),
            Err(ParseError::Empty)
        ));
        assert!(matches!(
            SkillIdentifier::parse("  "),
            Err(ParseError::Empty)
        ));
    }

    #[test]
    fn parse_rejects_malformed_builder_key() {
        // Missing name segment
        assert!(matches!(
            SkillIdentifier::parse("skill-builder:default"),
            Err(ParseError::InvalidFormat)
        ));
        // Empty plugin
        assert!(matches!(
            SkillIdentifier::parse("skill-builder::name"),
            Err(ParseError::InvalidFormat)
        ));
    }

    #[test]
    fn resolve_by_id_finds_existing_skill() {
        let conn = create_test_db_for_tests();
        let id = upsert_skill_in_plugin(
            &conn,
            "test-skill",
            "skill-builder",
            "domain",
            "default",
        )
        .unwrap();

        let resolved = SkillIdentifier::ById(id).resolve_to_db_id(&conn).unwrap();
        assert_eq!(resolved, id);
    }

    #[test]
    fn resolve_by_id_rejects_deleted_skill() {
        let conn = create_test_db_for_tests();
        let id = upsert_skill_in_plugin(
            &conn,
            "deleted-skill",
            "skill-builder",
            "domain",
            "default",
        )
        .unwrap();
        // Soft-delete the skill
        conn.execute(
            "UPDATE skills SET deleted_at = datetime('now') WHERE id = ?1",
            rusqlite::params![id],
        )
        .unwrap();

        let result = SkillIdentifier::ById(id).resolve_to_db_id(&conn);
        assert!(result.is_err());
    }

    #[test]
    fn resolve_by_builder_key() {
        let conn = create_test_db_for_tests();
        let id = upsert_skill_in_plugin(
            &conn,
            "builder-skill",
            "skill-builder",
            "domain",
            "default",
        )
        .unwrap();

        let resolved = SkillIdentifier::ByBuilderKey {
            plugin: "default".to_string(),
            name: "builder-skill".to_string(),
        }
        .resolve_to_db_id(&conn)
        .unwrap();
        assert_eq!(resolved, id);
    }

    #[test]
    fn resolve_by_imported_id() {
        let conn = create_test_db_for_tests();
        let id = upsert_skill_in_plugin(
            &conn,
            "imported-skill",
            "marketplace",
            "domain",
            "default",
        )
        .unwrap();

        let resolved = SkillIdentifier::ByImportedId(id)
            .resolve_to_db_id(&conn)
            .unwrap();
        assert_eq!(resolved, id);
    }

    #[test]
    fn resolve_returns_error_for_nonexistent_id() {
        let conn = create_test_db_for_tests();
        let result = SkillIdentifier::ById(99999).resolve_to_db_id(&conn);
        assert!(result.is_err());
    }
}
```

- [ ] **Step 2: Export the module from `db/mod.rs`**

Add to `app/src-tauri/src/db/mod.rs` after the existing `pub mod` declarations:

```rust
pub mod skill_identifier;
```

Add to the `pub use` block:

```rust
pub use skill_identifier::*;
```

- [ ] **Step 3: Add thiserror dependency if not present**

Check `app/src-tauri/Cargo.toml` for `thiserror`. If not present, add:

```toml
thiserror = "1"
```

- [ ] **Step 4: Verify tests pass**

Run: `cd app/src-tauri && cargo test skill_identifier -- --nocapture`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/db/skill_identifier.rs app/src-tauri/src/db/mod.rs app/src-tauri/Cargo.toml
git commit -m "feat: add SkillIdentifier type with structured parsing and resolution

Introduces SkillIdentifier enum that parses integer IDs, skill-builder keys,
and imported IDs. Rejects bare skill names. Includes resolve_to_db_id() for
DB lookup."
```

---

### Task 2: Update `workflow_artifacts.rs` to use `SkillIdentifier`

**Files:**
- Modify: `app/src-tauri/src/db/workflow_artifacts.rs`

- [ ] **Step 1: Replace `resolve_skill_db_id` and `resolve_skill_db_id_optional`**

In `app/src-tauri/src/db/workflow_artifacts.rs`, replace the two helper functions (lines 163-189):

```rust
fn resolve_skill_db_id(conn: &Connection, skill_identifier: &str) -> Result<i64, rusqlite::Error> {
    crate::db::SkillIdentifier::parse(skill_identifier)
        .map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                e.to_string(),
            )))
        })
        .and_then(|id| {
            id.resolve_to_db_id(conn).map_err(|e| {
                rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    e,
                )))
            })
        })
}

fn resolve_skill_db_id_optional(
    conn: &Connection,
    skill_identifier: &str,
) -> Result<Option<i64>, rusqlite::Error> {
    match crate::db::SkillIdentifier::parse(skill_identifier) {
        Ok(id) => id.resolve_to_db_id(conn)
            .map(Some)
            .or_else(|e| {
                if e.contains("not found") {
                    Ok(None)
                } else {
                    Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
                        std::io::Error::new(std::io::ErrorKind::NotFound, e),
                    )))
                }
            }),
        Err(e) => Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
            std::io::Error::new(std::io::ErrorKind::InvalidInput, e.to_string()),
        ))),
    }
}
```

- [ ] **Step 2: Verify tests pass**

Run: `cd app/src-tauri && cargo test workflow_artifacts -- --nocapture`
Expected: All tests pass (existing tests use skill names like `"skill-a"` which will now fail — see Step 3)

- [ ] **Step 3: Update tests to use integer skill IDs**

The existing tests in `workflow_artifacts.rs` seed skills and pass skill names as identifiers. After this change, they must pass the integer `skills.id` instead.

In the test module, update `seed_skill` to return the skill ID, and update all test calls to pass the ID as a string:

```rust
fn seed_skill(conn: &Connection, name: &str) -> i64 {
    conn.execute(
        "INSERT INTO skills (name, skill_source, plugin_id)
         VALUES (?1, 'skill-builder', (SELECT id FROM plugins WHERE slug = ?2))",
        rusqlite::params![name, crate::skill_paths::DEFAULT_PLUGIN_SLUG],
    )
    .unwrap();
    crate::db::get_skill_master_id_in_plugin(conn, name, crate::skill_paths::DEFAULT_PLUGIN_SLUG)
        .unwrap()
        .unwrap()
}
```

Then update each test that calls `sample_record("skill-a")` or similar to use the skill ID:

```rust
// In roundtrip_clarifications_insert_and_read:
let skill_id = seed_skill(&conn, "skill-a");
let identifier = skill_id.to_string();
let record = sample_record(&identifier);
// ... rest of test uses `identifier` instead of "skill-a"
```

Update `sample_record` signature to accept `&str` (already does).

Update all tests in the module that pass skill names as identifiers:
- `roundtrip_clarifications_insert_and_read`
- `roundtrip_clarifications_accepts_builder_library_key_identifier`
- `delete_clarifications_cascades_to_children`
- `partial_verdict_update_preserves_answers`
- `recursive_refinement_insert_and_read`
- `decisions_roundtrip_and_delete`
- `update_question_answer_clears_and_sets_columns`
- `delete_skill_purges_artifact_rows`
- `deleting_skill_row_cascades_to_artifact_tables`

For builder key tests, keep using `"skill-builder:default:skill-name"` format.
For all others, use `skill_id.to_string()`.

- [ ] **Step 4: Run tests**

Run: `cd app/src-tauri && cargo test workflow_artifacts -- --nocapture`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/db/workflow_artifacts.rs
git commit -m "refactor: workflow_artifacts uses SkillIdentifier for skill resolution

Replace resolve_skill_db_id helpers with SkillIdentifier::parse() +
resolve_to_db_id(). Update tests to pass integer skill IDs instead of
bare skill names."
```

---

### Task 3: Remove `get_skill_master_id_any_plugin` and `set_skill_behaviour`

**Files:**
- Modify: `app/src-tauri/src/db/skills.rs`

- [ ] **Step 1: Remove `get_skill_master_id_any_plugin`**

Delete the function at lines 564-575:

```rust
// DELETE this function entirely:
pub fn get_skill_master_id_any_plugin(
    conn: &Connection,
    skill_name: &str,
) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT id FROM skills WHERE name = ?1 AND COALESCE(deleted_at, '') = '' LIMIT 1",
        rusqlite::params![skill_name],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Remove `set_skill_behaviour`**

Delete the function at lines 684-716 (the name-only variant). Keep `set_skill_behaviour_in_plugin`.

- [ ] **Step 3: Remove `resolve_skill_master_id_from_identifier`**

Delete the function at lines 601-654.

- [ ] **Step 4: Remove the test for `get_skill_master_id_any_plugin`**

Delete the test `get_skill_master_id_any_plugin_finds_imported_skill` (lines 986-1014).

- [ ] **Step 5: Update `set_skill_behaviour_in_plugin` test**

The test at line 1138 calls both `set_skill_behaviour` and `set_skill_behaviour_in_plugin`. Replace the `set_skill_behaviour` call with `set_skill_behaviour_in_plugin`:

```rust
// Change this:
set_skill_behaviour(
    &conn,
    "my-skill",
    Some("default description"),
    None,
    None,
    None,
)
.unwrap();

// To this:
set_skill_behaviour_in_plugin(
    &conn,
    "my-skill",
    crate::skill_paths::DEFAULT_PLUGIN_SLUG,
    Some("default description"),
    None,
    None,
    None,
)
.unwrap();
```

- [ ] **Step 6: Verify compilation**

Run: `cd app/src-tauri && cargo check`
Expected: Compilation errors for removed functions — these will be fixed in subsequent tasks.

- [ ] **Step 7: Commit**

```bash
git add app/src-tauri/src/db/skills.rs
git commit -m "refactor: remove name-based skill resolution functions

Remove get_skill_master_id_any_plugin, set_skill_behaviour (name-only),
and resolve_skill_master_id_from_identifier. Callers must use plugin-scoped
variants or SkillIdentifier."
```

---

### Task 4: Update `locks.rs` — remove dead code

**Files:**
- Modify: `app/src-tauri/src/db/locks.rs`

- [ ] **Step 1: Remove name-based lock functions**

Delete these functions:
- `acquire_skill_lock` (lines 66-75)
- `release_skill_lock` (lines 91-100)
- `get_skill_lock` (lines 139-147)

Remove the import of `get_skill_master_id_any_plugin` from line 3:

```rust
// Change:
use super::skills::{get_skill_master_by_id, get_skill_master_id_any_plugin};
// To:
use super::skills::get_skill_master_by_id;
```

- [ ] **Step 2: Update tests**

Replace all test calls to `acquire_skill_lock`, `release_skill_lock`, `get_skill_lock` with their `_by_skill_id` variants.

First, update `insert_skill` helper to return the skill ID:

```rust
fn insert_skill(conn: &rusqlite::Connection, name: &str) -> i64 {
    super::super::skills::upsert_skill(conn, name, "skill-builder", "test").unwrap();
    crate::db::get_skill_master_id_in_plugin(conn, name, crate::skill_paths::DEFAULT_PLUGIN_SLUG)
        .unwrap()
        .unwrap()
}
```

Then update each test:

```rust
// test_acquire_skill_lock_succeeds_for_unlocked_skill:
let skill_id = insert_skill(&conn, "my-skill");
let result = acquire_skill_lock_by_skill_id(&conn, skill_id, "instance-1", std::process::id());
// Replace get_skill_lock with get_skill_lock_by_skill_id:
let lock = get_skill_lock_by_skill_id(&conn, skill_id).unwrap();
```

Apply the same pattern to:
- `test_acquire_skill_lock_idempotent_for_same_instance`
- `test_acquire_skill_lock_fails_when_held_by_live_process`
- `test_acquire_skill_lock_reclaims_dead_pid_lock`
- `test_release_skill_lock_removes_lock_and_allows_reacquire`
- `test_release_skill_lock_is_noop_for_wrong_instance`
- `test_reclaim_dead_locks_removes_dead_and_keeps_live` — update `get_skill_lock` calls
- `test_acquire_skill_lock_fails_for_unknown_skill` — use a non-existent skill_id

- [ ] **Step 3: Run tests**

Run: `cd app/src-tauri && cargo test locks -- --nocapture`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/db/locks.rs
git commit -m "refactor: locks.rs uses only skill_id-based functions

Remove dead name-based lock functions (acquire_skill_lock, release_skill_lock,
get_skill_lock). Migrate all tests to _by_skill_id variants."
```

---

### Task 5: Update `workflow.rs` — remove name-based wrappers

**Files:**
- Modify: `app/src-tauri/src/db/workflow.rs`

- [ ] **Step 1: Remove import of `get_skill_master_id_any_plugin`**

```rust
// Change:
use super::skills::{
    delete_skill_in_plugin, get_skill_master_by_id, get_skill_master_id_any_plugin,
    get_skill_master_id_in_plugin,
};
// To:
use super::skills::{
    delete_skill_in_plugin, get_skill_master_by_id, get_skill_master_id_in_plugin,
};
```

- [ ] **Step 2: Remove `get_workflow_run_id`**

Delete the function at lines 27-32.

- [ ] **Step 3: Remove `get_workflow_run`**

Delete the function at lines 149-157.

- [ ] **Step 4: Remove `get_purpose`**

Delete the function at lines 167-172.

- [ ] **Step 5: Remove `save_workflow_step`**

Delete the function at lines 306-315.

- [ ] **Step 6: Remove `get_workflow_steps`**

Delete the function at lines 347-355.

- [ ] **Step 7: Remove `reset_workflow_steps_from`**

Delete the function at lines 375-384.

- [ ] **Step 8: Remove `create_workflow_session`**

Delete the function at lines 405-414.

- [ ] **Step 9: Update `delete_workflow_run`**

The function at line 210 calls `get_workflow_run_id`. Replace with `get_workflow_run_id_by_skill_id`:

```rust
// Change:
let wr_id = get_workflow_run_id(conn, skill_name)?
// To:
let wr_id = get_workflow_run_id_by_skill_id(conn, s_id)?
```

- [ ] **Step 10: Update `has_active_session_with_live_pid`**

This function at line 466 uses `get_skill_master_id_any_plugin`. It's used by startup reconciliation and receives a `skill_name`. Since this is internal reconciliation code that already has the skill name from iterating sessions, it should continue to work with the skill_id from the session row. The function already queries by `skill_id` in the session table — the `get_skill_master_id_any_plugin` call is just a validation step. Remove it and return `false` if the skill doesn't exist:

```rust
pub fn has_active_session_with_live_pid(conn: &Connection, skill_name: &str) -> bool {
    // Look up skill_id by name in the default plugin (reconciliation context)
    let s_id = match crate::db::get_skill_master_id_in_plugin(
        conn,
        skill_name,
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
    ) {
        Ok(Some(id)) => id,
        _ => return false,
    };

    let mut stmt = match conn
        .prepare("SELECT pid FROM workflow_sessions WHERE skill_id = ?1 AND ended_at IS NULL")
    {
        Ok(s) => s,
        Err(_) => return false,
    };

    let pids: Vec<u32> = match stmt.query_map(rusqlite::params![s_id], |row| {
        Ok(row.get::<_, i64>(0)? as u32)
    }) {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(_) => return false,
    };

    pids.iter().any(|&pid| check_pid_alive(pid))
}
```

- [ ] **Step 11: Verify compilation**

Run: `cd app/src-tauri && cargo check`
Expected: Fewer errors — remaining ones are in callers of removed functions

- [ ] **Step 12: Commit**

```bash
git add app/src-tauri/src/db/workflow.rs
git commit -m "refactor: workflow.rs removes name-based wrapper functions

Remove get_workflow_run_id, get_workflow_run, get_purpose, save_workflow_step,
get_workflow_steps, reset_workflow_steps_from, create_workflow_session.
Callers use _by_skill_id variants."
```

---

### Task 6: Update Tauri commands — skill metadata

**Files:**
- Modify: `app/src-tauri/src/commands/skill/metadata.rs`
- Modify: `app/src-tauri/src/commands/settings.rs`

- [ ] **Step 1: Update `update_skill_metadata` in `commands/skill/metadata.rs`**

Replace `set_skill_behaviour` call (line 139) with `set_skill_behaviour_in_plugin`:

```rust
// Change:
crate::db::set_skill_behaviour(
    &conn,
    &skill_name,
    description.as_deref(),
    version.as_deref(),
    user_invocable,
    disable_model_invocation,
)

// To:
crate::db::set_skill_behaviour_in_plugin(
    &conn,
    &skill_name,
    &plugin_slug,
    description.as_deref(),
    version.as_deref(),
    user_invocable,
    disable_model_invocation,
)
```

- [ ] **Step 2: Update `backfill_imported_skill_versions` in `commands/settings.rs`**

Replace `set_skill_behaviour` call (line 207) with `set_skill_behaviour_in_plugin`:

```rust
// Change:
crate::db::set_skill_behaviour(
    conn,
    &skill_name,
    None,
    Some(&normalized.version),
    None,
    None,
)?;

// To:
crate::db::set_skill_behaviour_in_plugin(
    conn,
    &skill_name,
    &skill.plugin_slug,
    None,
    Some(&normalized.version),
    None,
    None,
)?;
```

- [ ] **Step 3: Update `create_skill_db_records_inner` in `commands/skill/crud.rs`**

Replace `get_skill_master_id_any_plugin` call (line 257) with `get_skill_master_id_in_plugin`:

```rust
// Change:
crate::db::get_skill_master_id_any_plugin(&conn, &name)?
    .ok_or_else(|| format!("Failed to find created skill '{}'", name))?

// To:
crate::db::get_skill_master_id_in_plugin(&conn, &name, crate::skill_paths::DEFAULT_PLUGIN_SLUG)?
    .ok_or_else(|| format!("Failed to find created skill '{}'", name))?
```

- [ ] **Step 4: Verify compilation**

Run: `cd app/src-tauri && cargo check`
Expected: Fewer errors

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/commands/skill/metadata.rs app/src-tauri/src/commands/settings.rs app/src-tauri/src/commands/skill/crud.rs
git commit -m "refactor: Tauri commands use plugin-scoped skill resolution

Replace set_skill_behaviour with set_skill_behaviour_in_plugin in
update_skill_metadata and backfill_imported_skill_versions. Replace
get_skill_master_id_any_plugin with get_skill_master_id_in_plugin."
```

---

### Task 7: Update remaining callers

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/settings.rs`
- Modify: `app/src-tauri/src/commands/workflow_lifecycle.rs`
- Modify: `app/src-tauri/src/db/imported_skills.rs`
- Modify: `app/src-tauri/src/commands/refine/mod.rs`

- [ ] **Step 1: Update `read_workflow_settings` in `commands/workflow/settings.rs`**

The function at line 165 uses `get_skill_master_id_any_plugin`. The caller `load_refine_prompt_context` in `refine/mod.rs` has `skill_name` but not `skill_id`. Since `read_workflow_settings` is an internal function (not a Tauri command), add a `plugin_slug` parameter:

```rust
pub(crate) fn read_workflow_settings(
    db: &Db,
    skill_name: &str,
    plugin_slug: &str,
    step_id: u32,
    workspace_path: &str,
) -> Result<WorkflowSettings, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let skill_id = crate::db::get_skill_master_id_in_plugin(&conn, skill_name, plugin_slug)?
        .ok_or_else(|| format!("Skill '{}' not found in plugin '{}'", skill_name, plugin_slug))?;
    drop(conn);
    read_workflow_settings_by_skill_id(db, skill_id, skill_name, step_id, workspace_path)
}
```

- [ ] **Step 2: Update `load_refine_prompt_context` in `commands/refine/mod.rs`**

Add `plugin_slug` parameter:

```rust
fn load_refine_prompt_context(
    db: &Db,
    skill_name: &str,
    plugin_slug: &str,
    workspace_path: &str,
) -> Result<(String, String, String), String> {
    let settings = crate::commands::workflow::settings::read_workflow_settings(
        db,
        skill_name,
        plugin_slug,
        0,
        workspace_path,
    )?;
    // ... rest unchanged
}
```

Update the call site at line 353:

```rust
// Change:
load_refine_prompt_context(&db, &skill_name, &runtime_ctx.workspace_path)?;
// To:
load_refine_prompt_context(&db, &skill_name, &plugin_slug, &runtime_ctx.workspace_path)?;
```

- [ ] **Step 3: Update `start_session` in `commands/workflow_lifecycle.rs`**

This function at line 17 has `#[allow(dead_code)]` and uses `get_skill_master_id_any_plugin` with a fallback to `upsert_skill`. Add `plugin_slug` parameter:

```rust
#[allow(dead_code)]
pub fn start_session(
    conn: &Connection,
    session_id: &str,
    skill_name: &str,
    plugin_slug: &str,
    pid: u32,
) -> Result<(), String> {
    if session_id.trim().is_empty() {
        return Err("Session ID is required".to_string());
    }
    if skill_name.trim().is_empty() {
        return Err("Skill name is required".to_string());
    }
    if pid == 0 {
        return Err("PID must be greater than zero".to_string());
    }
    let skill_id = match crate::db::get_skill_master_id_in_plugin(conn, skill_name, plugin_slug)? {
        Some(skill_id) => skill_id,
        None => crate::db::upsert_skill_in_plugin(conn, skill_name, "skill-builder", "domain", plugin_slug)?,
    };
    start_session_by_skill_id(conn, session_id, skill_id, pid)
}
```

Update the test at line 97:

```rust
// Change:
let result = start_session(&conn, "session-start", "my-skill", 1234);
// To:
let result = start_session(&conn, "session-start", "my-skill", "default", 1234);
```

- [ ] **Step 4: Update `get_imported_skill_disk_path` in `db/imported_skills.rs`**

This function at line 403 uses `get_skill_master_id_any_plugin`. Add `plugin_slug` parameter:

```rust
/// Return the `disk_path` for an imported skill. Returns `None` if the skill
/// has no `imported_skills` row (i.e. it is a builder skill).
#[allow(dead_code)]
pub fn get_imported_skill_disk_path(
    conn: &Connection,
    skill_name: &str,
    plugin_slug: &str,
) -> Result<Option<String>, String> {
    let s_id = match crate::db::get_skill_master_id_in_plugin(conn, skill_name, plugin_slug)? {
        Some(id) => id,
        None => return Ok(None),
    };
    conn.query_row(
        "SELECT disk_path FROM imported_skills WHERE skill_master_id = ?1",
        rusqlite::params![s_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}
```

- [ ] **Step 5: Verify compilation**

Run: `cd app/src-tauri && cargo check`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/commands/workflow/settings.rs app/src-tauri/src/commands/workflow_lifecycle.rs app/src-tauri/src/db/imported_skills.rs app/src-tauri/src/commands/refine/mod.rs
git commit -m "refactor: remaining callers use plugin-scoped skill resolution

Add plugin_slug parameter to read_workflow_settings, load_refine_prompt_context,
start_session, and get_imported_skill_disk_path."
```

---

### Task 8: Update `db/tests.rs` and run full test suite

**Files:**
- Modify: `app/src-tauri/src/db/tests.rs`

- [ ] **Step 1: Update `test_save_workflow_state_preserves_skills_metadata`**

Replace `set_skill_behaviour` call (line 4361) with `set_skill_behaviour_in_plugin`:

```rust
// Change:
set_skill_behaviour(
    &conn,
    "meta-skill",
    Some("Canonical description"),
    Some("2.0.0"),
    Some(true),
    Some(false),
)
.unwrap();

// To:
set_skill_behaviour_in_plugin(
    &conn,
    "meta-skill",
    crate::skill_paths::DEFAULT_PLUGIN_SLUG,
    Some("Canonical description"),
    Some("2.0.0"),
    Some(true),
    Some(false),
)
.unwrap();
```

- [ ] **Step 2: Search for any remaining references to removed functions**

Run: `cd app/src-tauri && grep -rn "get_skill_master_id_any_plugin\|set_skill_behaviour\b\|resolve_skill_master_id_from_identifier" src/`
Expected: No matches (except in comments or this plan file)

- [ ] **Step 3: Run full test suite**

Run: `cd app/src-tauri && cargo test`
Expected: All tests pass

- [ ] **Step 4: Run clippy**

Run: `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`
Expected: No warnings

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/db/tests.rs
git commit -m "test: update db/tests.rs to use plugin-scoped skill functions

Replace set_skill_behaviour with set_skill_behaviour_in_plugin in
test_save_workflow_state_preserves_skills_metadata."
```

---

### Task 9: Add migration 56 slot

**Files:**
- Modify: `app/src-tauri/src/db/migrations.rs`

- [ ] **Step 1: Add migration 56 to NUMBERED_MIGRATIONS**

Add to the `NUMBERED_MIGRATIONS` array (after migration 55):

```rust
(56, run_canonical_skill_identity_migration),
```

- [ ] **Step 2: Add the migration function**

Add after `run_model_catalog_cache_migration`:

```rust
/// Migration 56: Canonical skill identity — code-only cleanup.
///
/// This migration slot records the removal of name-based skill resolution.
/// No schema changes — the artifact tables were already rebuilt on integer
/// skill_id FKs in migration 51. This migration exists so the migration
/// counter advances and the code change is tracked in schema_migrations.
pub(super) fn run_canonical_skill_identity_migration(
    _conn: &Connection,
) -> Result<(), rusqlite::Error> {
    log::info!("migration 56: canonical skill identity (code-only, no schema changes)");
    Ok(())
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd app/src-tauri && cargo check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/db/migrations.rs
git commit -m "feat: add migration 54 slot for canonical skill identity

Code-only migration tracking the removal of name-based skill resolution.
No schema changes — artifact tables already use integer FKs since migration 51."
```

---

### Task 10: Final verification

- [ ] **Step 1: Run full test suite**

Run: `cd app/src-tauri && cargo test`
Expected: All tests pass

- [ ] **Step 2: Run clippy**

Run: `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`
Expected: No warnings

- [ ] **Step 3: Run frontend type check**

Run: `cd app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Verify no remaining name-based resolution**

Run: `cd app/src-tauri && grep -rn "get_skill_master_id_any_plugin\|resolve_skill_master_id_from_identifier" src/`
Expected: No matches

Run: `cd app/src-tauri && grep -rn "set_skill_behaviour\b" src/ | grep -v "set_skill_behaviour_in_plugin"`
Expected: No matches

- [ ] **Step 5: Final commit if any lint fixes needed**

```bash
git add -A
git commit -m "chore: final lint fixes for canonical skill identity"
```

# VU-1166 Path Normalization And Startup Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize Skill Builder onto the canonical `{plugin_slug}/skills/{skill_name}` contract with `default` as the only default plugin slug, migrate existing DB and filesystem state on upgraded laptops, and fold app-local startup cleanup into the same startup normalization flow.

**Architecture:** Introduce a single startup normalization pipeline that runs before reconciliation-dependent features rely on plugin ownership or path resolution. The pipeline has three layers: DB normalization, filesystem migration for both `workspace_path` and `skills_path`, and conservative startup cleanup for stale app-local state. Production call sites then stop inferring the default plugin slug as `skills` and instead either use `pluginPaths.default_plugin_slug` or accept an explicit `pluginSlug` parameter.

**Tech Stack:** Rust / Tauri / SQLite / React / Vitest / cargo tests / startup reconciliation.

**Related Issues:** `VU-1166` primary scope, with `VU-1164` startup cleanup requirements intentionally folded into this execution plan because the cleanup is part of the same startup normalization path.

---

## Scope Review

- The issue scope and acceptance criteria should explicitly cover both roots:
  - `workspace_path/{plugin_slug}/skills/{skill_name}`
  - `skills_path/{plugin_slug}/skills/{skill_name}`
- The issue scope should explicitly state that `default` is the only valid default plugin slug in production code.
- The issue scope should explicitly cover existing-install migration for:
  - DB plugin rows
  - duplicated skill ownership across `skills` and `default`
  - legacy workspace folders
  - legacy skills output folders
  - stale app-local startup artifacts covered by `VU-1164`

That review has already been incorporated into the current `VU-1166` description.

## File Structure

| File | Responsibility |
|---|---|
| `app/plugin-paths.json` | Single source of truth for canonical path templates and frontend default slug |
| `app/src-tauri/src/skill_paths.rs` | Canonical Rust path resolution and legacy candidate helpers |
| `app/src-tauri/src/db/migrations.rs` | One-time DB repair for legacy default-plugin rows |
| `app/src-tauri/src/db/skills.rs` | Default-plugin helpers and plugin ownership queries |
| `app/src-tauri/src/reconciliation/mod.rs` | Startup normalization orchestration before regular reconciliation |
| `app/src-tauri/src/reconciliation/tests.rs` | Legacy-install migration and mixed-state regression tests |
| `app/src-tauri/src/commands/files.rs` | Skill file listing for completed-step UI; must become plugin-aware |
| `app/src/components/step-complete/use-step-files.ts` | Frontend file loading path; must pass explicit plugin slug |
| `app/src/components/reconciliation-ack-dialog.tsx` | Remove legacy `skills` fallback in discovery keys/logging |
| `app/src-tauri/src/commands/documents/mod.rs` | Stop treating `skills` as the default plugin in SQL ordering |
| `app/src/__tests__/components/workflow-step-complete*.test.tsx` | Completed-step file loading regressions |
| `app/src/__tests__/components/app-layout.test.tsx` | Startup reconciliation / silent cleanup behavior |
| `docs/design/openhands-agent-server-runtime/README.md` and stale comments | Align docs/comments to canonical path contract after code lands |

---

### Task 1: Lock The Canonical Contract With Characterization Tests

**Files:**

- Modify: `app/src-tauri/src/reconciliation/tests.rs`
- Modify: `app/src/__tests__/components/workflow-step-complete.test.tsx`
- Modify: `app/src/__tests__/components/app-layout.test.tsx`
- Modify: `app/src-tauri/src/commands/documents/mod.rs` or add local tests near it

- [ ] **Step 1: Add a failing Rust test for dual-default plugin rows plus duplicate skill ownership**

```rust
#[test]
fn startup_normalization_merges_legacy_skills_default_into_default_plugin() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_root = tempfile::tempdir().unwrap();
    let conn = create_test_db();

    // Seed both legacy synthetic defaults.
    crate::db::ensure_plugin(&conn, "skills", "skills", "synthetic", None, None, true).unwrap();
    crate::db::ensure_plugin(&conn, "default", "Default", "synthetic", None, None, true).unwrap();

    // Same skill exists under both plugin rows.
    crate::db::upsert_skill_in_plugin(&conn, "measuring-pipeline-value", "skill-builder", "domain", "skills").unwrap();
    crate::db::upsert_skill_in_plugin(&conn, "measuring-pipeline-value", "skill-builder", "domain", "default").unwrap();

    let result = reconcile_on_startup(
        &conn,
        tmp.path().to_str().unwrap(),
        skills_root.path().to_str().unwrap(),
    ).unwrap();

    let plugins = crate::db::list_plugins(&conn).unwrap();
    assert_eq!(plugins.iter().filter(|p| p.is_default).count(), 1);
    assert_eq!(plugins.iter().find(|p| p.is_default).unwrap().slug, "default");

    let skill_rows = crate::db::list_all_skills(&conn).unwrap()
        .into_iter()
        .filter(|s| s.name == "measuring-pipeline-value")
        .collect::<Vec<_>>();
    assert_eq!(skill_rows.len(), 1);
    assert_eq!(skill_rows[0].plugin_slug, "default");
    assert!(result.notifications.iter().any(|n| n.contains("normalized")));
}
```

- [ ] **Step 2: Add a failing Rust test for legacy folder migration in both roots**

```rust
#[test]
fn startup_normalization_moves_legacy_skills_and_workspace_dirs_to_default_plugin() {
    let workspace_root = tempfile::tempdir().unwrap();
    let skills_root = tempfile::tempdir().unwrap();
    let conn = create_test_db();

    crate::db::save_workflow_run(&conn, "analyzing-bookings", 3, "completed", "domain").unwrap();

    let legacy_workspace = workspace_root.path().join("skills").join("skills").join("analyzing-bookings");
    let legacy_output = skills_root.path().join("skills").join("skills").join("analyzing-bookings");
    std::fs::create_dir_all(&legacy_workspace).unwrap();
    std::fs::create_dir_all(legacy_output.join("references")).unwrap();
    std::fs::write(legacy_output.join("SKILL.md"), "# migrated").unwrap();

    reconcile_on_startup(
        &conn,
        workspace_root.path().to_str().unwrap(),
        skills_root.path().to_str().unwrap(),
    ).unwrap();

    assert!(workspace_root.path().join("default").join("skills").join("analyzing-bookings").exists());
    assert!(skills_root.path().join("default").join("skills").join("analyzing-bookings").join("SKILL.md").exists());
    assert!(!legacy_workspace.exists());
    assert!(!legacy_output.exists());
}
```

- [ ] **Step 3: Add a failing frontend test for step-complete file viewing with explicit plugin slug**

```tsx
it("reads completed step files from the skill's actual plugin slug", async () => {
  vi.mocked(listSkillFiles).mockResolvedValue([
    {
      name: "SKILL.md",
      relative_path: "SKILL.md",
      absolute_path: "/skills/skills/skills/measuring-pipeline-value/SKILL.md",
      is_directory: false,
      is_readonly: false,
      size_bytes: 12,
    },
  ]);

  render(
    <WorkflowStepComplete
      stepName="Generate Skill"
      stepId={3}
      outputFiles={["skill/SKILL.md"]}
      skillName="measuring-pipeline-value"
      pluginSlug="skills"
      skillsPath="/skills"
    />,
  );

  await waitFor(() => {
    expect(listSkillFiles).toHaveBeenCalledWith("/skills", "measuring-pipeline-value", "skills");
  });
});
```

- [ ] **Step 4: Add a failing startup test for silent cleanup of migrated legacy app-local state**

```tsx
it("auto-applies startup normalization cleanup without opening reconciliation UI", async () => {
  mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "get_settings") return Promise.resolve(defaultSettings);
    if (cmd === "reconcile_startup" && args?.apply === true) {
      return Promise.resolve({
        orphans: [],
        notifications: ["normalized legacy default plugin state"],
        auto_cleaned: 2,
        discovered_skills: [],
      });
    }
    if (cmd === "reconcile_startup") {
      return Promise.resolve({
        orphans: [],
        notifications: ["normalized legacy default plugin state"],
        auto_cleaned: 0,
        discovered_skills: [],
      });
    }
    throw new Error(`unexpected ${cmd}`);
  });

  render(<AppLayout />);

  await waitFor(() => {
    expect(mockInvoke).toHaveBeenCalledWith("reconcile_startup", { apply: true });
  });
});
```

- [ ] **Step 5: Run the targeted red tests and verify they fail for the expected reason**

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml reconciliation::tests::startup_normalization_ -- --nocapture
cd app && npx vitest run src/__tests__/components/workflow-step-complete.test.tsx src/__tests__/components/app-layout.test.tsx
```

Expected:

- Rust tests fail because dual-default and legacy folders are not normalized today
- Frontend tests fail because `listSkillFiles` does not accept or use explicit plugin slug today

- [ ] **Step 6: Commit the red tests**

```bash
git add app/src-tauri/src/reconciliation/tests.rs app/src/__tests__/components/workflow-step-complete.test.tsx app/src/__tests__/components/app-layout.test.tsx
git commit -m "test: capture legacy plugin path normalization regressions"
```

---

### Task 2: Normalize Legacy Default Plugin Rows In SQLite

**Files:**

- Modify: `app/src-tauri/src/db/migrations.rs`
- Modify: `app/src-tauri/src/db/skills.rs`
- Modify: `app/src-tauri/src/db/tests.rs`

- [ ] **Step 1: Add a failing DB repair test for mixed `skills` + `default` synthetic plugins**

```rust
#[test]
fn repair_plugin_ownership_schema_collapses_legacy_skills_default() {
    let conn = create_test_db();

    conn.execute(
        "INSERT INTO plugins (slug, display_name, source_type, is_default) VALUES ('skills', 'skills', 'synthetic', 1)",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO plugins (slug, display_name, source_type, is_default) VALUES ('default', 'Default', 'synthetic', 1)",
        [],
    ).unwrap();

    repair_plugin_ownership_schema(&conn).unwrap();

    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM plugins WHERE is_default = 1",
        [],
        |r| r.get(0),
    ).unwrap();
    assert_eq!(count, 1);
    let slug: String = conn.query_row(
        "SELECT slug FROM plugins WHERE is_default = 1",
        [],
        |r| r.get(0),
    ).unwrap();
    assert_eq!(slug, "default");
}
```

- [ ] **Step 2: Implement minimal DB normalization helpers**

```rust
pub fn ensure_default_plugin(conn: &Connection) -> Result<i64, String> {
    normalize_legacy_default_plugins(conn)?;
    ensure_plugin(
        conn,
        DEFAULT_PLUGIN_SLUG,
        DEFAULT_PLUGIN_DISPLAY_NAME,
        "synthetic",
        None,
        None,
        true,
    )
}

fn normalize_legacy_default_plugins(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        INSERT INTO plugins (slug, display_name, version, source_type, source_url, is_default)
        SELECT 'default', 'Default', NULL, 'synthetic', NULL, 1
        WHERE NOT EXISTS (SELECT 1 FROM plugins WHERE slug = 'default');

        UPDATE plugins
           SET is_default = CASE WHEN slug = 'default' THEN 1 ELSE 0 END
         WHERE source_type = 'synthetic' AND slug IN ('default', 'skills', 'no-plugin');
        ",
    ).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Extend migration repair to repoint legacy synthetic default ownership**

```rust
// In repair_plugin_ownership_schema / helper it calls:
normalize_legacy_default_plugins(conn)?;
repoint_legacy_skills_default_rows(conn)?;
```

```rust
fn repoint_legacy_skills_default_rows(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        UPDATE skills
           SET plugin_id = (SELECT id FROM plugins WHERE slug = 'default')
         WHERE plugin_id = (SELECT id FROM plugins WHERE slug = 'skills')
           AND NOT EXISTS (
             SELECT 1
               FROM skills s2
              WHERE s2.name = skills.name
                AND s2.plugin_id = (SELECT id FROM plugins WHERE slug = 'default')
           );
        ",
    )
}
```

- [ ] **Step 4: Re-run the targeted DB tests and verify they pass**

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml repair_plugin_ownership_schema
cargo test --manifest-path app/src-tauri/Cargo.toml ensure_default_plugin
```

Expected: all targeted DB normalization tests pass.

- [ ] **Step 5: Commit the DB normalization slice**

```bash
git add app/src-tauri/src/db/migrations.rs app/src-tauri/src/db/skills.rs app/src-tauri/src/db/tests.rs
git commit -m "fix: normalize legacy default plugin rows"
```

---

### Task 3: Migrate Legacy Workspace And Skills Folders To Canonical Layout

**Files:**

- Modify: `app/src-tauri/src/reconciliation/mod.rs`
- Modify: `app/src-tauri/src/reconciliation/tests.rs`
- Modify: `app/src-tauri/src/skill_paths.rs` if helper extraction is needed

- [ ] **Step 1: Add failing reconciliation tests for each legacy folder shape**

Add coverage for:

- `root/skills/{skill}` -> `root/default/skills/{skill}`
- `root/skills/skills/{skill}` -> `root/default/skills/{skill}`
- `root/default/{skill}` -> `root/default/skills/{skill}`
- `root/{plugin}/{skill}` -> `root/{plugin}/skills/{skill}`
- duplicate source + destination with missing files in destination

- [ ] **Step 2: Implement a normalization pass that runs before normal reconciliation**

```rust
fn normalize_skill_roots_before_reconcile(
    conn: &rusqlite::Connection,
    workspace_root: &Path,
    skills_root: &Path,
    notifications: &mut Vec<String>,
) -> Result<usize, String> {
    let mut cleaned = 0usize;
    cleaned += normalize_root(conn, workspace_root, RootKind::Workspace, notifications)?;
    cleaned += normalize_root(conn, skills_root, RootKind::Skills, notifications)?;
    Ok(cleaned)
}
```

```rust
enum LegacyLocation {
    FlatDefault,
    LegacyPlugin,
    LegacySkillsDefault,
    LegacyCanonicalWrongDefault,
}
```

- [ ] **Step 3: Implement conservative move semantics**

Rules:

- If canonical destination does not exist: rename source into canonical destination.
- If canonical destination exists and source only adds missing files: move missing files, then remove source if empty.
- If canonical destination exists and conflicting files differ: move the legacy source into an app-local migration backup area and emit a notification.
- Never overwrite an existing canonical file silently.

```rust
fn merge_or_archive_legacy_source(
    source: &Path,
    destination: &Path,
    backup_root: &Path,
) -> Result<MergeOutcome, String> { /* ... */ }
```

- [ ] **Step 4: Run the reconciliation migration tests**

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml reconciliation::tests::startup_normalization_
```

Expected: legacy folder layouts are rewritten to canonical destinations without data loss.

- [ ] **Step 5: Commit the filesystem migration slice**

```bash
git add app/src-tauri/src/reconciliation/mod.rs app/src-tauri/src/reconciliation/tests.rs app/src-tauri/src/skill_paths.rs
git commit -m "fix: migrate legacy skill folders to canonical plugin paths"
```

---

### Task 4: Remove Production `skills` Default-Slug Assumptions And Make File Viewing Explicitly Plugin-Aware

**Files:**

- Modify: `app/src-tauri/src/commands/files.rs`
- Modify: `app/src/lib/tauri.ts`
- Modify: `app/src/components/step-complete/use-step-files.ts`
- Modify: `app/src/components/step-complete/index.tsx` and/or related props flow
- Modify: `app/src/components/reconciliation-ack-dialog.tsx`
- Modify: `app/src-tauri/src/commands/documents/mod.rs`
- Modify: `app/src/__tests__/components/workflow-step-complete*.test.tsx`
- Modify: `app/src/__tests__/components/reconciliation-ack-dialog.test.tsx`

- [ ] **Step 1: Add a failing API-contract test for `listSkillFiles` taking `pluginSlug`**

```ts
it("passes pluginSlug through listSkillFiles", async () => {
  await listSkillFiles("/skills", "measuring-pipeline-value", "skills")
  expect(mockInvoke).toHaveBeenCalledWith("list_skill_files", {
    workspacePath: "/skills",
    skillName: "measuring-pipeline-value",
    pluginSlug: "skills",
  })
})
```

- [ ] **Step 2: Update the Tauri command and UI plumbing**

```rust
#[tauri::command]
pub fn list_skill_files(
    workspace_path: String,
    skill_name: String,
    plugin_slug: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<Vec<SkillFileEntry>, String> {
    let plugin_slug = plugin_slug.unwrap_or_else(|| {
        let conn = db.0.lock().unwrap();
        crate::db::get_skill_master_any_plugin(&conn, &skill_name)
            .ok()
            .flatten()
            .map(|skill| skill.plugin_slug)
            .unwrap_or_else(|| DEFAULT_PLUGIN_SLUG.to_string())
    });
    list_skill_files_with_plugin_roots(&workspace_path, &skill_name, &plugin_slug, &allowed_roots)
}
```

```ts
export const listSkillFiles = (
  workspacePath: string,
  skillName: string,
  pluginSlug?: string,
) => invokeCommand("list_skill_files", {
  workspacePath,
  skillName,
  pluginSlug: pluginSlug ?? null,
})
```

- [ ] **Step 3: Replace production `?? "skills"` fallbacks**

Examples to update:

- `reconciliation-ack-dialog.tsx`
- document skill ordering/default detection SQL
- any production fallback or ordering logic still checking `p.slug = 'skills'`

```sql
SELECT s.id, s.name, p.slug, p.display_name, p.is_default
FROM skills s
JOIN plugins p ON s.plugin_id = p.id
ORDER BY (p.is_default = 0), p.slug, s.name;
```

- [ ] **Step 4: Run targeted frontend and Rust tests**

```bash
cd app && npx vitest run src/__tests__/components/workflow-step-complete.test.tsx src/__tests__/components/reconciliation-ack-dialog.test.tsx
cargo test --manifest-path app/src-tauri/Cargo.toml commands::documents
cargo test --manifest-path app/src-tauri/Cargo.toml commands::files
```

Expected: file viewing and document/default-plugin behavior use explicit canonical plugin ownership.

- [ ] **Step 5: Commit the production call-site cleanup**

```bash
git add app/src-tauri/src/commands/files.rs app/src/lib/tauri.ts app/src/components/step-complete/use-step-files.ts app/src/components/reconciliation-ack-dialog.tsx app/src-tauri/src/commands/documents/mod.rs
git commit -m "fix: remove legacy skills default slug assumptions"
```

---

### Task 5: Fold In VU-1164 Startup Cleanup As Part Of Normalization

**Files:**

- Modify: `app/src-tauri/src/reconciliation/mod.rs`
- Modify: `app/src-tauri/src/reconciliation/tests.rs`
- Modify: `app/src/__tests__/components/app-layout.test.tsx`

- [ ] **Step 1: Add failing cleanup tests for stale app-local artifacts**

Cover at least:

- empty legacy plugin directories left behind after path migration
- orphaned app-local migration backup directories older than retention threshold
- OpenHands conversation folders missing `meta.json` and older than a grace period

```rust
#[test]
fn startup_cleanup_prunes_stale_orphaned_conversation_dirs_without_touching_live_ones() {
    // create one old dir with no meta.json, one fresh dir, one valid dir with meta.json
    // assert only the old orphaned dir is removed
}
```

- [ ] **Step 2: Implement conservative cleanup helpers**

```rust
fn cleanup_app_local_state(data_dir: &Path, notifications: &mut Vec<String>) -> Result<usize, String> {
    let mut cleaned = 0;
    cleaned += cleanup_empty_legacy_plugin_dirs(data_dir)?;
    cleaned += cleanup_stale_migration_backups(data_dir)?;
    cleaned += cleanup_orphaned_conversation_dirs(data_dir)?;
    Ok(cleaned)
}
```

Rules:

- only delete stale transient or empty legacy directories
- never delete canonical `SKILL.md`, references, or active workspace skill dirs
- keep cleanup silent when it is notification-only and user-action-free

- [ ] **Step 3: Verify startup UI behavior still auto-applies silent cleanup**

```bash
cd app && npx vitest run src/__tests__/components/app-layout.test.tsx
```

Expected: cleanup-only reconciliation remains silent and does not prompt the user.

- [ ] **Step 4: Commit the startup cleanup slice**

```bash
git add app/src-tauri/src/reconciliation/mod.rs app/src-tauri/src/reconciliation/tests.rs app/src/__tests__/components/app-layout.test.tsx
git commit -m "fix: clean stale app-local startup artifacts during normalization"
```

---

### Task 6: Align Docs, Comments, And Broad Verification

**Files:**

- Modify: `docs/design/openhands-agent-server-runtime/README.md`
- Modify: stale comments in `reconciliation/mod.rs`, `commands/skill/crud.rs`, `commands/documents/mod.rs`, `reconciliation/tests.rs`
- Modify: `AGENTS.md` only if a durable new repo-memory fact remains after implementation

- [ ] **Step 1: Update stale documentation and comments to match the normalized contract**

Examples:

- replace references to `{workspace}/{plugin_slug}/{skill_name}` with `{workspace}/{plugin_slug}/skills/{skill_name}`
- replace references to default plugin `skills` with `default`

- [ ] **Step 2: Run the required validation suites**

```bash
markdownlint docs/plans/2026-05-06-vu-1166-path-normalization-and-startup-cleanup.md docs/design/openhands-agent-server-runtime/README.md
cd app && npx tsc --noEmit
cd app && npm run test:unit
cargo test --manifest-path app/src-tauri/Cargo.toml
cd app && npm run test:repo-map
```

Expected: all pass.

- [ ] **Step 3: Commit docs plus final verification changes**

```bash
git add docs/design/openhands-agent-server-runtime/README.md app/src-tauri/src/reconciliation/mod.rs app/src-tauri/src/commands/skill/crud.rs app/src-tauri/src/commands/documents/mod.rs
git commit -m "docs: align path contract with default plugin normalization"
```

---

## Execution Notes

- Run the startup normalization before any code path that depends on plugin ownership or filesystem path lookups.
- Prefer making normalization idempotent. A second startup run on an already-migrated install should be a no-op.
- For mixed installs, prefer preserving data over aggressive deletion. If a legacy source conflicts with an existing canonical destination, archive the legacy copy into app-local backup space instead of overwriting canonical files.
- Do not leave production code depending on name-only skill lookup when plugin ownership can be ambiguous. Where a UI surface knows the plugin slug, pass it explicitly.

## Self-Review

- Spec coverage: covers canonical path enforcement, default-plugin normalization, DB migration, folder migration, file-viewer bug, startup cleanup, and docs cleanup.
- Placeholder scan: no `TODO` or `TBD` placeholders remain; every task has concrete files and commands.
- Type consistency: `pluginSlug`, `DEFAULT_PLUGIN_SLUG`, and `{plugin_slug}/skills/{skill_name}` are used consistently throughout the plan.

## Execution Handoff

Plan complete and saved to `docs/plans/2026-05-06-vu-1166-path-normalization-and-startup-cleanup.md`.

Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task, review between tasks
2. Inline Execution - execute tasks in this session using an execution skill, batch execution with checkpoints

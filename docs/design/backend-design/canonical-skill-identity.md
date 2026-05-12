# Design: Canonical Skill Identity for Artifacts

**Status:** Draft
**Related:** `implementation-gaps.md` item 6
**Date:** 2026-05-12

## Problem

Target architecture requires canonical skill resolution through `skills.id` (integer PK).
Current code accepts bare skill names as identifiers, creating ambiguity when skills share
names across plugins.

The resolver `resolve_skill_master_id_from_identifier()` falls through to name-based lookup
(`get_skill_master_id_any_plugin`) as a final safety net. This means any caller can pass a
plain skill name and get a match, defeating the `skills.id` canonical identity goal.

## Design Principle

**`skills.id` (integer PK) is the only persistence identity.** All other forms are
external-facing keys that must resolve to `skills.id` before any DB write.

**Name-based resolution requires `(skill_name, plugin_slug)` pair.** Bare name-only
resolution is removed.

## Architecture

### New Type: `SkillIdentifier`

Location: `app/src-tauri/src/db/skill_identifier.rs`

```rust
pub enum SkillIdentifier {
    ById(i64),                                    // "42"
    ByBuilderKey { plugin: String, name: String }, // "skill-builder:default:my-skill"
    ByImportedId(i64),                            // "imported:123"
}
```

**Parsing:** `SkillIdentifier::parse(&str) -> Result<Self, ParseError>`

- `"42"` → `ById(42)`
- `"skill-builder:default:my-skill"` → `ByBuilderKey { plugin: "default", name: "my-skill" }`
- `"imported:123"` → `ByImportedId(123)` — resolves same as `ById` (after migration 51,
  imported IDs are `skills.id` integers; kept as separate variant for backward-compatible
  parsing of any external callers still using the `imported:` prefix)
- `"my-skill"` → `Err(ParseError::InvalidFormat)` — bare names rejected
- `""` → `Err(ParseError::Empty)`

**ParseError variants:** `Empty`, `InvalidFormat`, `UnknownPrefix`

### Resolver: `resolve_to_db_id()`

Location: `app/src-tauri/src/db/skill_identifier.rs`

```rust
impl SkillIdentifier {
    pub fn resolve_to_db_id(&self, conn: &Connection) -> Result<i64, ResolveError>;
}
```

- `ById(id)`: `SELECT id FROM skills WHERE id = ? AND deleted_at = ''`
- `ByBuilderKey { plugin, name }`: `get_skill_master_id_in_plugin(conn, name, plugin)`
- `ByImportedId(id)`: same as `ById` (imported IDs are `skills.id` values)

**ResolveError:** `NotFound` when the resolved ID doesn't exist in `skills`.

### Boundary Behavior

Tauri commands still accept `skill_id: String` (IPC is always string):

1. `SkillIdentifier::parse(&skill_id)` — reject bare names with clear error
2. `identifier.resolve_to_db_id(conn)` — reject if not found
3. No fallback path exists

## Caller Migration

### Layer 1: `skills.rs` — Resolver Changes

| Function | Action |
|---|---|
| `resolve_skill_master_id_from_identifier()` | **Replaced** by `SkillIdentifier::parse()` + `resolve_to_db_id()` |
| `get_skill_master_id_any_plugin()` | **Removed** — no callers should need name-only lookup |
| `get_skill_master_id_in_plugin()` | **Kept** — needed for builder key resolution |
| `set_skill_behaviour()` | **Removed** — replaced by `set_skill_behaviour_in_plugin()` |

### Layer 2: `locks.rs` — Dead Code Removal

| Function | Action |
|---|---|
| `acquire_skill_lock(name, ...)` | **Removed** — `_by_skill_id` variant exists |
| `release_skill_lock(name, ...)` | **Removed** — `_by_skill_id` variant exists |
| `get_skill_lock(name)` | **Removed** — `_by_skill_id` variant exists |
| Tests | Updated to use `_by_skill_id` variants |

### Layer 3: `workflow.rs` — Use `_by_skill_id` Variants

| Function | Action |
|---|---|
| `get_workflow_run_id(name)` | **Removed** — callers use `get_workflow_run_id_by_skill_id` |
| `get_disabled_steps(name)` | Caller uses `_by_skill_id` variant |
| `save_workflow_state(name, ...)` | Caller uses `_by_skill_id` variant |
| `reset_workflow_steps(name)` | Caller uses `_by_skill_id` variant |
| `save_workflow_step(name, ...)` | Caller uses `_by_skill_id` variant |
| `get_latest_session_for_skill(name)` | Caller uses `_by_skill_id` variant |

### Layer 4: Tauri Commands

| File | Change |
|---|---|
| `commands/skill/crud.rs:257` | Use `get_skill_master_id_in_plugin(conn, name, DEFAULT_PLUGIN_SLUG)` |
| `commands/workflow/settings.rs:172` | Caller switches to `read_workflow_settings_by_skill_id` |
| `commands/workflow_lifecycle.rs:32` | `start_session` uses `DEFAULT_PLUGIN_SLUG` or adds `plugin_slug` param |
| `commands/skill/metadata.rs:139` | Switch to `set_skill_behaviour_in_plugin` (has `plugin_slug`) |
| `commands/settings.rs:207` | Switch to `set_skill_behaviour_in_plugin` (has `plugin_slug`) |

### Layer 5: `imported_skills.rs`

| Location | Change |
|---|---|
| Line 407 | Switch to `get_skill_master_id_in_plugin` (caller has `plugin_slug`) |

### Layer 6: Frontend

**No changes needed.** Frontend already sends `String(skillId)` from integer `skills.id`
values. Type definitions (`tauri-command-types.ts`) remain `skillId: string`.

### Layer 7: Migration

Migration 54: Code-only removal of `get_skill_master_id_any_plugin()`. No schema change.

## Error Messages

| Scenario | Error |
|---|---|
| Empty skill_id | `"skill_id is required"` |
| Bare name (no prefix, not integer) | `"skill_id must be a numeric ID or structured key (skill-builder:plugin:name or imported:id)"` |
| Valid format but skill not found | `"Skill not found: {identifier}"` |

## Testing

- Unit tests for `SkillIdentifier::parse()` covering all valid and invalid formats
- Unit tests for `resolve_to_db_id()` covering each variant
- Existing `workflow_artifacts.rs` tests updated to use structured identifiers
- `locks.rs` tests migrated to `_by_skill_id` variants
- Structural agent tests updated if any fixture references bare skill names

## Out of Scope (Follow-ups)

- **`lock_plugin_for_skill()`** (`skills.rs`): Uses `WHERE name = ?1 LIMIT 1` — ambiguous
  across plugins. Should be updated to require `plugin_slug`. Called from
  `commands/skill/metadata.rs:157`. Separate ticket.
- **`start_session()`** (`workflow_lifecycle.rs`): Has `#[allow(dead_code)]` and falls back
  to `upsert_skill` if not found. This create-or-resolve pattern is outside the artifact
  resolution path. If this function is revived, it should accept `plugin_slug`.

## Files Changed

| File | Change |
|---|---|
| `db/skill_identifier.rs` | **New** — `SkillIdentifier` type, parse, resolve |
| `db/mod.rs` | Export `skill_identifier` module |
| `db/skills.rs` | Remove `resolve_skill_master_id_from_identifier`, `get_skill_master_id_any_plugin`, `set_skill_behaviour` |
| `db/workflow_artifacts.rs` | Use `SkillIdentifier::parse()` + `resolve_to_db_id()` |
| `db/locks.rs` | Remove name-based functions, update tests |
| `db/workflow.rs` | Remove `get_workflow_run_id(name)`, callers use `_by_skill_id` |
| `db/imported_skills.rs` | Use `get_skill_master_id_in_plugin` |
| `commands/skill/crud.rs` | Use `get_skill_master_id_in_plugin` |
| `commands/skill/metadata.rs` | Use `set_skill_behaviour_in_plugin` |
| `commands/settings.rs` | Use `set_skill_behaviour_in_plugin` |
| `commands/workflow/settings.rs` | Use `read_workflow_settings_by_skill_id` |
| `commands/workflow_lifecycle.rs` | Update `start_session` |
| `db/migrations.rs` | Add migration 54 slot |
| `db/tests.rs` | Update tests referencing removed functions |

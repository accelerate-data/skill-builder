---
functional-specs: [custom-plugin-management]
---

# Plugin Path Restructure

> **Status:** Draft

## Overview

The canonical skill path on disk must change from `{skills_dir}/{plugin_slug}/{skill_name}` to `{skills_dir}/{plugin_slug}/skills/{skill_name}`. Adding a fixed `skills/` subdirectory inside the plugin directory creates space for sibling directories (`evals/`, `docs/`) at the plugin level — which the eval workbench redesign requires — and correctly models the plugin as a versioned container rather than a flat namespace.

## Design Scope

**Covers**

- Updated path templates in `plugin-paths.json`.
- Changing `DEFAULT_PLUGIN_SLUG` from `"skills"` to `"default"`.
- Backward-compatible skill discovery for existing installations.
- Git tag and read-prefix fixes in `git.rs` that currently have the canonical and legacy formats reversed.
- Updated tests in `skill_paths.rs` and `commands/skill/tests.rs`.

**Does not cover**

- Eval directory layout (covered in eval-workbench-scenarios design).
- Per-skill git repository migration (covered in per-skill-git-repos design).
- Any UI changes — the path is an implementation detail not surfaced to users.

## Current State

`plugin-paths.json` today:

```json
{
  "default_plugin_slug": "skills",
  "skill_dir": "{root}/{plugin_slug}/{skill_name}",
  "workspace_skill_dir": "{workspace}/{plugin_slug}/{skill_name}",
  "tag_prefix": "{plugin_slug}/{skill_name}/v",
  "tag_glob": "{plugin_slug}/{skill_name}/*"
}
```

With the default slug `"skills"`, all user-created skills land at `{skills_dir}/skills/{skill_name}`. There is no room for sibling directories at the plugin level. The `plugin_slug` is overloaded as both the plugin name and a content-type directory.

Marketplace plugins downloaded from GitHub already use the correct nested layout (`{plugin_slug}/skills/{skill_name}`). The reconciliation code at `reconciliation/mod.rs:142` already detects plugins by the presence of a `skills/` subdirectory. The format is therefore already canonical for marketplace skills — this change makes it canonical for user-created skills too.

## Target State

```json
{
  "default_plugin_slug": "default",
  "skill_dir": "{root}/{plugin_slug}/skills/{skill_name}",
  "workspace_skill_dir": "{workspace}/{plugin_slug}/skills/{skill_name}",
  "tag_prefix": "{plugin_slug}/skills/{skill_name}/v",
  "tag_glob": "{plugin_slug}/skills/{skill_name}/*"
}
```

On disk:

```
{skills_dir}/
  {plugin_slug}/          ← plugin root (e.g. "superpowers", "default")
    skills/               ← fixed subdirectory
      analyzing-bookings/
        SKILL.md
    evals/                ← future: eval workbench scenarios
      analyzing-bookings/
```

## Key Decisions

| Decision | Rationale |
|---|---|
| Change `default_plugin_slug` from `"skills"` to `"default"`. | `"skills"` as the default creates `skills/skills/skill-name` with the new template. `"default"` is neutral and signals "user's own plugin". |
| Keep backward compatibility in `enumerate_skill_locations`. | Existing users have skills at `{skills_dir}/skills/{skill_name}` (old default). The discovery function must still find them and present them without requiring a manual migration step. |
| Do not auto-migrate files on disk. | Moving directories is destructive and irreversible. Discovery finds both layouts; the user decides whether to restructure their plugin directory. |
| Fix git read-prefix priority order — do not add a new migration pass. | `git.rs` currently labels `{plugin}/skills/{name}/` as "old marketplace layout" with lower priority than `{plugin}/{name}/`. After this change those priorities swap. No new migration function is needed. |

## Impact Analysis

### Changes Required

| File | Change |
|---|---|
| `app/plugin-paths.json` | All four template fields updated; `default_plugin_slug` → `"default"` |
| `app/src-tauri/src/skill_paths.rs` | `DEFAULT_PLUGIN_SLUG` constant → `"default"`; unit tests updated for new path expectations |
| `app/src-tauri/src/git.rs` | Read-prefix priority: `{plugin}/skills/{name}/` promoted to position 1 (canonical); `{plugin}/{name}/` demoted to legacy fallback. Remove or invert `migrate_marketplace_skill_tags`. |
| `app/src/__tests__/` | Tests that assert hardcoded path strings update automatically via `DEFAULT_PLUGIN_SLUG` constant |

### No Changes Required

The following already use generic path resolution helpers and will automatically adopt the new template:

- `reconciliation/mod.rs` — already detects plugins via `skills/` subdir presence
- `commands/skill/crud.rs`, `metadata.rs`, `cleanup.rs` — call `resolve_skill_dir()`
- `db/skills.rs` — uses the constant, stores skill name not absolute path
- Frontend `evals.ts`, `use-workflow-gate.ts` — use `resolveTemplate()` against the JSON at runtime

### Backward Compatibility

`enumerate_skill_locations` in `skill_paths.rs` must scan three layouts in order:

1. **New canonical:** `{root}/{plugin_slug}/skills/{skill_name}/SKILL.md`
2. **Legacy plugin layout:** `{root}/{plugin_slug}/{skill_name}/SKILL.md` (old app format)
3. **Legacy flat layout:** `{root}/{skill_name}/SKILL.md` (original flat structure)

Layout 2 is what existing users have today. Discovering it without migrating it means the app continues to work after the update; users can restructure at their own pace or never.

### Git Tag Impact

`git.rs` maintains four read prefixes when restoring versions. Current comment labels:
- Position 1: `{plugin}/{name}/` — "Plugin layout" (currently canonical)
- Position 2: `{plugin}/skills/{name}/` — "Old marketplace layout" (currently treated as legacy)

After this change these swap. There is no new tag migration needed — read fallback handles both.

The existing `migrate_marketplace_skill_tags` function migrated FROM `{plugin}/skills/{name}/v` TO `{plugin}/{name}/v`. That migration was wrong from day one (it moved tags away from the correct layout). This function should be removed; the read-prefix fallback already handles reading tags in either format.

## Testing

- `skill_paths.rs` unit tests: update all path assertions to expect the new `skills/` level.
- Add a test in `enumerate_skill_locations` that verifies legacy layout skills (at `{root}/{slug}/{name}/`) are still discovered.
- `reconciliation/tests.rs` marketplace nested layout test already matches the new canonical — verify it still passes without changes.
- `cargo test skill_paths` for Rust, `npm run test:unit` for frontend path helpers.

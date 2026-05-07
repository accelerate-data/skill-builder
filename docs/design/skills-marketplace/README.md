---
functional-specs: [custom-plugin-management]
---

# Local Claude Code Marketplace

> **Status:** Current
> **Functional specs:** [`custom-plugin-management`](../../functional/custom-plugin-management/README.md)

## Overview

The marketplace is a **local Claude Code plugin registry** that uses the same `.claude-plugin/` manifest format as Claude Code's plugin marketplace. It serves two purposes: (1) auto-discover and catalog locally-created plugins, and (2) import skills from remote GitHub repos that follow the Claude Code plugin marketplace schema. Skills flow one-way into the local Skills Library — they are never published back through this layer.

## Local Manifest System

The app maintains a local `marketplace.json` at the skills root (`{skills_path}/.claude-plugin/marketplace.json`). This is the canonical catalog of all plugins on disk, regenerated automatically when plugins are created, deleted, or modified.

### Manifest regeneration

`marketplace_manifest.rs` provides four functions that keep the local catalog in sync:

| Function | Trigger | Purpose |
|---|---|---|
| `write_marketplace_json(root)` | Plugin scan | Scans `{root}/` for directories containing `skills/` or `.claude-plugin/plugin.json`, writes the root `marketplace.json` |
| `regenerate_all_manifests(root)` | After skill/plugin create/delete | Ensures every plugin has a `plugin.json`, then rewrites `marketplace.json` |
| `ensure_plugin_in_marketplace(root, slug, display_name)` | New plugin created | Appends a plugin entry if not already listed; no-op if present |
| `read_plugin_display_names(root)` | UI display | Returns a `HashMap<slug, display_name>` from the local catalog |

The local manifest uses the same JSON shape as a remote registry:

```json
{
  "name": "skill-builder-local",
  "owner": { "name": "Skill Builder" },
  "plugins": [
    { "name": "default", "source": "./default", "description": null, "version": null },
    { "name": "analytics", "source": "./analytics", "description": "Analytics skills", "version": "1.0.0" }
  ]
}
```

### Plugin layout

Every plugin — whether created locally or imported from a registry — follows the same on-disk structure:

```text
{skills_path}/
  .claude-plugin/
    marketplace.json          ← auto-generated catalog of all plugins
  default/                    ← default plugin (always present)
    .claude-plugin/
      plugin.json             ← { "name": "default" }
    skills/
      my-skill/
        SKILL.md
  analytics/                  ← custom plugin
    .claude-plugin/
      plugin.json             ← { "name": "analytics", "description": "...", "version": "1.0.0" }
    skills/
      report-builder/
        SKILL.md
      data-modeler/
        SKILL.md
```

The canonical path resolver is `skill_paths::resolve_skill_dir(root, plugin_slug, skill_name)` — never construct `{root}/{skill_name}` directly. Each skill has its own git repo at the skill directory level.

## Remote Registry Import

Remote registries are GitHub repos that expose a `.claude-plugin/marketplace.json` catalog. The app treats them as read-only skill sources.

### Registry configuration

Registries are managed in Settings → Marketplace (`marketplace_section.tsx`). Each registry has a name, GitHub URL, and enabled/disabled toggle. State lives in the settings store (`use-marketplace-registries.ts`).

- **Default** — `hbanerjee74/skills`, seeded on first launch, cannot be removed.
- **Adding** — enter `owner/repo` or `owner/repo#branch`; the app validates by fetching `marketplace.json` via `check_marketplace_url`.
- **Enabled only** — disabled registries are hidden from the browse dialog but retained in settings.

### Discovery pipeline

The import flow (`commands/github_import/`) follows this sequence:

1. **Validate registry** — `check_marketplace_url` confirms the repo is accessible and `marketplace.json` is valid JSON. Returns the `name` field for display.
2. **Fetch catalog** — `list_github_skills_inner` downloads `marketplace.json` and the repo tree via GitHub API.
3. **Resolve plugin paths** — `catalog.rs::resolve_plugin_path` handles three source formats:
   - `"./plugins/skill-builder"` → strip `./` → `plugins/skill-builder`
   - `"./"` → `""` (repo root)
   - Bare name → prepend `metadata.pluginRoot` if set
4. **Discover skills** — `discover_skills_from_catalog` finds all `{plugin_path}/skills/{skill_name}/SKILL.md` entries (one level deep). Skills without a `name:` frontmatter field are excluded.
5. **Read plugin names** — fetches each plugin's `.claude-plugin/plugin.json` for display names. Skills are listed as `{plugin_name}:{skill_name}` in the browse dialog.
6. **Import** — `import_marketplace_to_library` (individual skills) or `import_marketplace_plugin_to_library` (full plugin) downloads files, writes DB rows, commits to per-skill git repos, and regenerates local manifests.

### Import destinations

| Destination | DB `skill_source` | Plugin slug | Purpose |
|---|---|---|---|
| Individual skill import | `marketplace` | `default` | Quick single-skill import into the default plugin |
| Full plugin import | `marketplace` | `{slugified_plugin_name}` | Preserves the remote plugin's identity as a local plugin |

Both paths write to the `skills` master table and `imported_skills` child table. The `imported_skills` row stores `disk_path`, `version`, `content_hash`, and `marketplace_source_url`. Non-spec fields `model` and `argument_hint` are also stored but scheduled for removal (VU-1173).

## Skill Naming

**Display** (browse dialog): `{plugin_name}:{skill_name}` — e.g. `vibedata:dbt-fabric-patterns`. When plugin name is absent, just `{skill_name}`.

**Storage** (disk and DB): plain `skill_name` from frontmatter only — no plugin prefix. The plugin boundary is enforced by the directory structure (`{plugin_slug}/skills/{skill_name}/`), not by name mangling.

## Version Tracking and Updates

At import time the app stores a SHA-256 hash of `SKILL.md` as a baseline (`set_imported_skill_content_hash`). On startup, `check_marketplace_updates` compares each installed skill against the current remote catalog.

**Customization detection** — if the current file hash differs from the baseline, the skill is considered customized and excluded from auto-update (`check_skill_customized` command).

**Auto-update mode** — non-customized skills update silently on startup; a summary toast lists what changed.

**Manual update mode** — a startup notification links to the import dialog for each available update.

**Known gaps:** The startup check failure path logs silently — no persistent error notification is shown. The customization warning dialog before overwriting a modified skill has its state wired up but the `AlertDialog` is not rendered.

## Browse Dialog

One tab per enabled registry. Each skill shows its qualified display name and install state:

- No badge — not installed
- **Up to date** — same version installed
- **Update available** — newer version in catalog
- **Already installed** — installed, no version to compare

Before importing, the user can edit the skill's metadata. The form pre-populates from the remote `SKILL.md` frontmatter, falling back to locally-installed fields when upgrading. `metadata_overrides` are passed through to `import_marketplace_to_library` and applied before the DB insert.

## SKILL.md Frontmatter Reference

```yaml
---
name: dbt-fabric-patterns
description: >
  Teaches Claude how to write dbt models for Microsoft Fabric.
  Use when building incremental or snapshot models on Fabric.
version: 1.2.0
model: sonnet
argument-hint: "dbt model name or pattern"
user-invocable: true
disable-model-invocation: false
---
```

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Kebab-case. Authoritative skill name — directory name never used as fallback. Missing = skill excluded. |
| `description` | Yes | Shown in browse dialog; wired into `CLAUDE.md` so agents know when to invoke it. |
| `version` | Yes | Semver. Defaults to `"1.0.0"` if absent at import time. |
| `model` | No | **App-only** — not in Agent Skills spec. Overrides app default on invocation. Scheduled for removal (VU-1173). |
| `argument-hint` | No | **App-only** — not in Agent Skills spec. Hint shown when invoking as a slash command. Scheduled for removal (VU-1173). |
| `user-invocable` | No | Whether the skill can be invoked as a slash command. |
| `disable-model-invocation` | No | Suppresses model selection UI. |

All other keys are silently ignored. `purpose` is set by import destination, never read from the file.

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/marketplace_manifest.rs` | Local manifest CRUD — scan, write, regenerate `marketplace.json` and `plugin.json` |
| `app/src-tauri/src/commands/github_import/commands.rs` | Tauri commands: `check_marketplace_url`, `list_github_skills`, `import_marketplace_to_library`, `import_marketplace_plugin_to_library`, `check_skill_customized` |
| `app/src-tauri/src/commands/github_import/catalog.rs` | Pure discovery kernels: `resolve_plugin_path`, `discover_plugins_from_catalog`, `discover_skills_from_catalog` |
| `app/src-tauri/src/commands/github_import/import.rs` | Download, frontmatter parsing, DB write, git commit/tag per skill |
| `app/src-tauri/src/commands/github_import/updates.rs` | Startup update check — compares installed skills against remote catalog |
| `app/src/hooks/use-marketplace-registries.ts` | React hook for registry CRUD, test, and add operations |
| `app/src/components/settings/marketplace_section.tsx` | Settings → Marketplace UI — registry list, toggle, test, add |
| `app/plugin-paths.json` | Canonical skill path layout schema |

## Relationship to Existing Design Specs

| Spec | Relationship |
|---|---|
| [`backend-design/`](../backend-design/README.md) | Covered — DB schema, `skill_source` discrimination, `imported_skills` table |
| [`per-skill-git-repos/`](../per-skill-git-repos/README.md) | Covered — per-skill git repos are the unit of version tracking for marketplace imports |
| [`product-architecture/`](../product-architecture/README.md) | Covered — plugin namespace as first-class boundary, publish unit |

## Open Questions

1. `[design]` The local `marketplace.json` is regenerated on every plugin change. Should this be debounced or batched for bulk operations?
2. `[design]` Plugin imports from remote registries create a new local plugin with a slugified name. Should there be a conflict resolution flow when a local plugin already has the same slug?
3. `[design]` The customization warning dialog is wired but not rendered. Should this be completed before the next release?

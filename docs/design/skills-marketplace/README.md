# Skills Marketplace — Design Note

---

## Overview

The marketplace is a one-way import layer — skills flow in from a GitHub repo, never out. Two distinct populations of skills exist in the app, and the marketplace feeds both:

| | **Settings → Skills** | **Skill Library** |
|---|---|---|
| **Purpose** | Skills used by Skill Builder agents to build, refine, and test skills | Domain knowledge — skills users create, import, and refine |
| **Examples** | `research`, `validate-skill`, `skill-builder-practices` | Sales Pipeline Analytics, dbt Incremental Silver |
| **After import** | Wired into the agent workspace — active skills are available to Claude Code on every agent run | Appears in the dashboard as a completed skill, ready to refine |

The `purpose` frontmatter field drives routing: `skill-builder` purpose skills belong in Settings → Skills; `domain`, `platform`, `source`, and `data-engineering` skills belong in the Skill Library.

---

## Registry Model

A marketplace is a GitHub repository containing a `.claude-plugin/marketplace.json` catalog file that lists the plugins (and their skills) it publishes. There is no folder-scan fallback — a missing or malformed catalog is an error, not a silent empty result.

**Multiple named registries** — one or more named registries can be configured in Settings → Marketplace. Each registry has a name (auto-fetched from `marketplace.json`), a GitHub source URL, and an enabled/disabled toggle. The default registry is seeded on first launch and cannot be removed. Additional registries can be added and removed freely.

**Enabled registries only** — only enabled registries are fetched. Disabling a registry removes it from the browse dialog without deleting it from the list.

**Registry name** — when a user adds a registry URL, the app validates the URL and fetches the `marketplace.json`. The `name` field from the catalog is used as the registry display name. If absent, the name falls back to `"{owner}/{repo}"`. No manual name input is required.

**Single nesting level** — the supported structure is: registry → plugins → skills (three levels). Nested registries within sub-folders are not supported. If a repo has sub-collections, each sub-collection is configured as its own separate registry URL with its own tab. This keeps the model flat and avoids namespace ambiguity.

---

## marketplace.json Schema

The catalog follows the [official Claude Code plugin marketplace schema](https://code.claude.com/docs/en/plugin-marketplaces#marketplace-schema).

```json
{
  "name": "Anthropic Knowledge Work Plugins",
  "owner": {
    "name": "Anthropic",
    "url": "https://anthropic.com"
  },
  "metadata": {
    "pluginRoot": "plugins"
  },
  "plugins": [
    {
      "name": "engineering",
      "source": "./engineering",
      "description": "Engineering productivity skills"
    },
    {
      "name": "research",
      "source": "./research",
      "description": "Research and analysis skills"
    }
  ]
}
```

### Top-level fields

| Field | Required | Notes |
|---|---|---|
| `name` | No | Human-readable registry display name. Used as the tab label in the browse dialog. Falls back to `"{owner}/{repo}"` if absent. |
| `owner` | No | Object with `name` and `url`. Informational only. |
| `metadata` | No | Object with `pluginRoot`. See below. |
| `plugins` | Yes | Array of plugin catalog entries. |

### `metadata.pluginRoot`

Base path prepended to plugin sources that do **not** start with `./`. For example, if `pluginRoot` is `"plugins"` and a source is `"engineering"`, the resolved plugin path is `plugins/engineering`. Sources starting with `./` are used as-is (e.g. `"./engineering"` → `engineering`). This is a path convenience only — it has no effect on naming or namespacing.

### Plugin catalog entries

| Field | Required | Notes |
|---|---|---|
| `name` | No | Display name for the plugin group in the catalog. |
| `source` | Yes | Path to the plugin directory (relative to repo root). Can be a string starting with `./` (relative path) or an object (`github`, `url`, `npm`, `pip`). Currently only string paths are supported. |
| `description` | No | Short description shown in the UI. |

---

## Skill Discovery (Nested Plugin Structure)

Each catalog entry's `source` points to a **plugin directory**, not a skill directly. Skills live inside that directory under a `skills/` subdirectory:

```
{plugin_path}/
  .claude-plugin/
    plugin.json       ← authoritative plugin name
  skills/
    standup/
      SKILL.md
    code-review/
      SKILL.md
```

**Discovery algorithm (spec-compliant, no fallback paths):**

1. Resolve `plugin_path` from the catalog entry's `source`:
   - Source starts with `./`: strip `./` and trailing `/` → `plugin_path`
   - Source is a bare name: prepend `metadata.pluginRoot` (if set) → `plugin_path`
   - Corner condition: `source = "./"` → `plugin_path = ""` → skills prefix = `"skills/"`
2. Enumerate all `{plugin_path}/skills/{skill_name}/SKILL.md` paths in the git tree (one level deep inside `skills/`)
3. Fetch each `SKILL.md` — skills missing the `name:` frontmatter field are **excluded** (no directory-name fallback)
4. Fetch `{plugin_path}/.claude-plugin/plugin.json` to get the plugin's canonical name

Plugin entries that yield no skills are silently skipped (logged at `debug` level). External source types (`github`, `npm`, `pip`, `url`) are skipped with a warning.

### Root plugin case

When `source = "./"` the plugin directory is the repo root (or subpath root). In this case `plugin.json` lives at `.claude-plugin/plugin.json` — the same directory as `marketplace.json`. If this file exists and has a `name` field, it is used as the plugin name.

---

## Skill Naming

### Authoritative sources (no fallbacks)

| What | Source |
|---|---|
| **Plugin name** | `{plugin_path}/.claude-plugin/plugin.json` → `name` field |
| **Skill name** | `SKILL.md` frontmatter `name:` field |

Directory names are **never** used as a fallback for either. If `plugin.json` is absent or has no `name`, `plugin_name` is `null`. If `SKILL.md` has no `name:` field, the skill is excluded from listing and import.

### Display name in the browse dialog

Skills are displayed as `{plugin_name}:{skill_name}` when a plugin name is available. When `plugin_name` is `null` (no `plugin.json` or no `name` field), just `{skill_name}` is shown.

This mirrors the Claude Code runtime namespace model (`{plugin-name}:{skill-name}`) so users see the same qualified names they would encounter when using the plugin in Claude Code.

### Local storage name

Skills are **stored locally under their plain `skill_name` only** — no plugin prefix on disk or in the database. The qualified display name is used for browsing only.

This design avoids:
- Name collisions between skills from different plugins (same `skill_name`, different `plugin_name`) becoming a problem on disk — the `skill_name` in frontmatter is the canonical local identifier
- Filesystem issues with `:` separators on Windows

### Name collision handling

Because skills are stored by their frontmatter `name:` only, two skills from different plugins with the same `name:` would collide on local storage. The user sees both in the browse dialog with their qualified names but importing a second skill with the same local name will overwrite the first. This is a known limitation; users with conflicting skill names should rename one before importing.

---

## Settings → Skills

Skills here are used by Skill Builder agents to build, refine, and test skills. What's installed in this layer determines how the workflow behaves.

Skills can enter this layer three ways: bundled with the app (cannot be deleted), imported from the marketplace, or uploaded as a zip file. Zip uploads are always treated as `skill-builder` type regardless of frontmatter.

Skills can be toggled active or inactive. Inactive skills remain installed but are not available to agents. Only one active skill per purpose slot (e.g. `"research"`, `"validate"`) is allowed — purpose is an optional label that identifies a skill's role in the workflow.

---

## Skill Library

Skills here are domain knowledge packages — the output of Skill Builder. They can be built from scratch through the full workflow, or imported from the marketplace and used as a starting point for refinement.

A marketplace-imported skill skips the generation workflow entirely but is otherwise identical to a built skill — it appears in the dashboard and can be opened for refinement immediately.

---

## Version Tracking and Updates

Every skill has a `version` field (semver). At import time, a content snapshot of the skill is stored as a baseline.

On startup, the app compares installed versions against the marketplace catalog. Each destination (Skill Library and Settings → Skills) is checked independently — a skill can be installed in both and will be evaluated separately in each.

**Customization detection** — a skill is considered customized if its content has changed since it was imported. Customized skills are excluded from auto-update to avoid overwriting local edits.

**Auto-update mode** — updates are applied automatically on startup for all non-customized skills. The user is notified of what was updated, grouped by destination.

**Manual update mode** — the user is notified of available updates on startup. Each notification links directly to the relevant import dialog where the user can review and apply updates.

If the startup check fails for any reason, a persistent error notification is shown.

---

## Browse Dialog

The same import dialog is used for both destinations. It shows the full marketplace catalog across all enabled registries, with one tab per registry. Each tab pre-marks skills based on their install state: not installed, up to date, update available, or already installed. The user can edit a skill's metadata before confirming the import.

Skills in the browse dialog are labeled with their qualified name (`{plugin_name}:{skill_name}` when plugin name is available, plain `{skill_name}` otherwise).

When upgrading a Settings → Skills skill that has been locally modified, the user must confirm before proceeding — the upgrade will overwrite their local changes.

---

## SKILL.md Frontmatter

Every skill must have a `SKILL.md` with YAML frontmatter. Without it the import is rejected.

```yaml
---
name: dbt-fabric-patterns
description: >
  Teaches Claude how to write dbt models for Microsoft Fabric.
  Use when building incremental or snapshot models on Fabric.
purpose: domain
version: 1.2.0
model: sonnet
argument-hint: "dbt model name or pattern"
user-invocable: true
disable-model-invocation: false
---
```

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Kebab-case identifier. **This is the authoritative skill name** — directory name is never used as a fallback. Skills without this field are excluded from listing and import. |
| `description` | Yes | Shown in the browse dialog and wired into CLAUDE.md so agents know when to invoke the skill. |
| `version` | Yes | Semver string. Required for update detection. Defaults to `"1.0.0"` if absent at import time. |
| `model` | No | Preferred Claude model. Overrides the app default when the skill is invoked. |
| `argument-hint` | No | Short hint shown when invoking the skill as a slash command. |
| `user-invocable` | No | Whether the skill can be invoked directly as a slash command. |
| `disable-model-invocation` | No | Suppresses model selection UI for this skill. |

All other keys (`domain:`, `type:`, `purpose:`, `tools:`, `trigger:`, etc.) are silently ignored by the importer. `purpose` is a database field set at import time based on where the user is importing to — it is not read from the file.

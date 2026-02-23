# Skills Marketplace — Design Note

---

## Overview

The marketplace is a one-way import layer — skills flow in from a GitHub repo, never out. Two distinct populations of skills exist in the app, and the marketplace feeds both:

| | **Settings → Skills** | **Skill Library** |
|---|---|---|
| **Purpose** | App infrastructure — powers the workflow agents | Domain knowledge — skills users create, import, and refine |
| **Examples** | `research`, `validate-skill`, `skill-builder-practices` | Sales Pipeline Analytics, dbt Incremental Silver |
| **Storage** | `workspace_path/.claude/skills/` (agent workspace) | `skills_path/` (user-configured output directory) |
| **After import** | Wired into workspace CLAUDE.md — Claude Code loads the skill on every agent run. Active/inactive toggle moves the skill in and out of CLAUDE.md. | Appears in the dashboard as a completed skill. Can be refined and tested. Cannot be edited or assigned a purpose. |

A data engineer installing a custom `research` skill in Settings→Skills is changing how the workflow itself runs. A data engineer importing a domain skill into the Skill Library is acquiring a finished knowledge package to deploy to their own Claude Code projects.

---

## Registry Model

**Configuration**: A single `marketplace_url` setting in Settings → GitHub. Accepts:
- `owner/repo`
- `github.com/owner/repo`
- `https://github.com/owner/repo`
- `https://github.com/owner/repo/tree/branch/subpath`

**Default branch resolution**: `parse_github_url` defaults to `"main"` for URLs without an explicit branch. All import functions call `get_default_branch` via the repos API after parsing to resolve the actual default — avoiding 404s on repos where the default branch is `"master"` or a custom name.

**Discovery (Settings→Skills browse)**: `list_github_skills` fetches `.claude-plugin/marketplace.json` at the root of the configured branch. The manifest is a JSON object with a `plugins` array; each entry carries `name`, `source` (a relative path string or an object source type), and optional `description`, `version`, `author`, `category`, `tags`. Only path-string sources are processed — object sources (e.g. npm, pip, url) are skipped with a warning. Each resolved path is verified to have a `SKILL.md` present; entries without one are filtered out. If a `subpath` is configured, only paths under that prefix are included.

**Discovery (Skill Library browse)**: `import_marketplace_to_library` uses the full recursive git tree + per-SKILL.md fetches — the marketplace.json optimization applies only to the Settings→Skills browse listing.

---

## SKILL.md Frontmatter

Every skill imported into Skill Builder — whether from the marketplace, a zip file, or the public GitHub repo — must have a `SKILL.md` with YAML frontmatter. This is how the app identifies, categorises, and wires the skill. Without it the import is rejected.

```yaml
---
name: sales-pipeline-analytics
description: >
  Teaches Claude how sales pipeline metrics are defined and calculated.
  Use when building silver/gold layer models for pipeline reporting.
domain: sales
skill_type: domain
version: 1.2.0
model: sonnet
argument-hint: "pipeline stage or metric name"
user-invocable: true
disable-model-invocation: false
---
```

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Kebab-case identifier. Skills without a `name` in frontmatter are skipped during marketplace listing — there is no directory-name fallback. Used as the primary key — two skills with the same name will conflict. |
| `description` | No (Settings→Skills); Yes (Skill Library) | Shown in the browse dialog, Skill Library, and wired into the workspace CLAUDE.md so Claude Code knows when to invoke the skill. Should follow the trigger-pattern format: what it does, when to use it. |
| `domain` | No (Settings→Skills); Yes (Skill Library) | The business or technical domain (e.g. `sales`, `dbt`, `fabric`). Shown as a badge in the skill list. |
| `skill_type` | No | Categorises the skill (`domain`, `platform`, `source`, `data-engineering`, `skill-builder`). The Skill Library browse dialog filters to domain-type values. Settings→Skills browse shows all skills regardless of `skill_type`. |
| `version` | No | Semantic version string. Used by the version-aware import guard in Settings→Skills. |
| `model` | No | Preferred Claude model for this skill (`opus`, `sonnet`, `haiku`). Overrides the app default when the skill is invoked. |
| `argument-hint` | No | Short hint shown to the user when invoking the skill (e.g. `"dbt model name"`). Helps the user know what to pass. |
| `user-invocable` | No | `true` if the skill can be directly invoked by the user as a slash command. Defaults to `false`. |
| `disable-model-invocation` | No | `true` to hide the model selection UI for this skill. Use when the skill is tightly coupled to a specific model. |

**Zip upload**: `name`, `domain`, and `description` are mandatory — missing any returns an error listing the missing fields. Zip uploads always import into Settings→Skills regardless of `skill_type`.

---

## Shared Import Mechanics

These apply to both import destinations.

### Editable metadata at import

An edit form is shown pre-populated with the skill's frontmatter values. The user can modify `name`, `description`, `domain`, `skill_type`, `version`, and `model` before confirming.

The two modes differ in when overrides are applied:
- **Skill Library**: confirming the edit form immediately triggers the import with the overrides passed to `importMarketplaceToLibrary`.
- **Settings→Skills**: confirming saves the overrides per-skill; they are applied at bulk import time when the user clicks Import.

### Frontmatter rewrite on disk

`import_single_skill` (used by both import paths) rewrites the YAML frontmatter block in `SKILL.md` with the final values after downloading. Body content below the closing `---` is preserved. If the rewrite fails, the import is rolled back — the skill directory is removed and no DB row is inserted — and the error is surfaced to the user.

### Pre-marking

Before showing the browse dialog, skills already present in the app are marked so the user can see what's installed:

- **Skill Library path**: queries a UNION of `workflow_runs` and `imported_skills` by skill name. Skills found in either table are shown as "In library".
- **Settings→Skills path**: queries `workspace_skills` by name and version. Skills matching name + version are shown as "Already installed"; skills matching name but at an older version are shown as "Upgrade available".

---

## Settings → Skills

Skills in this layer are loaded into the agent workspace and wired into CLAUDE.md as custom skills. Claude Code reads them during agent runs. Changing what's here changes how the workflow behaves.

**Three ways skills enter this layer:**

1. **Bundled** — shipped with the app, seeded by `seed_bundled_skills` on startup. Always overwrite on seed; `is_active` state is preserved across re-seeds. Cannot be deleted — only deactivated.

2. **Marketplace import** (Settings→Skills browse dialog) — reads `.claude-plugin/marketplace.json` from the configured repo. `skill_type` is not filtered at listing time; it is resolved from `SKILL.md` frontmatter at import time. Downloads to `workspace_path/.claude/skills/`, inserts into `workspace_skills`. No dashboard entry.

3. **Zip upload** — extracts to `workspace_path/.claude/skills/`. Always forces `skill_type='skill-builder'` regardless of frontmatter.

**Active/inactive toggle** — deactivating moves the skill directory from `skills/` to `skills/.inactive/`. The DB is updated first; if the file move fails, the DB update is rolled back. CLAUDE.md is rebuilt after every toggle.

### Version-aware import guard

Before import, the app compares the candidate skill against existing `workspace_skills` rows by name:

| Condition | Status shown | Action |
|---|---|---|
| Same name + same version already in `workspace_skills` | "Already installed" | Import blocked |
| Same name + newer version available | "Upgrade available" | Import allowed — overwrites existing directory on disk and updates the DB row, preserving `is_active` and `is_bundled` |
| No name match | Available | Import proceeds normally |

### Purpose slots

Each workspace skill may hold a **purpose** — a named role the app resolves at runtime when selecting which skill to use for a given function. Purpose is a nullable DB-only field (`workspace_skills.purpose`); it is not written to frontmatter. Purpose applies only to Settings→Skills; Skill Library skills have no purpose concept.

**Bundled skill purposes** (hardcoded):

| Skill | Purpose |
|---|---|
| `research` | `research` |
| `skill-builder-practices` | `skill-building` |
| `skill-test` | `test-context` |
| `validate-skill` | `validate` |

**Import-time assignment**: during marketplace import into Settings→Skills, the user can optionally assign a purpose to the incoming skill. If the selected purpose is already held by a DIFFERENT active workspace skill (matched by `skill_name`), the import is blocked with the message "Purpose occupied by `{name}`". Re-importing a skill that already holds the target purpose (same name) does not trigger the conflict check.

**Activation behaviour**: activating a workspace skill that has a purpose automatically deactivates any other active skill holding the same purpose. Only one active skill per purpose at a time.

**Runtime resolution**: when the app needs a skill for a given purpose, it looks for an active workspace skill with a matching `purpose` value. If none is found, it falls back to the corresponding bundled skill.

**UI**: workspace skill rows show a purpose badge when a purpose is assigned. Purpose can be edited after import via `set_workspace_skill_purpose`.

---

## Skill Library

Skills in this layer are domain knowledge packages that live in the dashboard alongside built skills. They are immediately refinable and testable. They cannot be edited (no frontmatter edit form after import) and have no purpose concept.

**Two ways skills enter this layer:**

1. **Built** — created via the full workflow (Research → Decisions → Generation → Validation). Tracked in `workflow_runs` with `source='created'`.

2. **Marketplace import** (dashboard browse dialog or skill creation prompt) — scans the configured marketplace repo using the full recursive git tree. Filtered to domain-type skills (`skill_type` values: `domain`, `platform`, `source`, `data-engineering`). Downloads to `skills_path/`, inserts into `skills` master (`skill_source='marketplace'`) and `imported_skills`. Appears in the dashboard immediately.

A marketplace-imported skill is "already completed" — it skips the generation workflow entirely but is otherwise identical to a built skill for refinement and testing purposes.

**What you can do with a Skill Library skill after import:**
- **Refine** — open in the Refine page to tailor it to a specific context via conversation with an agent.
- **Test** — run it through the skill tester to compare plan quality with and without the skill.
- **Delete** — remove from the library and disk.

**What you cannot do:**
- Edit frontmatter metadata after import (no edit form on the dashboard card).
- Assign a purpose — purpose is a workspace-skills-only concept.

---

## Skill Creation Wizard

> **Implemented wizard UX**: The create wizard UI (step flow, ghost suggestions, field layout) is documented in [`plugin-v2-design/app.md`](../plugin-v2-design/app.md). This section covers the frontmatter metadata fields captured by the wizard and how they relate to the SKILL.md schema.

Skills built via the workflow go through a 4-step intake wizard:

1. **Basic info** — name (required) + description (required)
2. **Skill type** — `skill_type` field
3. **Behaviour** — `argument_hint`, `user_invocable`, `disable_model_invocation`
4. **Options** — model preference (skippable)

The frontmatter fields from the wizard are written into the generated SKILL.md, giving built skills the same metadata schema as marketplace-imported skills.

**Marketplace check**: when a marketplace URL is configured and the user starts creating a new skill, the wizard checks for matching skills in the marketplace and offers "Import and refine" before starting the research workflow.

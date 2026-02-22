# Skills Marketplace — Design Note

---

## Overview

The marketplace is a one-way import layer — skills flow in from a GitHub repo, never out. Two distinct populations of skills exist in the app, and the marketplace feeds both:

| | **Settings → Skills** | **Skill Library** |
|---|---|---|
| **Purpose** | App infrastructure — powers the workflow agents | Domain knowledge — skills users create, import, and refine |
| **Examples** | `research`, `validate-skill`, `skill-builder-practices` | Sales Pipeline Analytics, dbt Incremental Silver |
| **Storage** | `workspace_path/.claude/skills/` (agent workspace) | `skills_path/` (user-configured output directory) |
| **After import** | Wired into workspace CLAUDE.md — Claude Code loads the skill on every agent run. Active/inactive toggle moves the skill in and out of CLAUDE.md. | Appears in the dashboard as a completed skill. Immediately refinable — user can open it in the Refine page and tailor it to their specific context. |
| **DB tables** | `imported_skills` only | `imported_skills` + `workflow_runs` |

A data engineer installing a custom `research` skill in Settings→Skills is changing how the workflow itself runs. A data engineer importing a domain skill into the Skill Library is acquiring a finished knowledge package to deploy to their own Claude Code projects.

The `skill_type` frontmatter field drives the routing: `skill-builder` type skills belong in Settings→Skills; `domain`, `platform`, `source`, and `data-engineering` skills belong in the Skill Library.

---

## Settings → Skills

Skills in this layer are loaded into the agent workspace and wired into CLAUDE.md as custom skills. Claude Code reads them during agent runs. Changing what's here changes how the workflow behaves.

**Three ways skills enter this layer:**

1. **Bundled** — shipped with the app, seeded by `seed_bundled_skills` on startup. Always overwrite on seed; `is_active` state is preserved across re-seeds. Cannot be deleted — only deactivated.

2. **Marketplace import** (Settings→Skills browse dialog) — scans the configured marketplace repo, filtered to `skill_type='skill-builder'`. Downloads to `workspace_path/.claude/skills/`, inserts into `imported_skills` only. No dashboard entry.

3. **Zip upload** — extracts to `workspace_path/.claude/skills/`. Mandatory frontmatter: `name`, `domain`, `description`. Always forces `skill_type='skill-builder'` regardless of frontmatter.

**Active/inactive toggle** — deactivating moves the skill directory from `skills/` to `skills/.inactive/`. The DB is updated first; if the file move fails, the DB update is rolled back. CLAUDE.md is rebuilt after every toggle.

---

## Skill Library

Skills in this layer are the product of Skill Builder — domain knowledge packages that live alongside built skills in the dashboard and are immediately refinable.

**Two ways skills enter this layer:**

1. **Built** — created via the full workflow (Research → Decisions → Generation → Validation). Tracked in `workflow_runs` with `source='created'`.

2. **Marketplace import** (dashboard browse dialog or skill creation prompt) — scans the configured marketplace repo, filtered to domain-type skills. Downloads to `skills_path/`, inserts into both `imported_skills` and `workflow_runs` with `source='marketplace'`, `status='completed'`. Appears in the dashboard immediately and qualifies for refinement.

A marketplace-imported skill is "already completed" — it skips the generation workflow entirely but is otherwise identical to a built skill for refinement purposes.

---

## Registry Model

The marketplace is a GitHub repository — any repo where each subdirectory contains a `SKILL.md`. No catalog file is needed.

**Configuration**: A single `marketplace_url` setting in Settings → GitHub. Accepts:
- `owner/repo`
- `github.com/owner/repo`
- `https://github.com/owner/repo`
- `https://github.com/owner/repo/tree/branch/subpath`

**Default branch resolution**: `parse_github_url` defaults to `"main"` for URLs without an explicit branch. All three import functions (`list_github_skills`, `import_github_skills`, `import_marketplace_to_library`) call `get_default_branch` via the repos API after parsing to resolve the actual default — avoiding 404s on repos where the default branch is `"master"` or a custom name.

**Discovery**: `list_github_skills` fetches the full recursive git tree, finds all `SKILL.md` blob entries, downloads each one, parses frontmatter, and returns `AvailableSkill` records. If a `subpath` is configured, only entries under that path are included.

**Pre-marking**: Before showing the browse dialog, `get_all_installed_skill_names` queries a UNION of `workflow_runs` and `imported_skills` by skill name. Skills already in either table are shown as "In library" (greyed out) in the browse UI.

---

## Import Flow

The marketplace is the primary way Vibedata distributes skill templates to users. A user browses the configured repo, picks a domain skill, and imports it — it lands in their Skill Library as a completed skill, ready to refine against their specific context. No workflow needed; refinement is the starting point.


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
| `name` | Yes | Kebab-case identifier. Falls back to directory name if absent, but should always be set explicitly. Used as the primary key — two skills with the same name will conflict. |
| `description` | Yes | Shown in the browse dialog, Skill Library, and wired into the workspace CLAUDE.md so Claude Code knows when to invoke the skill. Should follow the trigger-pattern format: what it does, when to use it. |
| `domain` | Yes | The business or technical domain (e.g. `sales`, `dbt`, `fabric`). Shown as a badge in the skill list. |
| `skill_type` | Yes | Routes the skill to the right layer. `domain`, `platform`, `source`, `data-engineering` → Skill Library. `skill-builder` → Settings→Skills (app infrastructure). |
| `version` | No | Semantic version string. Stored for future update detection — not yet acted on by the app. |
| `model` | No | Preferred Claude model for this skill (`opus`, `sonnet`, `haiku`). Overrides the app default when the skill is invoked. |
| `argument-hint` | No | Short hint shown to the user when invoking the skill (e.g. `"dbt model name"`). Helps the user know what to pass. |
| `user-invocable` | No | `true` if the skill can be directly invoked by the user as a slash command. Defaults to `false`. |
| `disable-model-invocation` | No | `true` to hide the model selection UI for this skill. Use when the skill is tightly coupled to a specific model. |

**Zip upload**: `name`, `domain`, and `description` are mandatory — missing any returns an error listing the missing fields. Zip uploads always import into Settings→Skills regardless of `skill_type`.

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

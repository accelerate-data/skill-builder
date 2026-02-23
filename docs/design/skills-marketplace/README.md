# Skills Marketplace — Design Note

---

## Overview

The marketplace is a one-way import layer — skills flow in from a GitHub repo, never out. Two distinct populations of skills exist in the app, and the marketplace feeds both:

| | **Settings → Skills** | **Skill Library** |
|---|---|---|
| **Purpose** | App infrastructure — powers the workflow agents | Domain knowledge — skills users create, import, and refine |
| **Examples** | `research`, `validate-skill`, `skill-builder-practices` | Sales Pipeline Analytics, dbt Incremental Silver |
| **After import** | Wired into the agent workspace — Claude Code loads the skill on every agent run. Active/inactive toggle controls whether the skill is loaded. | Appears in the dashboard as a completed skill. Can be refined and tested. Cannot be edited or assigned a purpose. |

A data engineer installing a custom `research` skill in Settings→Skills is changing how the workflow itself runs. A data engineer importing a domain skill into the Skill Library is acquiring a finished knowledge package to deploy to their own Claude Code projects.

---

## Registry Model

**Configuration**: A single `marketplace_url` setting in Settings → GitHub. Accepts:
- `owner/repo`
- `github.com/owner/repo`
- `https://github.com/owner/repo`
- `https://github.com/owner/repo/tree/branch/subpath`

The configured URL is normalised on save. If no branch is specified, the repo's actual default branch is resolved at browse time — avoiding failures on repos where the default branch is not `main`.

**Discovery (Settings→Skills browse)**: The browse dialog reads `.claude-plugin/marketplace.json` at the root of the configured branch. The manifest lists plugins; each entry has a name and a source path pointing to a subdirectory in the repo, plus optional metadata (`description`, `version`, `author`, `category`, `tags`). Only path-based sources are listed — external package sources (npm, pip, url) are skipped. Each candidate path is then verified to contain a `SKILL.md`; entries without one are filtered out. This is the explicit gate that excludes plugin packages that live alongside skills in the repo but are not importable as skills. If a subpath is configured, only paths under that prefix are included.

**Discovery (Skill Library browse)**: The Skill Library browse scans the full repo tree and reads each `SKILL.md` individually — it does not use `marketplace.json`.

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
| `description` | No (Settings→Skills); Yes (Skill Library) | Shown in the browse dialog, Skill Library, and wired into the agent workspace so Claude Code knows when to invoke the skill. Should follow the trigger-pattern format: what it does, when to use it. |
| `domain` | No (Settings→Skills); Yes (Skill Library) | The business or technical domain (e.g. `sales`, `dbt`, `fabric`). Shown as a badge in the skill list. |
| `skill_type` | No | Categorises the skill (`domain`, `platform`, `source`, `data-engineering`, `skill-builder`). The Skill Library browse dialog filters to domain-type values. Settings→Skills browse shows all skills regardless of `skill_type`. |
| `version` | No | Semantic version string. Used to detect whether an update is available when re-importing a skill already in the app. |
| `model` | No | Preferred Claude model for this skill (`opus`, `sonnet`, `haiku`). Overrides the app default when the skill is invoked. |
| `argument-hint` | No | Short hint shown to the user when invoking the skill (e.g. `"dbt model name"`). Helps the user know what to pass. |
| `user-invocable` | No | `true` if the skill can be directly invoked by the user as a slash command. Defaults to `false`. |
| `disable-model-invocation` | No | `true` to hide the model selection UI for this skill. Use when the skill is tightly coupled to a specific model. |

**Zip upload**: `name`, `domain`, and `description` are mandatory — missing any returns an error listing the missing fields. Zip uploads always import into Settings→Skills regardless of `skill_type`.

---

## Shared Import Mechanics

These apply to both import destinations.

### Already-installed indicator

Before showing the browse dialog, the app checks which skills are already installed and marks them visually:

- **Skill Library**: checks only the Skill Library catalog — skills installed in Settings→Skills do not appear as already installed here.
- **Settings→Skills**: checks only the workspace skills list — Skill Library skills do not appear as already installed here.

In both cases, if a skill is already installed at the same version it shows an "Up to date" indicator and the import action is disabled. If a newer version is available in the marketplace it shows an "Update available" indicator and import is allowed — the existing skill is overwritten on disk while preserving its active state.

### Editable metadata at import

An edit form is shown pre-populated with the skill's frontmatter values. The user can modify `name`, `description`, `domain`, `skill_type`, `version`, and `model` before confirming.

The two destinations differ in when the edits are applied:
- **Skill Library**: confirming the edit form immediately triggers the import with the edited values.
- **Settings→Skills**: confirming saves the edits per-skill; they are applied when the user clicks the final Import button.

### Frontmatter rewrite on disk

After downloading, the `SKILL.md` frontmatter is rewritten on disk with the final values (including any user edits). Body content below the closing `---` is preserved. If the rewrite fails, the import is rolled back — the skill directory is removed, no record is created — and the error is surfaced to the user.

---

## Settings → Skills

Skills in this layer are loaded into the agent workspace and wired into CLAUDE.md as custom skills. Claude Code reads them during agent runs. Changing what's here changes how the workflow behaves.

**Three ways skills enter this layer:**

1. **Bundled** — shipped with the app and seeded on startup. Always updated on seed; active/inactive state is preserved across re-seeds. Cannot be deleted — only deactivated.

2. **Marketplace import** (Settings→Skills browse dialog) — reads `.claude-plugin/marketplace.json` from the configured repo. `skill_type` is not filtered at listing time; it is resolved from `SKILL.md` frontmatter at import time.

3. **Zip upload** — extracts from a ZIP archive. Always treated as a `skill-builder` type skill regardless of frontmatter.

**Active/inactive toggle** — deactivating a skill moves it out of the active skills directory. The skill remains installed but Claude Code no longer loads it. CLAUDE.md is rebuilt after every toggle.

### Import guards (name, version, purpose)

Settings→Skills imports pass through two sequential checks.

**Step 1 — Name + version (browse time)**

When the browse dialog loads, each candidate is compared against already-installed workspace skills:

| Condition | Indicator | Behaviour |
|---|---|---|
| Same name, same version | "Up to date" | Row dimmed, import disabled |
| Same name, different version | "Update available" | Importable — overwrites the existing skill on disk, preserving its active state |
| No name match | — | Importable normally |

**Step 2 — Purpose conflict (confirm time)**

After selecting skills, the user optionally assigns a purpose to each one. Before import is confirmed, the app checks whether the chosen purpose is already held by a different active skill. If so, import is blocked with "Purpose occupied by `{name}`". Re-importing the same skill (matched by name) that already holds that purpose does not trigger the conflict.

### Purpose slots

Each workspace skill may hold a **purpose** — a named role the app resolves at runtime to select which skill to use for a given function. Purpose is not written to frontmatter; it is stored separately and can be edited after import. Purpose applies only to Settings→Skills; Skill Library skills have no purpose concept.

**Bundled skill purposes** (set by the app, not editable):

| Skill | Purpose |
|---|---|
| `research` | `research` |
| `skill-builder-practices` | `skill-building` |
| `skill-test` | `test-context` |
| `validate-skill` | `validate` |

**Activation behaviour**: activating a skill that has a purpose automatically deactivates any other active skill holding the same purpose. Only one active skill per purpose at a time.

**Runtime resolution**: when the app needs a skill for a given purpose, it uses the active skill assigned to that purpose. If none is assigned, it falls back to the corresponding bundled skill.

---

## Skill Library

Skills in this layer are domain knowledge packages that live in the dashboard alongside built skills. They are immediately refinable and testable. They cannot be edited after import and have no purpose concept.

**Two ways skills enter this layer:**

1. **Built** — created via the full workflow (Research → Decisions → Generation → Validation).

2. **Marketplace import** (dashboard browse dialog or skill creation prompt) — scans the configured marketplace repo and filters to domain-type skills (`skill_type` values: `domain`, `platform`, `source`, `data-engineering`). The skill appears in the dashboard immediately as a completed skill. When a marketplace URL is configured and the user starts creating a new skill, the wizard checks for matching skills in the marketplace and offers "Import and refine" as an alternative to starting the research workflow from scratch.

A marketplace-imported skill is "already completed" — it skips the generation workflow entirely but is otherwise identical to a built skill for refinement and testing purposes.

**What you can do with a Skill Library skill after import:**
- **Refine** — open in the Refine page to tailor it to a specific context via conversation with an agent.
- **Test** — run it through the skill tester to compare plan quality with and without the skill.
- **Delete** — remove from the library and disk.

**What you cannot do:**
- Edit frontmatter metadata after import.
- Assign a purpose — purpose is a Settings→Skills-only concept.


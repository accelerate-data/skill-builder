# Skill Import from File

## Overview

Users can share skills by exporting them as `.skill` package files (via the download icon on each skill card). **Import from File** is the reverse: a user receives a `.skill` file and brings it into their Skill Library on the home page.

This mirrors the Marketplace flow but uses a local file instead of a GitHub registry. The imported skill is read-only (no workflow editing), stored in the `skills` master table with `source=imported`, and shown with an **Imported** badge.

---

## Entry Point

The Skill Library page (home page) gains a third button in the top-right action bar:

```
[ Marketplace ]  [ Import ]  [ + New Skill ]
```

"Import" sits between Marketplace and New Skill.

---

## User Flow

### Step 1 — Trigger

User clicks **Import**. A native file picker opens, filtered to `.skill` and `.zip` files. If the user cancels, nothing happens.

### Step 2 — Validation

Backend opens the file and checks it is a valid zip containing `SKILL.md`. If invalid:

- Dialog does not open
- Toast error: *"Import failed: not a valid skill package."*

### Step 3 — Metadata Review Dialog

A dialog titled **"Import Skill"** opens with fields pre-filled from the package's `SKILL.md` frontmatter:

| Field | Required | Pre-filled from |
|---|---|---|
| Name | Yes | `name` |
| Description | Yes | `description` |
| Version | Yes | `version` (defaults to `1.0.0` if absent) |
| Model | No | `model` (falls back to app default) |
| Argument Hint | No | `argument-hint` |
| User Invocable | No | `user-invocable` |
| Disable Model Invocation | No | `disable-model-invocation` |

The user can edit any field. **Confirm Import** is disabled until Name, Description, and Version are non-empty.

Dialog actions: **Confirm Import** (primary) | **Cancel**

### Step 4 — Conflict Check & Import

On Confirm, a loading state is shown. The backend checks for name conflicts:

| Existing skill source | Outcome |
|---|---|
| **skill-builder** or **Marketplace** | Inline error below the Name field: *"A skill named '{name}' already exists. Rename it before importing."* No overwrite is offered. |
| **Imported** (previously imported from file) | Confirmation prompt in dialog: *"A skill named '{name}' is already imported. Overwrite it?"* with **Overwrite** / **Cancel** actions. On Overwrite → proceeds. |
| Not found | Proceeds normally. |

On success:

- Skill files are extracted to the configured skills folder (`skills_path`)
- Skill appears in the Skill Library with an **Imported** badge, in completed state and ready to refine
- Toast: *Imported "skill-name"*

---

## Skill Naming and Storage

**Storage name**: taken from `name:` frontmatter only — the filename is never used as a fallback. Skills with no `name:` field are rejected at validation.

**Storage location**: `{skills_path}/{name}/` — the same folder used by Marketplace imports.

**`purpose`**: set to `domain` by the import flow, never read from the file.

---

## Skill Card After Import

Imported skill cards behave identically to Marketplace cards:

- 100% progress (complete state)
- Source badge: **Imported**
- Action icons: Edit details, Test, Refine, Download, Delete
- **No** Edit Workflow action (read-only, same as Marketplace)
- Filterable by "Imported" in the Source filter

---

## SKILL.md Frontmatter Reference

```yaml
---
name: my-skill
description: >
  What this skill teaches Claude and when to use it.
version: 1.0.0
model: sonnet
argument-hint: "key input or context"
user-invocable: true
disable-model-invocation: false
---
```

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Kebab-case. Authoritative skill name — filename never used as fallback. Missing = import rejected. |
| `description` | Yes | Shown in the import dialog; wired into `CLAUDE.md` so agents know when to invoke it. |
| `version` | Yes | Semver. Defaults to `1.0.0` if absent at import time. |
| `model` | No | Preferred Claude model. Overrides app default on invocation. |
| `argument-hint` | No | Hint shown when invoking as a slash command. |
| `user-invocable` | No | Whether the skill can be invoked as a slash command. |
| `disable-model-invocation` | No | Suppresses model selection UI. |

All other keys are silently ignored. `purpose` is set by the import flow, never read from the file.

---

## What This Feature Is Not

- Not for the Settings page "Upload Skill" (that's for workspace tools used by the skill builder)
- Not a way to publish skills back to the Marketplace
- Not bulk import (one file at a time)

---

## Relationship to Marketplace

| | Marketplace | Import from File |
|---|---|---|
| Source | GitHub registry | Local `.skill` file |
| Browse step | Registry browser | OS file picker |
| Metadata edit | Yes — same form | Yes — same form, pre-filled |
| DB storage | `skills` table, `source=marketplace` | `skills` table, `source=imported` |
| Storage location | `skills_path/{name}/` | `skills_path/{name}/` |
| Re-import behavior | Overwrites | Confirm → overwrites |
| Editable? | No | No |

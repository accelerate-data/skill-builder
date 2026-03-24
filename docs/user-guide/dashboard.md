# Dashboard

The dashboard is the app’s main working surface. It combines:

- a left-hand **Skills** list
- a main workspace area for the selected skill

If no skill is selected, the main area shows a simple empty state with **New Skill**.

---

## What is on this screen

### Left skill list

The left panel contains:

- a **New skill** button
- a search field
- skills grouped by plugin
- a per-skill **More actions** menu

Skills are organised under plugin headers. The default **Skills** plugin appears first, followed by other plugins in alphabetical order. Each plugin header shows the plugin display name in uppercase.

Each skill row shows:

- a status dot
- the skill name
- the purpose label when one exists
- the last-modified timestamp

Rows can be dimmed and locked when another window or running session owns that skill.

### Workspace area

When you select a skill on the dashboard route, the main area becomes a workspace shell with tabs:

- **Overview**
- **Refine**
- **Evals**
- **Description** (currently disabled)

Imported skills can be viewed in the workspace shell, but builder-only actions such as Refine are not always available.

---

## Create a skill

1. Click **New skill**.
2. Enter the skill name, purpose, and description.
3. Click **Next**.
4. Review the second step of the dialog.
5. Click **Create**.

The app navigates directly into the [workflow](workflow/overview.md) for the new skill.

---

## Search the skill list

Use the search field above the list. It filters the visible skill rows by name.

There is no grid/list toggle or multi-filter bar in the current dashboard UI.

---

## Open a skill

- Click an in-progress builder skill to open its [workflow](workflow/overview.md).
- Click a completed skill to open its workspace shell on the dashboard route.

The workspace shell is the current home for **Overview**, **Refine**, and **Evals**.

---

## Use the skill menu

Hover a row and open **More actions** to access available actions.

### Completed builder skills

The menu is grouped into sections:

**Workflow**

- **Review** — open the workflow in review mode
- **Redo workflow** — reset back to step 1 and start over

**Skill**

- **Overview** — open the workspace Overview tab
- **Refine** — open the workspace Refine tab
- **Restore version** — restore an earlier saved version

**Plugin** (hidden for marketplace skills)

- **Create plugin** — create a new plugin and move this skill into it (shown when the skill is in the default plugin)
- **Remove from plugin** — move the skill back to the default plugin (shown when the skill is in a non-default plugin)
- **Move to plugin** — move the skill to a different existing plugin (shown when other eligible plugins exist)

**Delete** — only shown for skills in the default plugin.

See [Plugins](plugins.md) for full details on plugin actions.

### In-progress builder skills

These show:

- **Continue Building**
- **Delete** (when in the default plugin)

### Imported or marketplace skills

These use the same workspace shell. Plugin actions are not available for marketplace-source skills.

---

## Overview tab

The **Overview** tab shows the selected skill’s metadata and history.

For builder skills, it can include:

- **Skill Details**
- **Benchmark Results** when a benchmark exists
- **Version History**

For marketplace skills, the source can appear as the marketplace URL.

---

## Empty and locked states

**No selected skill**

The main area shows:

- `Select a skill`
- `Choose a skill from the list to open its workspace, or create a new one.`

**Locked skill**

If another running session or another app window owns a skill, its row is dimmed and not selectable.

# Dashboard

The Dashboard is the home screen. It lists all your skills and is where you create, import, and manage them.

---

## What's on this screen

**Top bar** (visible when workspace and skills folder are configured)
- **Marketplace** button — browse and import skills from GitHub-hosted registries
- **New Skill** button — opens the skill creation dialog

**Filter and view bar** (visible when at least one skill exists)
- Search field — filters by name, description, or type as you type
- **Tags** dropdown — filter by one or more tags
- **Type** dropdown — filter by purpose (e.g. Process, Domain Knowledge)
- **Source** dropdown — filter by Skill Builder, Marketplace, or Imported
- **Status** dropdown — filter by All, Completed, or In Progress
- View toggle — switch between Grid and List view

**Skill cards (grid view)** — each card shows name, purpose badge, source badge, tags, and a progress bar.

**Skill table (list view)** — sortable columns: Name, Source, Status, Updated. Click any column header to sort; click again to reverse.

---

## How to create a skill

1. Click **New Skill**.
2. Fill in **Skill Name** (use lowercase with hyphens, e.g. `sales-pipeline`), **Description**, and **What are you trying to capture?** (the purpose). Tags are optional.
3. The Description field shows a ghost suggestion once name and purpose are filled — press **Tab** to accept it.
4. Click **Next**.
5. On Step 2, optionally adjust Version, Model, Argument Hint, and toggles. Defaults are pre-filled.
6. Click **Create**. The app opens the skill workflow.

---

## How to import from Marketplace

1. Click **Marketplace**. The Browse Marketplace dialog opens with one tab per enabled registry.
2. Each skill row shows its name, description, version, and an install or update icon.
3. Click the download icon (new install) or refresh icon (update available) for the skill you want.
4. In the **Edit & Import Skill** dialog, review or edit the name and description. Version is required.
5. Click **Confirm Import**. The skill appears on the dashboard with a **Marketplace** badge.

> **Marketplace button disabled?** Go to **Settings → Marketplace** and enable at least one registry.

---

## How to search and filter

- Type in the search field to filter by name, description, or type. Results update in real time.
- Click **Tags**, **Type**, **Source**, or **Status** to open the dropdown. Check or uncheck options. A count badge appears on the button when a filter is active.
- Click **Clear all** inside a dropdown to reset that filter.

---

## How to open or continue a skill

- **Click** any card or row to open the skill.
  - Skills built with Skill Builder open in the workflow (review mode).
  - Marketplace skills open in the Refine page.

---

## How to edit a skill's details

- **Grid view** — right-click a card and select **Edit details**.
- **List view** — click the **⋯** button on the row and select **Edit details**.
- The Edit Skill dialog opens. Name, purpose, and tags are locked after a skill has been built.
- Click **Next**, then **Save**.

---

## How to refine a completed skill

Click the chat bubble icon on any completed skill card or row. This opens the [Refine](refine.md) page for that skill.

---

## How to test a skill

Click the flask icon on any completed skill card or row. This opens the [Test](test.md) page for that skill.

---

## How to download a skill

1. Click the download icon on a completed skill (only visible on completed skills).
2. A **Packaging skill...** toast appears.
3. A save dialog opens with a default filename of `[skill-name].skill`. Choose a location and click **Save**.

---

## How to delete a skill

1. Click the trash icon on a card or row.
2. The Delete Skill dialog shows: *"Are you sure you want to delete [name]? This will permanently remove all files for this skill."*
3. Click **Delete** to confirm, or **Cancel** to dismiss.

---

## States

**No skills yet**
Shows a centered card: *"No skills yet — Skills are knowledge packages that teach Claude your team's specific processes, systems, and standards."* A **New Skill** button appears if the workspace is configured.

**Skills folder not configured**
An amber banner appears: *"Skills folder not configured."* The **New Skill** and **Marketplace** buttons are hidden. Click **Settings** in the banner to configure the folder.

**No results from filter**
Shows: *"No matching skills — Try a different search term or clear your filters."*

**Locked skill**
A skill being edited in another window is dimmed and shows a lock icon. You cannot delete or edit it until the other window is closed.

# Getting Started

## First-time setup

The setup screen appears on first launch. You need two things before you can build skills.

**How to complete setup**

1. Enter your Anthropic API key in the **Anthropic API Key** field (starts with `sk-ant-`). A link to the Anthropic console is shown below the field if you need to create a key.
2. Click **Test** to confirm the key is valid. The button changes to **Valid** when accepted.
3. Review the **Skills Folder** path. This is where finished skill files are saved. Click **Browse** to choose a different folder.
4. Click **Get Started**. The button is disabled until both fields have values.

---

## What happens at startup

After the setup screen (or on subsequent launches), the app performs several background tasks before showing the dashboard.

### Splash screen

A brief splash screen appears while the app initializes the agent sidecar. It dismisses automatically once the sidecar is ready.

### Startup reconciliation

The app scans the workspace and skills folder for changes that may have occurred outside the app (for example, files added or removed manually). If the app detects changes, a **Startup Reconciliation** dialog appears.

- The dialog lists notifications describing what was found (e.g. discovered skills, missing artifacts).
- **Discovered skills** appear as individual rows. For each one, you can choose to **Import** (add it to the app's tracking) or **Delete** (remove the files).
- Click **Apply** to accept the reconciliation, or **Skip** to dismiss without changes. Skipping means no automatic changes are applied — you can resolve issues manually later.

### Orphan resolution

If the app finds skills tracked in its database that no longer have matching files on disk, an **Orphan Resolution** dialog appears. For each orphaned skill you can choose:

- **Keep** — Reset the skill to its initial state (preserves the database record).
- **Delete** — Remove the skill record from the database.

### Marketplace updates

If you have enabled marketplace registries in [Settings](settings.md), the app checks for available skill updates at startup.

- **Auto-update on:** Non-customized skills are updated silently. A summary toast lists what was updated. Skills you have edited after importing are never auto-updated.
- **Auto-update off:** Notification toasts appear for available updates with an **Upgrade** button. Clicking the button navigates to the appropriate screen (Dashboard for library skills, Settings → Skills for workspace skills).

---

## What's in the app

| Screen | What you do there |
|---|---|
| [Dashboard](dashboard.md) | Create, manage, and import skills |
| [Workflow](workflow/overview.md) | Build a skill step by step with AI agents |
| [Refine](refine.md) | Chat with an agent to edit a finished skill |
| [Test](test.md) | Compare how Claude behaves with and without a skill |
| [Settings](settings.md) | Configure API key, model, GitHub, and workspace |
| [Usage](usage.md) | View cost and token usage |

---

## Quick concepts

**Skill** — A knowledge package (a `SKILL.md` file plus optional reference files) that teaches Claude your team's specific processes, terminology, and standards.

**Skill source** — Where a skill came from:

- **Skill Builder** — built by you using the workflow
- **Marketplace** — imported from a GitHub-hosted registry
- **Imported** — imported from a `.skill` package file

**Workspace** — A local app-managed folder (`app_local_data_dir()/workspace`) where agent working files and logs are kept. Skills are saved separately in your Skills Folder.

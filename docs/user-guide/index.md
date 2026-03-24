# Getting Started

## First-time setup

On first launch, Skill Builder opens a setup screen. You need:

1. An Anthropic API key
2. A Skills Folder path

**How to complete setup**

1. Enter your API key in **Anthropic API Key**.
2. Click **Test** to validate it. The button changes to **Valid** after a successful check.
3. Review the **Skills Folder**. This is where completed skills are saved. Click **Browse** to change it.
4. Click **Get Started**.

The button is enabled when both fields have values. Validation is recommended but not required to continue.

---

## What happens at startup

Before the main UI appears, the app may show a few startup surfaces:

### Splash screen

A splash screen appears while the Node sidecar is initialized.

### Startup reconciliation

If Skill Builder detects changes on disk that are not reflected in its database, it shows **Startup Reconciliation**.

- Notifications summarize what changed.
- Discovered skills must be resolved one by one.
- For each discovered skill you can choose **Add to Library** or **Remove**.
- When the dialog requires changes to be applied, the footer actions are **Continue Without Applying** and **Apply Reconciliation**.

### Orphaned skills

If the database still references builder skills whose workspace files are gone, the app shows **Orphaned Skills Found**.

- **Keep** preserves the record and resets that skill back to step 0.
- **Delete** removes the orphaned record.

---

## App layout

The app has three primary surfaces:

| Surface | What it does |
|---|---|
| [Dashboard](dashboard.md) | Shows the skill list and, when a skill is selected, its workspace tabs |
| [Workflow](workflow/overview.md) | Runs the 4-step builder flow for Skill Builder skills |
| [Settings](settings.md) | Holds app configuration, plugins, marketplace settings, GitHub, and usage |

Two important areas are embedded inside those surfaces rather than being standalone routes:

- [Plugins](plugins.md) explains how skills are grouped into plugins.
- [Refine](refine.md) is a workspace tab on the dashboard for builder skills.
- [Evals](test.md) is also a workspace tab, but it is currently a placeholder.
- [Usage](usage.md) lives in **Settings → Usage**.

---

## Quick concepts

**Skill** — A `SKILL.md` file plus optional `references/*.md` files. Every skill belongs to exactly one [plugin](plugins.md).

**Plugin** — A named group of related skills. The app creates a default **Skills** plugin automatically. You can create additional plugins to organise skills into logical bundles. See [Plugins](plugins.md).

**Skill source**

- **Skill Builder**: built in the workflow
- **Marketplace**: imported from a GitHub-backed registry
- **Imported**: uploaded from a package file

**Workspace** — The app-managed working area for builder runs, refine sessions, and related artifacts. Completed skills are saved separately in your Skills Folder.

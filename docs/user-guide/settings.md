# Settings

Access Settings from the gear icon in the header or by pressing **Cmd+,** (Mac) / **Ctrl+,** (Windows/Linux). Changes take effect immediately unless noted.

Settings are organized into six tabs: General, Marketplace, Skill Building, Skills, GitHub, and Advanced.

---

## General

### API Configuration

**Anthropic API Key** — Enter your API key (starts with `sk-ant-`). Click **Test** to validate it. The button changes to **Valid** when the key is accepted. The key is stored locally and never transmitted except to the Anthropic API.

### User Profile

**Industry** — Describe your industry (e.g. *Financial Services, Healthcare, Retail*). Agents use this to tailor their research.

**Function / Role** — Describe your role (e.g. *Analytics Engineer, Data Platform Lead*).

### Appearance

**Theme** — Choose **System**, **Light**, or **Dark**.

The current app version is shown at the bottom of this section.

---

## Marketplace

### Registries

A table of GitHub repositories used as skill sources. Each row shows the repository identifier, an **Enabled** toggle, a connectivity test icon, and a delete button (built-in registries cannot be removed).

**How to add a registry**

1. Click **Add registry**.
2. Enter a repository identifier in the format `owner/repo` or `owner/repo#branch` (e.g. `acme/skill-library` or `acme/skill-library#dev`).
3. Click **Add**. The app fetches the registry's `marketplace.json` to validate it. On success, the registry appears in the table.
4. Click **Cancel** to dismiss without adding.

**How to enable or disable a registry**
Toggle the **Enabled** switch on the registry row. Disabled registries are excluded from Marketplace browsing.

**How to remove a registry**
Click the trash icon on the row. Built-in registries have no trash icon and cannot be removed.

### Auto-update

Toggle **Automatically apply updates from all enabled registries at startup** to have the app pull registry updates each time it launches. When enabled, the app silently updates non-customized skills from all enabled registries and shows a summary toast listing what was updated. Customized skills (those you have edited after importing) are never auto-updated.

When auto-update is off, the app shows notification toasts for available updates with an **Upgrade** action button instead.

---

## Skill Building

### Model

Select the Claude model used for all workflow agents.

| Option | Best for |
|---|---|
| Haiku — fastest, lowest cost | Quick iteration |
| Sonnet — balanced (default) | Most use cases |
| Opus — most capable | Complex domains |

### Agent Features

**Extended thinking (deeper reasoning)** — Toggle on to enable deeper reasoning for agents. Increases cost by approximately $1–2 per skill build.

**Interleaved thinking beta** — When extended thinking is enabled, this toggle enables interleaved thinking on supported non-Opus models.

**Reasoning effort** — Controls how much reasoning effort the SDK applies. Options range from low to high. Leave empty to use the default.

**Refine prompt suggestions** — Toggle on to enable SDK prompt suggestions during refine chat sessions.

### Research Scope Limit

**Max dimensions** — Controls how broadly the research agent explores your domain (range 1–18).

| Range | Label |
|---|---|
| 1–3 | Narrow focus |
| 4–5 | Balanced (default) |
| 6–8 | Broad research |
| 9+ | Very broad |

---

## Skills

The Skills tab manages workspace skills — skills that are available as agent context during skill building.

### Importing workspace skills

- **From GitHub** — Click the GitHub icon button to open the marketplace import dialog. Select skills from an enabled registry to add to the workspace.
- **From file** — Click the upload icon button to import a `.skill` or `.zip` package from disk.

> The GitHub import button is disabled when no marketplace registry is enabled. Enable one in the Marketplace tab first.

### Skill list

Each workspace skill row shows:

- **Active toggle** — Enable or disable the skill for agent context. Disabled skills remain in the workspace but are not used during builds.
- **Purpose selector** — Assign a purpose that describes how agents should use this skill. Click the dropdown and choose one of four options:
  - **Skill Test** — Testing and validation of individual components or techniques
  - **Research** — Exploring domains, gathering information, or benchmarking
  - **Validate** — Checking assumptions, verifying outputs, or quality assurance
  - **Skill Standards** — Building domain-specific, production-grade skills
- **Source badge** — Shows where the skill came from (Marketplace or Imported).
- **Delete button** — Removes the skill from the workspace.

If a skill has no purpose set, it displays as *"Set purpose…"*. To clear a purpose, select **Clear** in the dropdown.

---

## GitHub

### GitHub Account

Shows your connected GitHub account avatar and username when signed in.

**How to connect GitHub**

1. Click **Sign in with GitHub**.
2. A device code appears in the dialog. Click the copy icon to copy it.
3. Click **Open GitHub**. Your browser opens `github.com/login/device` and the app begins polling.
4. Paste the code on GitHub and authorize the application.
5. The dialog shows *"Signed in successfully"* and closes automatically.

**How to disconnect GitHub**
Click **Sign Out** next to your account name.

---

## Advanced

### Logging

**Log Level** — Controls what is written to the log file.

| Level | What is logged |
|---|---|
| Error | Only errors |
| Warn | Errors and warnings |
| Info | Errors, warnings, and lifecycle events (default) |
| Debug | Everything (verbose) |

The current log file path is shown below the dropdown.

### Storage

| Field | What it is | Action |
|---|---|---|
| **Skills Folder** | Where finished skill files are saved | **Browse** to change |
| **Workspace Folder** | Where agent working files and logs are kept | **Clear** to reset bundled agent files (does not delete skills or workflow data) |
| **Data Directory** | App database location | Read-only |

> Clearing the workspace resets bundled agent files only. Your skills and workflow progress are not affected.

### About

Click **About Skill Builder** to see the app version, links, and license.

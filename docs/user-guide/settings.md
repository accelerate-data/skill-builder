# Settings

Access Settings from the sidebar. Changes take effect immediately unless noted.

---

## General

### API Configuration

**Anthropic API Key** — Enter your API key (starts with `sk-ant-`). Click **Test** to validate it. The button changes to **Valid** when the key is accepted. The key is stored locally and never transmitted except to the Anthropic API.

### User Profile

**Industry** — Describe your industry (e.g. *Financial Services, Healthcare, Retail*). Agents use this to tailor their research.

**Function / Role** — Describe your role (e.g. *Analytics Engineer, Data Platform Lead*).

### Appearance

**Theme** — Choose **System**, **Light**, or **Dark**.

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

### Research Scope Limit

**Max dimensions** — Controls how broadly the research agent explores your domain (range 1–18).

| Range | Label |
|---|---|
| 1–3 | Narrow focus |
| 4–5 | Balanced (default) |
| 6–8 | Broad research |
| 9+ | Very broad |

---

## Skills Library

### Purpose Selector

Each skill in your library can be assigned a **purpose**, which describes the skill's intended use. Click the purpose field next to a skill to open a dropdown and select one of four options:

- **Skill Test** — Testing and validation of individual components or techniques
- **Research** — Exploring domains, gathering information, or benchmarking
- **Validate** — Checking assumptions, verifying outputs, or quality assurance
- **Skill Standards** — Building domain-specific, production-grade skills

If a skill has no purpose set, it displays as "Set purpose…". Click the dropdown and choose a purpose, or if a purpose is already set, select **Clear** to remove it.

---

## Marketplace

### Registries

A table of GitHub repository URLs used as skill sources. Each row shows the URL, an **Enabled** toggle, a connectivity test icon, and a delete button (built-in registries cannot be removed).

**How to add a registry**

1. Click **Add registry**.
2. Enter a GitHub URL (e.g. `https://github.com/owner/skill-library`) in the **GitHub URL** field.
3. Click **Add**. The app fetches the registry's `marketplace.json` to validate it. On success, the registry appears in the table.
4. Click **Cancel** to dismiss without adding.

**How to enable or disable a registry**
Toggle the **Enabled** switch on the registry row. Disabled registries are excluded from Marketplace browsing.

**How to remove a registry**
Click the trash icon on the row. Built-in registries have no trash icon and cannot be removed.

### Auto-update

Toggle **Automatically apply updates from all enabled registries at startup** to have the app pull registry updates each time it launches.

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

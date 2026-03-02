# Getting Started

## First-time setup

The setup screen appears on first launch. You need two things before you can build skills.

**How to complete setup**

1. Enter your Anthropic API key in the **Anthropic API Key** field (starts with `sk-ant-`).
2. Click **Test** to confirm the key is valid. The button changes to **Valid** when accepted.
3. Review the **Skills Folder** path. This is where finished skill files are saved. Click **Browse** to choose a different folder.
4. Click **Get Started**. The button is disabled until both fields have values.

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

**Workspace** — A local folder (`~/.vibedata/` by default) where agent working files and logs are kept. Skills are saved separately in your Skills Folder.

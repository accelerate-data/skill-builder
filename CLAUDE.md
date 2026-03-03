@AGENTS.md

## Adapter Role

`AGENTS.md` is canonical for repository-wide guidance. This file is an adapter for Claude-specific routing and should stay lightweight.

## Delegation Policy

### Model tiers

| Tier | Model | When |
|---|---|---|
| Reasoning | sonnet | Planning, architecture, requirements drafting |
| Implementation | default | Coding, exploration, review, merge |
| Lightweight | haiku | Linear API calls, AC checkoffs, status updates |

### Sub-agent rules

Commit + push before reporting completion.

## Custom Skills

### /create-linear-issue

When the user runs /create-linear-issue or asks to create a Linear issue, log a bug, file a ticket,
track a feature idea, break down a large issue, or decompose an issue into smaller ones
(e.g. "break down VU-123", "decompose VU-123", "split VU-123"),
read and follow the skill at `.claude/skills/create-linear-issue/SKILL.md`.

Default project: **Skill Builder** — use this project unless the user specifies otherwise.

### /implement-linear-issue

When the user runs /implement-linear-issue, or mentions a Linear issue identifier (e.g. "VU-123"), or asks to implement, build, fix, or work on a Linear issue,
read and follow the skill at `.claude/skills/implement-linear-issue/SKILL.md`.

### /close-linear-issue

When the user runs /close-linear-issue, or asks to close, complete, merge, or ship a Linear issue,
read and follow the skill at `.claude/skills/close-linear-issue/SKILL.md`.

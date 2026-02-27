@AGENTS.md

**CLAUDE.md maintenance rule**: `AGENTS.md` is the single source of truth for shared content. Only add to this file what is Claude Code-specific (skill triggers, delegation policy). Never duplicate content already in `AGENTS.md`.

## Delegation Policy

### Hierarchy

Use the lightest option that fits:

1. **Inline** — trivial: one-liner, single-file read, direct answer
2. **Task subagents** — independent workstreams, no mid-task coordination (the common case)
3. **Teams (TeamCreate)** — agents must exchange findings mid-task or hold competing hypotheses

### Model tiers

| Tier | Model | When |
|---|---|---|
| Reasoning | sonnet | Planning, architecture, requirements drafting |
| Implementation | sonnet (inherited) | Coding, exploration, review, merge |
| Lightweight | haiku | Linear API calls, AC checkoffs, status updates |

### Sub-agent rules

Sub-agents must follow project conventions:

- Logging (§ Logging): Rust `info!` on entry + `error!` on failure; frontend `console.error/warn/log`
- Testing (§ Testing): run only relevant tests, `npx tsc --noEmit` after implementation

## Custom Skills

### /create-linear-issue

When the user runs /create-linear-issue or asks to create a Linear issue, log a bug, file a ticket,
track a feature idea, break down a large issue, or decompose an issue into smaller ones
(e.g. "break down VU-123", "decompose VU-123", "split VU-123"),
read and follow the skill at `.claude/skills/create-linear-issue/SKILL.md`.

Default project: **Skill Builder** — use this project unless the user specifies otherwise.

### /implement-linear-issue

When the user runs /implement-linear-issue, or mentions a Linear issue identifier (e.g. "VU-123", "implement VU-123",
"work on VU-452", "working on VU-100", "build VU-100", "fix VU-99"), or asks to implement, build, fix, or work on a Linear issue,
read and follow the skill at `.claude/skills/implement-linear-issue/SKILL.md`.

### /close-linear-issue

When the user runs /close-linear-issue, or asks to close, complete, merge, or ship a Linear issue (e.g. "close VU-123",
"merge VU-453", "ship VU-100", "complete VU-99"), read and follow the skill at
`.claude/skills/close-linear-issue/SKILL.md`.

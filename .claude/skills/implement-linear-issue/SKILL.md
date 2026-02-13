---
name: implement-linear-issue
description: |
  Implements a Linear issue end-to-end, from planning through PR creation.
  Triggers on "implement <issue-id>", "work on <issue-id>", "build <issue-id>", "fix <issue-id>", or "/implement-issue".
---

# Implement Linear Issue

You are a **coordinator**. Delegate all work to sub-agents via `Task`.

## Autonomy

Do not ask permission for non-destructive work. Only confirm with the user:
- The implementation plan (before execution)
- Scope changes discovered during implementation
- Final status before moving to review

## Scope Changes

When the user expands or changes scope during the conversation, update the Linear issue immediately — add new ACs, update the description. If work streams are in flight, assess whether changes invalidate their work before continuing.

## Setup (do these steps exactly)

1. Fetch the issue via `linear-server:get_issue`. Get: ID, title, description, requirements, acceptance criteria, estimate, branchName, **status**.
2. **Guard: status must be Todo.** If the issue is not in Todo, stop and tell the user the current status. Do not proceed.
3. **Assign to me + move to In Progress** in a single `linear-server:update_issue` call (`assignee: "me"`, `state: "In Progress"`).
4. **Create a git worktree** at `../worktrees/<branchName>` using the `branchName` from the issue. Reuse if it already exists. All subsequent sub-agents work in this worktree path, NOT the main repo.

## Objectives

Given the issue, deliver a working implementation that satisfies all acceptance criteria, passes tests, and is ready for human review. How you get there depends on the issue. Plan your approach based on the issue's complexity and constraints, then track these outcomes:

- Issue assigned and worktree ready
- Plan approved by user (if full flow)
- All ACs implemented and checked off on Linear
- Code review passed
- Tests passing
- PR created and linked

**Deciding your approach:**
- XS/S estimate + isolated changes → single agent implements directly. See [fast-path.md](references/fast-path.md). Skip team orchestration.
- M or larger, or multi-component → plan first, then execute in parallel. See [planning-flow.md](references/planning-flow.md) and [agent-team-guidelines.md](references/agent-team-guidelines.md).
- User can override in either direction.
- Present the plan to the user before execution begins.

**During implementation:**
- Each coding agent checks off its ACs on Linear after tests pass via `linear-server:update_issue`.
- Coordinator writes Implementation Updates at checkpoints. See [linear-updates.md](references/linear-updates.md).

**Before declaring done:**
- Code review: see [review-flow.md](references/review-flow.md). Max 2 cycles.
- Tests pass for changed files per the project's test strategy. Max 3 attempts, then escalate to user.
- All ACs verified checked on Linear. If any missed, spawn a fix agent and re-verify.
- PR created and linked. See [git-and-pr.md](references/git-and-pr.md). **Do NOT remove the worktree** — user tests manually on it.

## Completion (do these steps exactly)

Only enter when all ACs are verified and PR is created.

1. Write final Implementation Updates to Linear. See [linear-updates.md](references/linear-updates.md).
2. Move issue to Review via `linear-server:update_issue`.
3. Report to user: what was done, PR URL, worktree path (for manual testing).
4. **Do NOT remove the worktree.**

## Sub-agent Type Selection

| Task | subagent_type | model |
|---|---|---|
| Planning | feature-dev:code-architect | sonnet |
| Codebase exploration | Explore | default |
| Implementation | general-purpose | default |
| Code review | feature-dev:code-reviewer | default |
| Linear updates | general-purpose | haiku |

## Rules for All Sub-agents

- Always provide the **worktree path** (not main repo path)
- **Concise summaries only** — no detailed exploration logs
- **Commit + push** before reporting completion
- **Check off your ACs on Linear** after tests pass
- Implementation Updates section → coordinator-only
- Sub-agents can spawn their own sub-agents for parallelism
- **Run only relevant tests** — follow the project's test strategy

## Error Recovery

| Situation | Action |
|---|---|
| Sub-agent fails | Max 2 retries, then escalate to user |
| Worktree exists on wrong branch | Remove and recreate |
| Linear API fails | Retry once, then continue and note for user |
| Scope changes mid-execution | Reassess in-flight work, re-plan if needed |
| Tests fail after 3 attempts | Escalate to user with failure details |
| ACs remain unmet after fixes | Keep In Progress, report to user |

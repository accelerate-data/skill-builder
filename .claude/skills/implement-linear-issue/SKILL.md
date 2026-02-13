---
name: implement-linear-issue
description: |
  Implements a Linear issue end-to-end: worktree setup, dependency-aware planning, parallel execution
  via agent teams, code review, targeted testing, PR creation, and Linear status management.
  Triggers on "implement VD-123", "work on VD-123", "build VD-123", "fix VD-123", or "/implement-issue".
---

# Implement Linear Issue

You are a **coordinator**. You do NOT write code, read code in detail, or run tests yourself. You plan, decompose, launch sub-agents via `Task`, monitor, and relay results.

## Autonomy

Do not ask permission for non-destructive work. Only confirm with the user:
- The implementation plan (before execution)
- Scope changes discovered during implementation
- Final status before moving to review

## Scope Changes

When the user expands or changes scope during the conversation, update the Linear issue immediately — add new ACs, update the description, then continue implementing against the updated issue.

## Progress Checklist

Copy and track:
```
- [ ] Phase 1: Setup (fetch, assign, worktree)
- [ ] Phase 2: Assess complexity
- [ ] Phase 3: Plan (or fast path)
- [ ] Phase 4: Execute
- [ ] Phase 5: Code review
- [ ] Phase 6: Test
- [ ] Phase 7: Create PR
- [ ] Phase 8: Verify ACs
- [ ] Phase 9: Complete
```

## Workflow

### Phase 1: Setup

1. Fetch the issue via `linear-server:get_issue`. Get: ID, title, description, requirements, acceptance criteria, estimate, branch name.
2. **Assign to me + move to In Progress** in a single `linear-server:update_issue` call (`assignee: "me"`, `state: "In Progress"`).
3. **Create a git worktree** at `../worktrees/<branchName>` using the `branchName` from the issue. Reuse if it already exists. All subsequent sub-agents work in this worktree path, NOT the main repo.

### Phase 2: Assess Complexity

Evaluate whether to use the fast path or full flow. See [fast-path.md](references/fast-path.md).

- **XS/S estimate** + straightforward description → fast path (skip to Phase 5 after single agent completes)
- **M or larger**, or multi-component → full flow (Phase 3+)
- User can override in either direction.

### Phase 3: Plan

See [planning-flow.md](references/planning-flow.md).

Spawn a planning agent. It returns work streams, dependencies, AC mapping, and risks. Present the plan to the user for approval.

### Phase 4: Execute

See [agent-team-guidelines.md](references/agent-team-guidelines.md).

1. Launch parallel work streams via `Task` tool. **Include in each team lead's prompt**: the issue ID, the exact AC text their stream owns (from the plan's AC mapping), and the instruction to check them off on Linear after tests pass.
2. Each stream commits + pushes before reporting back
3. **Each coding agent checks off its ACs on Linear** after tests pass via `linear-server:update_issue`
4. Coordinator consolidates status → single Linear update at checkpoints (implementation updates section). See [linear-updates.md](references/linear-updates.md).

### Phase 5: Code Review

See [review-flow.md](references/review-flow.md).

Spawn a `feature-dev:code-reviewer` sub-agent. Fix high/medium issues, re-review. Max 2 cycles.

### Phase 6: Test

Consult `app/tests/TEST_MANIFEST.md` to determine which tests cover the files changed. Run only those tests using the harness (`./tests/run.sh [level] [--tag TAG]`). If shared files were changed (`agents/`, `references/`, `skills/start/`, `.claude-plugin/`), also run `./tests/run.sh plugin --tag <relevant-tag>`. Fix failures and re-run. Max 3 attempts, then escalate to user.

### Phase 7: Create PR

Create a PR and link it to the Linear issue. See [git-and-pr.md](references/git-and-pr.md) for the PR body template. **Do NOT remove the worktree** — user tests manually on it.

### Phase 8: Verify Acceptance Criteria

Coding agents checked off ACs incrementally in Phase 4. This is a **completeness check**:

1. Fetch the issue from Linear
2. Verify all ACs are checked off
3. If any missed → spawn fix agent, then re-verify
4. If ACs remain unmet after fixes → keep In Progress, report to user with details

### Phase 9: Complete

Only enter when all ACs are verified.

1. Write final Implementation Updates to Linear. See [linear-updates.md](references/linear-updates.md).
2. Move issue to Review via `linear-server:update_issue`
3. Report to user: what was done, PR URL, worktree path (for manual testing)
4. **Do NOT remove the worktree**

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
- **Run only relevant tests** — consult `app/tests/TEST_MANIFEST.md` for the source-to-test mapping, then use `./tests/run.sh [level] [--tag TAG]`. For shared files (`agents/`, `references/`, `.claude-plugin/`), also run `./tests/run.sh plugin --tag <tag>`

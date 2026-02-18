---
name: implement-linear-issue
description: |
  Implements a Linear issue end-to-end, from planning through PR creation.
  Triggers on "implement <issue-id>", "work on <issue-id>", "working on <issue-id>", "build <issue-id>", "fix <issue-id>", or "/implement-issue".
  Also triggers when the user simply mentions a Linear issue identifier (e.g. "VD-123").
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
2. **Guard on status:**
   - **Done / Cancelled / Duplicate** → Stop and tell the user. Do not proceed.
   - **Todo** → Assign to me + move to In Progress via `linear-server:update_issue` (`assignee: "me"`, `state: "In Progress"`).
   - **In Progress** → Already active. Skip status change (assign to me if unassigned). Resume work.
   - **In Review** → Move back to In Progress via `linear-server:update_issue`. Resume work — likely addressing review feedback or continuing the pipeline.
3. **Create a git worktree** at `../worktrees/<branchName>` using the `branchName` from the issue. Reuse if it already exists. All subsequent sub-agents work in this worktree path, NOT the main repo.

## Objectives

Given the issue, deliver a working implementation that satisfies all acceptance criteria, passes tests, and is ready for human review. How you get there depends on the issue. Plan your approach based on the issue's complexity and constraints, then track these outcomes:

- Issue assigned and worktree ready
- Plan approved by user (if full flow)
- All ACs implemented and checked off on Linear
- Tests passing
- Code simplified and clean
- Code review passed
- Documentation updated
- PR created and linked

**Deciding your approach:**
- XS/S estimate + isolated changes → single agent implements directly. See [fast-path.md](references/fast-path.md). Skip team orchestration.
- M or larger, or multi-component → plan first, then execute in parallel. See [planning-flow.md](references/planning-flow.md) and [agent-team-guidelines.md](references/agent-team-guidelines.md).
- User can override in either direction.
- Present the plan to the user before execution begins.

**During implementation:**
- Each coding agent checks off its ACs on Linear after tests pass via `linear-server:update_issue`.
- Coordinator writes Implementation Updates at checkpoints. See [linear-updates.md](references/linear-updates.md).

**After every code-changing turn** (during implementation only — formal testing happens in the post-implementation pipeline):
- Flag any gaps between implemented changes and the issue's requirements/ACs. If the user agrees to adjustments, update the Linear issue.

## Post-Implementation Pipeline

Execute these phases in order after all ACs are implemented. Each phase must pass before moving to the next. Copy this checklist and check off phases as you complete them:

```
Pipeline Progress:
- [ ] Phase 1: Unit & integration tests written/updated
- [ ] Phase 2: E2E tests assessed and written (if needed)
- [ ] Phase 3: Targeted tests passing
- [ ] Phase 4: Logging compliance verified
- [ ] Phase 5: Code simplified
- [ ] Phase 6: Code review passed
- [ ] Phase 7: Documentation updated
- [ ] Phase 8: E2E tests passing
```

### Phase 1: Unit & Integration Tests

Ensure tests cover all changed behavior. Follow the project's test discipline in CLAUDE.md — update broken tests, remove redundant ones, add tests only for new behavior. Update `app/tests/TEST_MANIFEST.md` if new Rust commands, E2E spec files, or plugin source patterns were added.

### Phase 2: E2E Tests

Assess whether changes affect user-facing flows that warrant new Playwright E2E tests. If so, write specs with appropriate tags and update `app/tests/TEST_MANIFEST.md`. If not, note why and skip.

### Phase 3: Run Targeted Tests

Run tests per the project's test strategy (see CLAUDE.md "Choosing which tests to run"). Max 3 attempts per failure, then escalate to user.

### Phase 4: Logging Compliance

Verify all changed code follows the project logging guidelines (CLAUDE-APP.md § Logging):
- **Rust**: Every new `#[tauri::command]` has `info!` on entry (with key params) and `error!` on failure. Intermediate steps use `debug!`. No secrets logged.
- **Frontend**: Caught errors use `console.error()`, unexpected states use `console.warn()`, significant user actions use `console.log()`. No render-cycle or state-read logging.
- **Format**: Log messages include context — e.g. `info!("import_skills: importing {} from {}", count, repo)` not just `info!("importing")`.

If any gaps, fix them and re-run affected tests.

### Phase 5: Code Simplification

Spawn `code-simplifier:code-simplifier` targeting the worktree. It reviews recently changed files and simplifies for clarity, consistency, and maintainability while preserving all functionality. Fix any issues it surfaces, then re-run affected tests to confirm nothing broke.

### Phase 6: Code Review

Spawn `feature-dev:code-reviewer`. See [review-flow.md](references/review-flow.md). Max 2 review-fix cycles — fix high/medium issues, note low-severity if not straightforward.

### Phase 7: Update Documentation

Keep project docs in sync with changes. Check `CLAUDE.md` (and its `@import` files) and any `README.md` in changed directories. Update if the changes affect documented architecture, commands, conventions, or usage. Commit doc updates separately.

### Phase 8: Run E2E Tests

Run E2E tests tagged for the changed areas. This is the final validation gate after simplification, review fixes, and doc updates. Fix failures. Max 3 attempts, then escalate to user.

## Completion

Enter when all pipeline phases pass.

1. Verify all ACs are checked on Linear. If any missed, spawn a fix agent and re-verify.
2. Create PR and link to issue. See [git-and-pr.md](references/git-and-pr.md).
3. Write final Implementation Updates to Linear. See [linear-updates.md](references/linear-updates.md).
4. Move issue to Review via `linear-server:update_issue`.
5. Report to user with: PR link, worktree path, recommended test mode (see [test-mode.md](references/test-mode.md)) with launch command, manual test steps from the PR test plan, and relevant E2E tags.
6. **Do NOT remove the worktree** — user tests manually on it.

## Sub-agent Type Selection

These are `subagent_type` values for the `Task` tool — not MCP tools.

| Task | subagent_type | model |
|---|---|---|
| Planning | feature-dev:code-architect | sonnet |
| Codebase exploration | Explore | default |
| Implementation | general-purpose | default |
| Code simplification | code-simplifier:code-simplifier | default |
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
- **Follow project logging standards** (CLAUDE-APP.md § Logging) — every new Rust command logs `info!` on entry + `error!` on failure; frontend uses `console.error/warn/log` appropriately; include context in log messages
- **Follow project testing rules** (CLAUDE.md § Testing) — new store logic → unit test, new Rust command → `#[cfg(test)]`, new UI interaction → component test, new page/flow → E2E happy path, bug fix → regression test; use `npm run test:changed` for frontend, `cargo test <module>` for Rust

## Error Recovery

| Situation | Action |
|---|---|
| Sub-agent fails | Max 2 retries, then escalate to user |
| Worktree exists on wrong branch | Remove and recreate |
| Linear API fails | Retry once, then continue and note for user |
| Scope changes mid-execution | Reassess in-flight work, re-plan if needed |
| Tests fail after 3 attempts | Escalate to user with failure details |
| ACs remain unmet after fixes | Keep In Progress, report to user |

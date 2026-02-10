---
name: implement-linear-issue
description: |
  Implement a Linear issue end-to-end: set up a worktree, plan with parallelization, execute via agent teams,
  update the Linear issue with progress, code review, run tests, and move to review.
  Use this skill whenever the user wants to implement, build, fix, or work on a Linear issue.
  Trigger on phrases like "implement VD-123", "work on VD-123", "build VD-123", "fix VD-123",
  "/implement-issue", or any reference to picking up and executing a Linear issue.
compatibility:
  requires:
    - Task (sub-agent spawning — critical)
    - AskUserQuestion
    - Bash (git worktree, test runners)
    - Read, Grep, Glob
    - Linear MCP (issue read/update, status transitions)
---

# Implement Linear Issue

You are a **coordinator**. You take a Linear issue and drive it to completion using agent teams. You do NOT write code yourself.

## Core Principle: You Are Only a Coordinator

**You do NOT write code, read code in detail, run tests, or make implementation decisions yourself.** You:
1. Plan and decompose work
2. Launch agent teams via `Task` tool
3. Check status of teams
4. Make coordination decisions (ordering, dependencies, re-planning)
5. Do a final code review (delegated to a review sub-agent)
6. Relay results to the user

Everything else is done by sub-agents. This preserves your context for orchestration across the full lifecycle.

## Act Autonomously

Do not ask for permission to do non-destructive work. The only things that need user confirmation:
- The implementation plan (before execution begins)
- Any scope changes discovered during implementation
- Final status before moving to review

Everything else — worktree setup, Linear status updates, launching teams, running tests — just do it.

## Full Workflow

### Phase 1: Setup

1. **Fetch the issue** from Linear via a sub-agent. Get: issue ID, title, description, requirements, acceptance criteria, estimate, labels, **and branch name**.
2. **Create a git worktree** using the branch name from Linear:
   ```
   git worktree add <branch-name> -b <branch-name>
   ```
3. **Move the issue to In Progress** in Linear via a sub-agent.

### Phase 2: Plan

Read `references/planning-flow.md` for detailed planning workflow.

**Summary:**
1. Spawn a **planning sub-agent** to analyze the issue requirements against the codebase
2. The planner returns a dependency-aware execution plan with parallelizable work streams
3. Present the plan to the user for approval
4. User can adjust, then you execute

The plan must identify:
- Independent work streams that can run in parallel
- Dependencies between tasks (what blocks what)
- Which tasks need tests
- Estimated sequence and parallelism

### Phase 3: Execute

Read `references/agent-team-guidelines.md` for how to instruct agent teams.

**Summary:**
1. Launch agent teams for independent work streams **in parallel**
2. Each team lead is itself a coordinator — it plans how to parallelize within its scope and launches its own sub-agents
3. Teams send **summary status only** — not detailed logs
4. Teams update the Linear issue with implementation progress (see `references/linear-updates.md`)
5. Teams also write tests alongside code changes
6. Monitor teams, handle failures, re-plan if needed

### Phase 4: Code Review

Read `references/review-flow.md` for the full review process.

**Summary:**
1. Spawn a **code review sub-agent** to review all changes
2. If issues found → spawn fix sub-agents, then re-review
3. Verify tests exist for the changes — if missing, spawn a sub-agent to add them
4. Add final comments to the implementation updates section in the Linear issue

### Phase 5: Test

1. Spawn a sub-agent to run **all** frontend and backend tests in the worktree
2. If tests fail → spawn fix sub-agents targeting the failures, then re-run
3. Repeat until green (max 3 attempts, then escalate to user)

### Phase 6: Complete

1. **Update the Linear issue** with final implementation notes
2. **Move the issue to Review** in Linear
3. Report final status to the user: what was done, test results, any notes for reviewer

## Sub-agent Guidelines

When spawning sub-agents via `Task`:
- Use `subagent_type: "general-purpose"` for all implementation work
- Always tell the sub-agent the **worktree path** (not the main repo path)
- Tell sub-agents to be **concise** — summary status only, not detailed exploration logs
- Spawn independent sub-agents in the **same message** for parallelism
- Sub-agents CAN and SHOULD spawn their own sub-agents for parallelism within their scope
- Every sub-agent that makes code changes must also consider whether tests are needed
- Every sub-agent must update the Linear issue at completion (see `references/linear-updates.md`)

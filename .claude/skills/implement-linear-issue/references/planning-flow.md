# Planning Flow — Dependency-Aware Parallelization

This reference covers how to plan implementation work so it can be maximally parallelized while respecting dependencies.

## Step 1: Spawn a Planning Sub-agent

The planner does a **structural scan** of the codebase — not a detailed code review. It needs to understand what areas are involved and what depends on what, not how to implement anything. The implementing agents will figure out the details.

### Planning sub-agent prompt:

```
You are planning the implementation of a Linear issue.

**Worktree path**: [path]
**Issue title**: [title]
**Issue requirements**: [requirements from Linear]
**Acceptance criteria**: [criteria from Linear]

Your job:
1. Do a STRUCTURAL SCAN of the codebase — understand what areas of the product are involved, where the boundaries are, and what touches what. You are NOT doing a detailed code review. Don't read implementation details — just understand the shape of the codebase enough to plan.
2. Break the work into discrete tasks
3. Identify dependencies between tasks (what blocks what)
4. Group independent tasks into parallel work streams
5. For each task, note whether tests are needed

Return this structure:

## Work Streams

### Stream 1: [name]
**Can start immediately**: yes
**Tasks**:
1. [task description] — tests needed: yes/no
2. [task description] — tests needed: yes/no
**Depends on**: nothing

### Stream 2: [name]
**Can start immediately**: yes
**Tasks**:
1. [task description] — tests needed: yes/no
**Depends on**: nothing

### Stream 3: [name]
**Can start immediately**: no
**Tasks**:
1. [task description] — tests needed: yes/no
**Depends on**: Stream 1, task 2

## Execution Order
1. Launch Streams 1 and 2 in parallel
2. When Stream 1 task 2 completes → launch Stream 3
3. [etc.]

## Risk Notes
[Any conflicts between streams, shared files that need careful ordering, etc.]

Be specific about what each task involves (which areas of the product, what behavior changes) but keep it at a level where another agent can pick it up and figure out the implementation.
```

## Step 2: Present Plan to User

Show the user:
- The work streams and their parallelization
- The dependency chain
- Any risk notes
- Estimated total effort (from the issue's t-shirt size)

The user may:
- Approve → proceed to execution
- Adjust scope → replan
- Reorder priorities → adjust the plan

## Step 3: Plan Updates During Execution

The plan is a living document. If during execution:
- A team discovers unexpected complexity → re-plan affected streams
- A dependency turns out to be wrong → adjust ordering
- New work is discovered → add it to the plan and decide where it fits

The coordinator (you) owns the plan. Sub-agents report status; you decide how to adapt.

## Parallelization Principles

1. **Maximize parallelism**: If two tasks don't depend on each other, they run simultaneously
2. **Minimize shared-file conflicts**: If two tasks touch the same files, they should be sequential or one should complete first
3. **Front-load risky work**: Tasks with uncertainty or high complexity go first — if they fail or change scope, you find out early
4. **Tests run with implementation**: Each task includes its own test writing, not as a separate phase
5. **Sub-agents parallelize too**: Each team lead should look for opportunities to parallelize within their stream

# Planning Flow

## Spawn a Planning Sub-agent

Use `subagent_type: "feature-dev:code-architect"` with `model: "sonnet"`.

Provide: worktree path, issue title, requirements, acceptance criteria.

The planner does a structural scan — understanding what areas are involved and dependencies, not implementation details.

### Required Output Format

```
## Work Streams

### Stream N: [name]
**Can start immediately**: yes/no
**Tasks**:
1. [task] — tests needed: yes/no
**Depends on**: [stream/task or nothing]

## Execution Order
1. Launch Streams X and Y in parallel
2. When Stream X completes → launch Stream Z

## AC Mapping
For each acceptance criterion, which stream/task addresses it:
- AC: "[text]" → Stream X, Task Y
- AC: "[text]" → NOT COVERED (flag this)

## Risk Notes
[Shared files, potential conflicts between streams]
```

## Present Plan to User

Show: work streams, dependency chain, AC mapping (highlight any uncovered ACs), risk notes.

User may approve, adjust scope, or reorder.

## Plan Updates During Execution

The plan is living. If a team discovers unexpected complexity, a dependency is wrong, or new work surfaces — the coordinator re-plans affected streams.

## Parallelization Principles

1. **Maximize parallelism**: independent tasks run simultaneously
2. **Minimize shared-file conflicts**: sequential if touching same files
3. **Front-load risky work**: uncertain/complex tasks first

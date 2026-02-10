# Agent Team Guidelines

This reference covers how to instruct agent teams that execute implementation work. Every team lead is itself a coordinator that can spawn its own sub-agents.

## Team Lead Prompt Template

When spawning a team lead for a work stream:

```
You are a team lead implementing a work stream for a Linear issue.

**Worktree path**: [path]
**Issue ID**: [e.g., VD-383]
**Your work stream**: [stream name and description]
**Tasks assigned to you**:
[numbered list of tasks from the plan]
**Dependencies**: [what must complete before you start, if anything]

## Your operating rules:

### You are a coordinator
Plan how to parallelize within your work stream. If tasks are independent, spawn sub-agents to execute them in parallel. You focus on coordination, not writing code yourself.

### Code + tests together
Every code change should include appropriate tests. Don't treat tests as a separate phase — they're part of the implementation. If a task changes behavior, there should be a test verifying that behavior.

### Summary status only
When you report back to the main coordinator, send a **summary** only:
- What was completed
- What tests were added
- Any issues or blockers encountered
- Any scope changes discovered

Do NOT send detailed code diffs, exploration logs, or file-by-file breakdowns.

### Update the Linear issue
After completing your work stream, update the Linear issue's implementation updates section. See the update rules below.

### Linear Issue Update Rules
- **Rewrite** the implementation updates section — do not append
- The update should reflect the current state so someone picking up the issue can understand where things stand
- **Never remove acceptance criteria** — you can add new ones and check off completed ones
- Structure the update as:

```markdown
## Implementation Updates

**Status**: [In Progress / Blocked / Stream Complete]
**Branch**: [branch name]

### Completed
- [What's been done, briefly]

### In Progress
- [What's currently being worked on]

### Remaining
- [What's left to do]

### Tests Added
- [List of test areas covered]

### Notes
- [Any discoveries, decisions, or things the next person should know]
```

### If you encounter blockers
If something blocks your work:
1. Report it immediately in your summary
2. Update the Linear issue with the blocker
3. Do NOT wait silently — the main coordinator needs to know so it can re-plan

### If you discover new work
If you find something that wasn't in the plan:
1. If it's small and within your scope → just do it
2. If it's significant or outside your scope → report it in your summary so the coordinator can decide
```

## Implementation Sub-agent Prompt Template

When a team lead spawns sub-agents to do actual code work:

```
You are implementing a specific task in a codebase.

**Worktree path**: [path]
**Task**: [specific task description]
**Context**: [any relevant context from the team lead]

Your job:
1. Implement the change
2. Write tests if the task involves behavior changes
3. Make sure existing tests still pass for the files you touched (run relevant test files)
4. Return a brief summary: what you changed, what tests you added/modified, any issues

Keep your summary to 3-5 bullet points max.
```

## Coordination Patterns

### Parallel streams, no shared files
Best case. Launch all streams simultaneously. Each team works independently.

### Parallel streams, some shared files
Launch streams simultaneously but warn teams about the shared files. The first team to touch a shared file "owns" it — later teams should be aware of changes.

### Sequential dependencies
Stream B depends on Stream A completing. Launch A first, wait for completion, then launch B. Tell B what A changed so it has context.

### Fan-out then fan-in
Multiple parallel tasks that must all complete before a final integration step. Launch all parallel tasks, collect results, then spawn an integration sub-agent.

## Failure Handling

If a team reports failure:
1. Assess whether it's a local issue (retry with more context) or a plan issue (re-plan)
2. If retrying, give the team specific guidance on what went wrong
3. If re-planning, pause other streams that depend on the failed one
4. Update the Linear issue with the blocker
5. Max 2 retries per team before escalating to the user

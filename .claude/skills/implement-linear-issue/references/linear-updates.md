# Linear Issue Updates During Implementation

## Core Rules

1. **Rewrite, don't append.** The implementation updates section is a living snapshot — not an audit log. Every update overwrites the previous one.

2. **Never remove acceptance criteria.** You can check them off or add new ones with `(NEW)` prefix. Never delete or modify existing ones.

3. **Update at meaningful checkpoints.** After each stream completes, when blocked, after code review, after tests pass, before moving to review.

4. **Split update responsibilities.** Coding agents check off ACs directly after their tests pass. The coordinator owns the Implementation Updates section. This prevents race conditions — ACs are safe for parallel updates (each agent checks off different items), while the main status section has a single writer.

## Update Structure

```markdown
## Implementation Updates

**Status**: [In Progress / Blocked / Code Review / Testing / Ready for Review]
**Branch**: [branch name]
**PR**: [PR URL, once created]
**Worktree**: [worktree path]

### Completed
- [Brief, 1-line items]

### In Progress
- [What's being worked on, blockers if any]

### Remaining
- [What's left]

### Tests
- [Test areas covered]

### Notes for Reviewer
- [Key decisions, non-obvious choices, follow-up work]
```

## Coordinator's Update Prompt

The coordinator spawns a sub-agent to write implementation updates. Provide it with:
- The issue ID
- Consolidated status from all team reports
- The update structure above

The sub-agent reads the current issue first, preserves relevant content, rewrites the Implementation Updates section.

## When to Update

| Stage | Who Writes Implementation Updates | Who Checks Off ACs |
|---|---|---|
| Stream completes | Coordinator (via sub-agent) | Coding agent for that stream |
| Blocker hit | Coordinator (via sub-agent) | — |
| Code review done | Coordinator (via sub-agent) | — |
| Tests pass | Coordinator (via sub-agent) | — |
| PR created | Coordinator (via sub-agent) | — |
| Final | Coordinator (via sub-agent) | Coordinator verifies all checked |

## Acceptance Criteria Format

```markdown
- [x] Verified AC ← checked off by coding agent after tests pass
- [ ] Pending AC ← not yet addressed
- [ ] (NEW) Discovered AC ← found during implementation
```

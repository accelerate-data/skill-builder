# Linear Issue Updates During Implementation

This reference covers how to update the Linear issue as implementation progresses.

## Core Rules

1. **Rewrite, don't append.** The implementation updates section is a living snapshot of current state — not an audit log. Every update overwrites the previous one so someone picking up the issue sees the current situation immediately.

2. **Never remove acceptance criteria.** Acceptance criteria from the original issue are sacred. You can:
   - Check them off (mark as done)
   - Add new ones discovered during implementation
   - Never delete or modify existing ones

3. **Update at regular stages.** Not after every commit, but at meaningful checkpoints:
   - After each work stream completes
   - When a blocker is hit
   - After code review
   - After tests pass
   - Before moving to review

## Update Structure

The implementation updates section should always follow this structure:

```markdown
## Implementation Updates

**Status**: [In Progress / Blocked / Code Review / Testing / Ready for Review]
**Branch**: [branch name]
**Worktree**: [worktree path, for pickup by another agent]

### Completed
- [Brief description of what's been done]
- [Each item is 1 line, not a paragraph]

### In Progress
- [What's currently being worked on]
- [If blocked, say why]

### Remaining
- [What's left to do]

### Tests
- [Test areas covered]
- [Any test gaps known]

### Notes for Reviewer / Next Agent
- [Key decisions made during implementation]
- [Anything non-obvious about the approach]
- [Known limitations or follow-up work]
```

## Sub-agent Update Prompt

When telling sub-agents to update the Linear issue, include this in their prompt:

```
After completing your work, update the Linear issue [issue ID] implementation updates section.

Rules:
- REWRITE the entire Implementation Updates section — do not append to it
- Read the current section first, preserve anything still relevant, update what's changed
- NEVER remove or modify acceptance criteria — only add new ones or check off completed ones
- Keep it concise — this is a status snapshot, not a detailed log
- Someone picking up this issue tomorrow should know exactly where things stand

Use this structure:
[paste the update structure above]
```

## When to Update

| Stage | Who Updates | What Changes |
|-------|-------------|--------------|
| Stream completes | Team lead for that stream | Add to Completed, remove from In Progress |
| Blocker hit | Team lead that hit it | Status → Blocked, explain in In Progress |
| Code review done | Review sub-agent | Add review notes, update Status |
| Tests pass | Test sub-agent | Update Tests section, Status → Ready for Review |
| Final | Coordinator (via sub-agent) | Clean up, add reviewer notes, finalize |

## Acceptance Criteria Handling

The acceptance criteria in the original issue are the contract. During implementation:

```markdown
## Acceptance Criteria
- [x] Users can see conversation history with pagination ← checked off
- [ ] Error states show user-friendly messages ← still pending
- [ ] API returns proper status codes for edge cases ← still pending
- [x] Search results update in real-time as user types ← checked off
- [ ] (NEW) Pagination handles empty result sets gracefully ← discovered during implementation
```

The `(NEW)` prefix is optional but helpful to distinguish original vs. discovered criteria.

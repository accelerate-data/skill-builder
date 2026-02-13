# Git and PR Conventions

## PR Body Template

Title: `[ISSUE-ID]: issue title`

```markdown
Fixes [ISSUE-ID]

## Summary
[2-3 sentences from implementation status]

## Changes
- [Bullet list from team reports]

## Test Coverage
- [Tests added/modified]

## Acceptance Criteria
- [x] [AC 1]
- [x] [AC 2]
```

After creating the PR, link it to the Linear issue via `linear-server:update_issue`.

## Worktree Preservation

**Do NOT remove the worktree.** The user tests manually on it. Include the worktree path in the final status report.

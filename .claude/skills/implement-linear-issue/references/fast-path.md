# Fast Path — Small Issues

## When to Use

Use the fast path when ALL of these are true:
- Estimate is XS or S (1-2 points)
- Description is straightforward (not multi-system)
- 1-3 acceptance criteria
- Changes are isolated to one area of the codebase

The user can override: "use full flow" forces the standard multi-stream workflow.

## How It Works

Skip team orchestration. Spawn a **single `general-purpose` sub-agent** that:

1. Reads the issue requirements and ACs
2. Scans the relevant codebase area
3. Implements all changes
4. Writes tests alongside code
5. Commits with conventional format (`feat(scope): description`)
6. Runs relevant tests to verify
7. Checks off addressed ACs on Linear via `linear-server:update_issue`
8. Returns: summary of changes, tests added, which ACs addressed

## After Fast Path

Proceed directly to **Phase 5 (Code Review)**. Code review and PR creation are never skipped, even for small issues.

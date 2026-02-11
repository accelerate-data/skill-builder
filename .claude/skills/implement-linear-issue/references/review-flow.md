# Review Flow

## Code Review

Spawn a sub-agent with `subagent_type: "feature-dev:code-reviewer"`.

Provide: worktree path, branch name, summary of what was implemented.

The agent returns a verdict (PASS / NEEDS FIXES) with issues categorized by severity.

## Fix Cycle

- **High severity** → must fix
- **Medium severity** → must fix
- **Low severity** → fix if straightforward, otherwise note

Spawn fix sub-agents for high/medium issues. They can run in parallel if touching different areas. Max 2 review cycles — after that, proceed with remaining low-severity notes.

## Test Strategy

Run only relevant tests, not the full suite. Max 3 fix-and-rerun attempts before escalating to user.

## PR Creation

After tests pass, the coordinator creates a PR (see SKILL.md Phase 7).

## Final Linear Update

Spawn a sub-agent to write the final Implementation Updates section. Provide:
- Issue ID
- Final status from all phases
- PR URL
- Use the Implementation Updates structure defined in SKILL.md → linear-updates.md

## Move to Review

Only move the issue to Review status if ALL of:
- Relevant tests pass
- Code review is clean (no outstanding high-severity issues)
- PR is created and linked to the issue
- Linear issue is updated with final notes

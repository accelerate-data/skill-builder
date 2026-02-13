# Agent Team Guidelines

## Team Leads

Each work stream gets a team lead (spawned via `Task`). Provide: worktree path, issue ID, the ACs this stream owns, task list, and dependencies.

Team leads coordinate within their stream — spawning sub-agents for parallel tasks, not writing code themselves.

### Rules
- Code + tests together (not separate phases)
- **Test deliberately, not blindly.** Before writing any test code:
  1. Read existing tests for files you changed — understand what's already covered
  2. Update tests that broke due to your changes (changed APIs, renamed props, altered behavior)
  3. Remove tests that are now redundant (deleted features, replaced flows, duplicate coverage)
  4. Add new tests only for genuinely new behavior — don't duplicate what existing tests already verify
  5. Never add tests just to increase count — every test must catch a real regression
- Commit + push before reporting (conventional format: `feat(scope): description`)
- Check off your ACs on Linear after tests pass
- Report back: what completed, tests updated/added/removed, ACs addressed, blockers. No exploration logs.
- Do NOT write to the Implementation Updates section (coordinator-only)

## Failure Handling

1. Assess: local issue (retry with guidance) or plan issue (re-plan)
2. Pause dependent streams if needed
3. Max 2 retries per team before escalating to user

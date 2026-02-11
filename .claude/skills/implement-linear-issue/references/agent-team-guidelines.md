# Agent Team Guidelines

## Team Lead Rules

When spawning a team lead for a work stream, include these rules:

- **You are a coordinator.** Plan how to parallelize within your stream. Spawn sub-agents for independent tasks. Focus on coordination, not writing code yourself.
- **Code + tests together.** Every code change includes appropriate tests. Don't treat tests as a separate phase.
- **Commit + push before reporting.** Use conventional format: `feat(scope): description` or `fix(scope): description`. Ensure all sub-agent work is committed and the working tree is clean.
- **Check off your ACs on Linear.** After your tests pass, update the Linear issue via `linear-server:update_issue` to check off the acceptance criteria your stream addressed.
- **Summary status only.** Report back: what completed, tests added, ACs addressed, blockers, scope changes. No detailed code diffs or exploration logs.
- **Do NOT write to the Implementation Updates section.** The coordinator handles that to prevent race conditions.

## Team Lead Context

When spawning a team lead, provide:
- Worktree path
- Issue ID (e.g., VD-383)
- **The acceptance criteria this stream is responsible for** (exact text from the AC mapping in the plan)
- Stream name and task list from the plan
- Dependencies (what must complete first)

## Implementation Sub-agents

Team leads spawn sub-agents for actual code work. Provide:
- Worktree path
- Specific task description
- Relevant context from the team lead

Sub-agents implement, write tests, commit, and return a 3-5 bullet summary.

## Failure Handling

If a team reports failure:
1. Assess: local issue (retry with guidance) or plan issue (re-plan)
2. If retrying, give specific guidance on what went wrong
3. Pause dependent streams if needed
4. Report blocker to coordinator (coordinator updates Linear)
5. Max 2 retries per team before escalating to user

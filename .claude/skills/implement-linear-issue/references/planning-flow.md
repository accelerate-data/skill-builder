# Planning Flow

## Spawn a Planning Sub-agent

Use `subagent_type: "feature-dev:code-architect"` with `model: "sonnet"`.

Provide: worktree path, issue title, requirements, acceptance criteria.

The planner does a structural scan — understanding what areas are involved and dependencies, not implementation details.

## Required Outputs

The plan must cover:
1. **Work streams** — what can run in parallel vs. what has dependencies
2. **AC mapping** — which stream/task addresses each acceptance criterion. Flag any uncovered ACs.
3. **Test strategy** — consult `app/tests/TEST_MANIFEST.md` to identify which tests cover the files being changed. For each work stream, specify:
   - **Update**: existing test files that need changes to match new behavior
   - **Remove**: tests that become redundant or test deleted behavior
   - **Add**: new test files for genuinely new behavior
   - **Run**: the full set of tests to execute after implementation
   - **Manifest**: flag which rows in `app/tests/TEST_MANIFEST.md` need adding, updating, or removing
4. **Risk notes** — shared files, potential conflicts between streams

## Present Plan to User

Show work streams, dependency chain, AC mapping, and risks. User may approve, adjust, or reorder.

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
   - **Update**: existing test files that need changes to match new behavior (e.g. changed function signatures, new props, altered state transitions)
   - **Remove**: tests that become redundant or test behavior that no longer exists (e.g. deleted features, replaced flows)
   - **Add**: new test files for new source files, or new test cases in existing files for new behavior
   - **Run**: the full set of tests to execute after implementation (unit, integration, E2E tags)
4. **Risk notes** — shared files, potential conflicts between streams

Format is flexible — clarity matters more than structure.

## Present Plan to User

Show work streams, dependency chain, AC mapping, and risks. User may approve, adjust, or reorder.

## Parallelization Principles

1. Independent tasks run simultaneously
2. Sequential if touching same files
3. Front-load risky/uncertain work

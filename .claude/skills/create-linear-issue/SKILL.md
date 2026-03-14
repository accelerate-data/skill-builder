---
name: create-linear-issue
description: |
  Creates Linear issues from product thoughts, feature requests, or bug reports. Decomposes large issues into smaller ones.
  Triggers on "create issue", "log a bug", "file a ticket", "new feature", "break down <issue-id>", or "/create-issue".
---

# Create Linear Issue

Turn a short product thought into a clear, product-level Linear issue.

## Codex Execution Mode

See `../../rules/codex-execution-policy.md`.

## Tool Contract

Use these exact tools:

- `mcp__linear__list_issues`: dedupe search and child discovery
- `mcp__linear__get_issue`: fetch parent issue for decomposition
- `mcp__linear__list_projects`: project selection
- `mcp__linear__get_project`: fetch full project details
- `mcp__linear__list_milestones`: milestone discovery for selected project
- `mcp__linear__list_cycles`: cycle discovery for the team
- `mcp__linear__list_issue_labels`: label selection
- `mcp__linear__save_issue`: create/update issue(s)
- `mcp__linear__create_comment`: optional rationale notes on parent

Required fields:

- New issue via `save_issue`: `team`, `title`, `project`, `milestone`, `cycle`; include `description`, `labels`, `estimate`, `assignee: "me"` when available.
- Decomposition child issue: must include parent reference in description and AC mapping.
- **`milestone` and `cycle` are mandatory.** Never create an issue without both.

Fallback behavior:

- If required Linear tools are unavailable or failing after one retry, stop and report missing capability. Do not fabricate IDs, labels, or project names.

## Core Rules

1. Product-level only. No file names, component names, or architecture in issue body.
2. Confirm before creating. Always show final issue draft before `save_issue`.
3. Clarifications: ask at most 2 targeted questions. If confidence is high (>=80%), default assumptions and proceed.
4. Idempotency: re-runs must not duplicate equivalent issues/comments. Reuse discovered open issue when appropriate.
5. Acceptance criteria in Linear must use Markdown checkboxes (`- [ ] ...`).
6. Resolve the target project from user input or existing issue context. Do not hardcode a project name in this skill.
7. Milestone selection must be from the resolved project only. If no clear milestone match exists, ask the user before creating the issue. Never omit milestone.
8. Cycle selection is mandatory. Use `list_cycles` to find the current or next cycle for the team. If ambiguous, ask the user. Never omit cycle.
9. Do not decompose by implementation layer (`frontend`/`backend`/`API`). Issues must represent integrated, user-visible outcomes that can be validated end-to-end.
10. Decomposition is allowed only by feature slices. Frontend-only splits are allowed only when each split is an independently testable feature outcome.

## Outcomes

- Request understood (feature, bug, or decompose)
- Requirements drafted and estimate confirmed
- Issue created (or child issues created) with traceable ACs

## Understand the Request

- If user intent is decompose (e.g., `break down <issue-id>`), follow **Decompose Path**.
- Otherwise classify as `feature` or `bug`.

## Dedupe Check (required)

Before creating any issue:

1. Search open issues with `list_issues` using title/keyword query.
2. If a near-duplicate exists, present it and ask whether to reuse/update instead of creating a new one.

## Issue Schema (required)

Use this description template:

```md
## Problem
...

## Goal
...

## Non-goals
- ...

## Acceptance Criteria
- [ ] ...
- [ ] ...

## Risks
- ...

## Test Notes
- ...
```

## Estimate

See `references/linear-operations.md` for estimate table.

- `L` is the maximum single-issue size.
- If scope exceeds `L`, switch to decomposition.

## Project, Milestone, and Cycle Resolution (required)

Before drafting or creating an issue:

1. Resolve the target project from explicit user input, parent issue context, or team defaults discovered through Linear.
2. Use `list_projects`/`get_project` to resolve the project ID/name.
3. Use `list_milestones` for that project and map feature intent to milestone candidates.
4. If exactly one milestone is a clear match, include it in the draft.
5. If project or milestone is ambiguous, ask the user before `save_issue`.
6. Never pick a milestone from a different project.
7. Use `list_cycles` with the team ID to find the current cycle. Default to the current active cycle; if none, use the next upcoming cycle.
8. If cycle is ambiguous, ask the user before `save_issue`.
9. Every issue must have both a milestone and a cycle before creation. Block on user input if either cannot be resolved.

## Create Path

1. Resolve project and fetch labels.
2. Resolve milestone candidates from that project.
3. Resolve cycle for the team (current or next).
4. Draft title, estimate, project, milestone, cycle, labels, description (schema above).
5. Confirm draft with user.
6. Create with `mcp__linear__save_issue` (`assignee: "me"` when allowed). Must include `milestone` and `cycle`.
7. Return issue ID + URL.

## Decompose Path

1. Fetch parent issue, resolve project, and fetch labels.
2. Split into 2-4 child issues, each <= `L`.
3. Traceability rule: each child maps to exactly one AC group from parent.
4. Resolve milestone candidates from the resolved project; if unclear, ask user before create.
5. Resolve cycle for the team (current or next).
6. Confirm child plan with user.
7. Create children with `save_issue` in parallel when safe. Each child must include `milestone` and `cycle`.
8. Update parent description to list child IDs and AC-group mapping.

## Output Hygiene

- Never inline long command/test output into Linear issue fields.
- Keep Linear description concise and product-facing.

---
name: create-linear-issue
description: |
  Creates well-structured Linear issues from short product thoughts, feature requests, or bug reports.
  Also decomposes large existing issues into smaller ones.
  Triggers on "create issue", "log a bug", "file a ticket", "new feature", "something is broken",
  "break down VD-123", "decompose VD-123", "split VD-123", or "/create-issue".
  Classifies as feature or bug, explores the codebase for feasibility,
  and produces product-level issues with no implementation details.
---

# Create Linear Issue

You are a **coordinator**. Turn a short product thought into a clear, product-level Linear issue. Delegate all work to sub-agents via `Task`.

## Core Rules

1. **Product-level only.** No file names, component names, or architecture in the issue. Sub-agents review code for feasibility — their findings stay internal (the **INTERNAL / FOR THE ISSUE split**).

2. **Act autonomously.** Only confirm: decisions (approach, labels), destructive actions (creating labels/issues), and genuine ambiguity.

## Progress Checklist

```
- [ ] Phase 1: Classify & clarify
- [ ] Phase 2: Feature path or bug path
- [ ] Phase 3: Estimate
- [ ] Phase 4: Create Linear issue
```

## Phase 1: Classify & Clarify

If the user provides an existing issue ID with decompose intent (e.g., "break down VD-123"), follow the **Decompose Path** below instead.

Otherwise, classify as `feature` or `bug` using `AskUserQuestion` with structured options when choices are finite. Ask **at most 2** targeted clarifications. Don't ask what you can infer.

## Phase 2a: Feature Path

See [feature-flow.md](references/feature-flow.md).

Ask user: proceed directly or explore alternatives? Either way, codebase is reviewed for feasibility (internal only). If exploring, a team lead spawns parallel sub-agents for codebase + internet research, synthesizes 2-3 options. User picks, requirements are written, max 2 refinement rounds.

## Phase 2b: Bug Path

See [bug-flow.md](references/bug-flow.md).

Sub-agent investigates code + git history. Returns user-visible symptoms, reproduction steps, severity. Present to user for confirmation.

## Phase 3: Estimate

See [linear-operations.md](references/linear-operations.md) for the estimate table.

**L is the maximum.** If scope exceeds L, switch to the **Decompose Path** to break it into smaller issues. Present estimate to user; they can override.

## Phase 4: Create Linear Issue

See [linear-operations.md](references/linear-operations.md) for MCP tools.

1. Fetch projects and labels from Linear (parallel sub-agents).
2. **Confirm details**: Single `AskUserQuestion` with questions for project (up to 4, best-fit first with "(Recommended)"), labels (multi-select), and estimate. Do NOT proceed until confirmed.
3. Compose the issue:

**Title**: short, action-oriented, under 80 characters.

**Description template**:
```markdown
## Context
[1-2 sentences: what prompted this]

## Requirements
[Features: numbered list of user-facing behavior]
[Bugs: reproduction steps as user would follow]

## Acceptance Criteria
- [ ] [Testable from product perspective — no implementation details]
```

4. Spawn a sub-agent with the full payload to create the issue (`assignee: "me"`). It returns the issue ID/URL.

## Decompose Path

Triggered when the user provides an existing issue ID with intent to break it down (e.g., "break down VD-123", "decompose VD-123", "split VD-123").

```
- [ ] Step 1: Fetch issue
- [ ] Step 2: Analyze & propose
- [ ] Step 3: Create child issues
```

### Step 1: Fetch Issue

Spawn parallel sub-agents:
- **`general-purpose`** (model: `haiku`): Fetch the issue via `linear-server:get_issue`. Return title, description, requirements, ACs, estimate.
- **`general-purpose`** (model: `haiku`): Fetch projects and labels from Linear.

### Step 2: Analyze & Propose

Spawn a `feature-dev:code-explorer` sub-agent with the issue requirements. It scans the codebase to map each requirement to affected areas and estimate per-area effort.

Using the analysis, split into 2-4 child issues, each ≤ L estimate. Each child gets: title, requirements subset, ACs, and estimate. Present to user via `AskUserQuestion` for confirmation.

### Step 3: Create Child Issues

Spawn parallel sub-agents to create each child issue on Linear (`assignee: "me"`). Reference the parent issue ID in each child's Context section. Update the parent issue description to list the child issues.

## Sub-agent Type Selection

| Task | subagent_type | model |
|---|---|---|
| Codebase feasibility | feature-dev:code-explorer | default |
| Bug investigation (needs git history) | Explore | default |
| External research | general-purpose | default |
| Requirements drafting | general-purpose | sonnet |
| Linear operations | general-purpose | haiku |

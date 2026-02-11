---
name: create-linear-issue
description: |
  Creates well-structured Linear issues from short product thoughts, feature requests, or bug reports.
  Triggers on "create issue", "log a bug", "file a ticket", "new feature", "something is broken",
  or "/create-issue". Classifies as feature or bug, explores the codebase for feasibility,
  and produces product-level issues with no implementation details.
compatibility:
  requires:
    - Task (sub-agent spawning)
    - AskUserQuestion
    - Bash, Read, Grep, Glob, WebSearch
    - Linear MCP (linear-server:create_issue, linear-server:list_projects, linear-server:list_issue_labels)
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

Classify as `feature` or `bug`. Ask **at most 2** targeted clarifications. Don't ask what you can infer.

## Phase 2a: Feature Path

See [feature-flow.md](references/feature-flow.md).

Ask user: proceed directly or explore alternatives? Either way, codebase is reviewed for feasibility (internal only). If exploring, a team lead spawns parallel sub-agents for codebase + internet research, synthesizes 2-3 options. User picks, requirements are written, max 2 refinement rounds.

## Phase 2b: Bug Path

See [bug-flow.md](references/bug-flow.md).

Sub-agent investigates code + git history. Returns user-visible symptoms, reproduction steps, severity. Present to user for confirmation.

## Phase 3: Estimate

See [linear-operations.md](references/linear-operations.md) for the estimate table.

**L is the maximum.** If scope exceeds L, decompose into multiple issues. Present estimate to user; they can override.

## Phase 4: Create Linear Issue

See [linear-operations.md](references/linear-operations.md) for MCP tools.

1. Fetch projects and labels from Linear (parallel sub-agents). Present to user via `AskUserQuestion`: project, labels, estimate confirmation.
2. Compose the issue:

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

3. Spawn a sub-agent with the full payload to create the issue (`assignee: "me"`). It returns the issue ID/URL.

---
name: create-linear-issue
description: |
  Create well-structured Linear issues from short product thoughts, feature requests, or bug reports.
  Use this skill whenever the user wants to create a Linear issue, log a bug, file a ticket, track a feature idea,
  or turn a product thought into an actionable issue. Trigger on phrases like "create issue", "log a bug",
  "I want to track", "file a ticket", "new feature", "something is broken", "can we improve", or any short
  product observation that should become a tracked work item. Also trigger on /create-issue command.
compatibility:
  requires:
    - Task (sub-agent spawning)
    - AskUserQuestion
    - Bash
    - Read
    - Grep
    - Glob
    - WebSearch
    - Linear MCP (issue creation, labels, projects, users)
---

# Create Linear Issue

You are a **coordinator**. Your job is to turn a short product thought into a clear, product-level Linear issue.

## Product-Level Only

The issue description must stay at the **product manager level**. Describe what the user experiences, how the feature behaves, what the API contract looks like — never how it's implemented. No file names, no component names, no architecture details in the issue.

Sub-agents review the codebase to assess **feasibility and scope** (for accurate estimates and to catch unrealistic requirements), but their code-level findings stay internal — they do not appear in the final issue.

## Critical Operating Principles

### Delegate everything
**You do NOT read code, explore git, search the web, call Linear APIs, or investigate the codebase yourself.** You delegate ALL work to sub-agents via the `Task` tool. This preserves your context for reasoning and user conversation. The only tool you use directly is `AskUserQuestion` for collecting user decisions. Everything else — codebase investigation, internet research, Linear operations — goes through sub-agents.

### Act autonomously
**Do not ask for permission to do non-destructive work.** Reading code, searching the web, fetching Linear data, exploring alternatives — just do it. The only things that require user confirmation are:

- **Decisions**: which approach to take, which labels to use, final issue review
- **Destructive actions**: creating new labels in Linear, creating the issue itself
- **Ambiguity**: when classification is unclear or requirements are genuinely ambiguous

Everything else — spawn the agents, do the research, come back with results. Do not ask "should I review the codebase?" or "should I search the web?" — just do it.

## Pre-flight Check

Before starting, verify Linear MCP tools are available. You need tools for creating issues, listing projects, listing/creating labels, looking up users.

If missing, tell the user to add the Linear MCP to their Claude Code setup. Stop. No workarounds.

## Phase 1: Classify & Clarify

The user gives you a short sentence — a product thought, complaint, or observation.

1. **Classify** as one of: `feature` | `bug`
2. Ask **at most 2** targeted clarification questions using `AskUserQuestion`. Don't ask what you can infer.
3. If classification is ambiguous, ask the user which it is.

Proceed to Phase 2a (feature) or Phase 2b (bug).

## Phase 2a: Feature Path

Read `references/feature-flow.md` for the detailed team-based workflow and sub-agent prompts.

**Summary:**
1. Ask user: proceed with stated approach, or explore alternatives?
2. **Either way, the codebase is always reviewed** — but only for feasibility and scope. Code-level details stay internal and do not appear in the issue.
3. If exploring → spawn an **exploration team lead** sub-agent. The team lead spawns its own sub-agents to review the codebase for feasibility AND search the internet for patterns/prior art. The team synthesizes findings and returns 2-3 product-level options.
4. Present options via `AskUserQuestion`, let user pick.
5. For the chosen path → define product-level functional requirements and acceptance criteria. Requirements describe user-facing behavior, API contracts, and feature logic — not implementation.
6. Present to user for refinement. Max 2 rounds, then move on.

## Phase 2b: Bug Path

Read `references/bug-flow.md` for detailed sub-agent prompts and workflow.

**Summary:**
1. Spawn sub-agent to investigate: review relevant code + recent git history (commits, PRs)
2. Sub-agent returns: user-facing symptoms, reproduction steps, severity
3. Present findings to user for confirmation/refinement

## Phase 3: Estimate

Assign a t-shirt size estimate based on agent implementation effort:

| Size | Agent Effort | Examples |
|------|-------------|----------|
| XS | < 10 minutes | Copy change, config toggle, minor UI tweak |
| S | ~30 minutes | Small self-contained feature, simple behavior change |
| M | 1-2 hours | Moderate feature, some product design decisions |
| L | Half day | Significant feature, multiple user flows affected |
| XL | Major effort | Core behavior change, new capability, cross-cutting impact |

The estimate should come from the sub-agents' codebase analysis — they've already seen the scope. If they didn't provide enough signal, spawn a quick sub-agent to assess. Present the estimate to the user — they can override.

## Phase 4: Create Linear Issue

See `references/linear-operations.md` for the sub-agent prompt templates you'll use to delegate all Linear operations.

This phase is fully delegated. You gather the decisions, then hand them off.

### Step 1: Gather decisions from user

Spawn sub-agents in parallel to fetch projects and labels from Linear. Then use `AskUserQuestion` to collect:

1. **Project**: Which Linear project to file under (present the list from the sub-agent)
2. **Labels**: Suggest relevant ones from the fetched list. If nothing fits, propose a new label and confirm.
3. **Estimate confirmation**: Present the estimate from Phase 3. User can override.

### Step 2: Compose the issue payload

Assemble all the pieces:

**Title**: Short, specific, action-oriented. Under 80 characters.

**Description** using this template:
```markdown
## Context
[1-2 sentences: what prompted this, user's original thought]

## Requirements
[For features: numbered list — describe user-facing behavior, API contracts, feature logic]
[For bugs: reproduction steps as a user would experience them]

## Acceptance Criteria
- [ ] [Describe what the user sees, what the API returns, how the feature behaves]
- [ ] [Each criterion is testable from a product perspective — no implementation details]
```

**What belongs in the issue**: user experience, feature behavior, API inputs/outputs, edge cases, error states.
**What does NOT belong**: file names, component names, architecture, code patterns, implementation approach.

### Step 3: Delegate issue creation to sub-agent

Spawn a sub-agent with the full payload and let it handle all Linear MCP calls: user lookup, label creation (if needed), and issue creation. See `references/linear-operations.md` for the sub-agent prompt template.

This keeps Linear API response payloads out of your context entirely.

### Step 4: Confirm

The sub-agent returns the issue ID/link. Relay to the user. Keep it brief — one confirmation line.

## Sub-agent Guidelines

When spawning sub-agents via `Task`:
- Use `subagent_type: "general-purpose"` for code investigation, research, and analysis
- Always tell the sub-agent the project root path and what to look for
- Tell sub-agents to be **concise** — return findings, not exploration logs
- Spawn independent sub-agents in the **same message** for parallelism
- Keep sub-agent scope narrow: one objective per agent
- Sub-agents CAN and SHOULD spawn their own sub-agents when they need to parallelize (e.g., the exploration team lead spawning codebase review + internet research simultaneously)

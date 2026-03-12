# Write → Eval → Test → Refine Loop

**Status:** Design — not yet implemented

**Mockups:** [`mockups/`](mockups/) — open `mockups/index.html` to browse all screens.

---

## Overview

This document describes the design for an integrated skill improvement loop: one-shot skill generation from pre-captured context, batch evaluation with with/without comparison, user feedback capture, and iterative improvement. It also covers description optimization as a discrete UI action.

The design consolidates the current fragmented surfaces (Workflow, Test, Refine pages) into a **Skill Workspace** hub with tabs, backed by a durable state machine rather than a long-lived agent session.

---

## Plugin Adoption: Schemas + App-Native Execution

The `skill-creator` plugin (`agent-sources/plugins/skill-creator/`) defines the evaluation methodology. We use it in a hybrid way:

**Adopt directly** — schemas and agent logic are stable, internally consistent contracts that the frontend and agents can depend on:

- `evals.json` / `grading.json` / `benchmark.json` schemas (defined in `references/schemas.md`)
- `agents/grader.md` — spawned as a subagent from the sidecar
- `aggregate_benchmark.py` — invoked via `Bash` tool from the orchestrating agent
- The with/without comparison framing and benchmark aggregation logic
- The `feedback.json` review structure (`reviews[].run_id`, `reviews[].feedback`, `status`)
- The improvement loop heuristics (identify failing evals, generalize from feedback, re-test)

**Replace with app-native implementations** — the plugin's execution mechanisms were designed for a CLI environment with a browser and `claude -p` subprocess access:

| Plugin mechanism | App replacement |
|---|---|
| `generate_review.py` + HTML viewer | Frontend renders `benchmark.json` directly |
| `feedback.json` file download | React form → Tauri command → SQLite |
| Parallel subagents via Agent/Task tool | Two independent `startAgent` Tauri calls |
| `run_loop.py` via `claude -p` subprocess | `Bash` tool invocation from the sidecar agent; guarded in UI if CLI absent |
| Capture Intent / Interview sections | Skipped via system-prompt instruction; context pre-loaded from `decisions.json` |

---

## What Remains the Same

- **Workflow page** — all steps (Clarifications, Decisions, Generate) are unchanged.
- **Generate-skill agent** — the existing agent prompt with one added instruction: *"Skip Capture Intent and Interview. Context is pre-loaded in `user-context.md` and `decisions.json`. Proceed directly to Write the SKILL.md."*
- **Refine surface** — functionally identical to the current Refine page (multi-turn chat + diff viewer). It moves into a tab but its behaviour does not change.

---

## What Changes

- **Shell layout** — replaces the current layout with a Slack-style shell: 52px icon-only sidebar + 260px persistent skill list + main content area. No separate dashboard page; the skill list is the home state.
- **Skill list navigation** — each row gets a status dot and routes differently based on skill state (see Navigation Model below).
- **Usage page** — moves to Settings; no longer a top-level nav item.
- **Test page** — dropped. Single-test-case runs in the Evals tab cover the same need.
- **Refine page** — moves from a standalone route to a tab inside the Skill Workspace.

### Navigation Model

Each skill row shows an 8px status dot:

| Dot | Colour (OKLCH) | Meaning |
|---|---|---|
| Grey | `text-muted-foreground` | Never generated — workflow not started |
| Red | `oklch(0.570 0.180 25)` | Pending clarifications |
| Yellow | `oklch(0.760 0.160 60)` | Pending decisions |
| Green | `oklch(0.780 0.175 160)` | Generated, imported, or marketplace |
| Pulsing (any colour) | — | Agent currently running |

Row click routing:

| Skill state | Click opens | `···` menu |
|---|---|---|
| Never generated | Workflow | — |
| Running (pulsing) | Locked — no interaction | — |
| Pending clarifications / decisions | Workflow at the appropriate step | — |
| Generated | Workspace (Overview tab) | Redo Workflow (destructive) |
| Imported / Marketplace | Workspace (Overview tab) | — (no Redo Workflow) |

Imported and marketplace skills have full Workspace access (Overview, Refine, Evals, Description) but no Redo Workflow option because they were not created via the in-app workflow.

**Single-skill lock:** Only one skill may have an active workflow at a time. While any workflow is running, all other skill rows are locked: 45% opacity, lock icon overlay, `cursor-not-allowed`. The lock lifts when the running workflow completes or is cancelled.

**User flows** — three distinct entry points:

1. **New skill** — "+New Skill" button; creates the skill record and opens Workflow.
2. **Redo workflow** — destructive action in the `···` menu for generated skills only; confirms before clearing existing artifacts and restarting.
3. **Workspace** — default destination for any completed skill; accessed by clicking the row.

---

## What Is New

### Skill Workspace

The Workspace is the hub for all post-generation operations on a skill, with four tabs:

```text
Skill Workspace  /skills/:skillName
  ├── Overview     version history, quick stats
  ├── Refine       (existing surface, now a tab)
  ├── Evals        batch evaluation, feedback, benchmark
  └── Description  description optimization
```

### Evals Tab

See mockup `04-workspace-evals.html` for layout.

Data flow:

1. User adds test cases → written to `workspace/<skill>/evals/evals.json`
2. "Run All Evals" → two `startAgent` Tauri calls per test case, launched in the same turn (with-skill and without-skill/baseline), tracked separately in the agent store
3. Each agent streams `DisplayItem` events → rendered in its comparison column
4. On completion, grader subagent evaluates assertions → `grading.json` written per run
5. `aggregate_benchmark.py` produces `benchmark.json` in `workspace/<skill>/iteration-N/`
6. Frontend reads `benchmark.json` and renders benchmark bar + sheet
7. User submits reviews → `feedback.json` written to workspace, stored in SQLite

### Improvement State Machine

State is durable — persisted to SQLite and workspace files. Sessions can be paused and resumed.

```text
SKILL_CREATED
  → EVALS_DEFINED          (evals.json exists, no runs yet)
  → EVALS_RUNNING          (startAgent calls in flight)
  → AWAITING_REVIEW        (benchmark.json written, no feedback yet)
  → IMPROVING              (feedback.json submitted, improvement agent running)
  → EVALS_RUNNING          (next iteration)
  → ... repeat ...
  → DESCRIPTION_OPTIMIZED  (optional terminal state)
```

Each improvement cycle increments the skill version (v1, v2, v3). Versions map to git commits — each improvement agent run commits the updated SKILL.md.

### Description Tab

See mockup `06-workspace-description.html` for layout.

Invokes `run_loop.py` via `Bash` from the sidecar agent. The script handles train/test split, per-iteration eval runs, description improvement, and best-description selection by held-out score. Returns `best_description` in structured output.

---

## What This Is Not

- **Not a long-lived agent session** — no streaming session that blocks on user input. Each agent invocation is discrete; the loop is expressed in UI state, not session state.
- **Not a fork of the skill-creator plugin** — schemas and grader logic are used directly. The plugin evolves; this design inherits those improvements.

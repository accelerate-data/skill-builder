# Skill Tester — Design Note

**Issue:** VD-603
**Status:** Design finalized, pending implementation

---

## Problem

Skills are written to guide dbt coding agents — but there's no in-app way to see what a coding agent would actually *do* with a skill loaded vs without one. The existing Refine page is interactive and stateful (session accumulates context). What's needed is a clean, isolated test surface: enter a prompt, see how a coding agent plans differently with the skill, evaluate the delta.

---

## Approach

A dedicated **Test Skill** page (`/test`) — separate from Refine, read-only, stateless.

### Key constraints

| Constraint | Rationale |
|---|---|
| **Fresh process per run** | No session history, no context buildup — each run is a clean `claude -p` invocation |
| **Empty CLAUDE.md** | No workspace context injected — tests the skill in isolation |
| **Plan mode execution** | Shows what a dbt coding agent would *plan to do*, not just narrative advice — steps and files make the delta concrete |
| **Read-only** | No skill editing on this page — that's Refine's job |

### Execution model

Two parallel `claude -p` calls per run:

```
With skill:    claude -p --plugin-dir <temp_dir> --output-format stream-json
Without skill: claude -p --output-format stream-json
```

Both use a temp workspace with an empty `.claude/CLAUDE.md`. Neither carries prior conversation. The evaluator runs as a third call after both responses complete, receiving both plans and writing a narrative delta assessment.

---

## Layout

Three-zone layout: **prompt input → split plan panels → evaluator**.

```
┌─────────────────────────────────────────────────────────────────┐
│  TEST SKILL                [PLAN MODE]  [● dbt-fabric-skill ▾] │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ test prompt textarea (3 rows)                             │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                              [▶ Run Test]       │
├──────────────────────────────┬──────────────────────────────────┤
│  AGENT PLAN  [with skill]    │  AGENT PLAN  [no skill]          │
│  ─────────────────────────   │  ───────────────────────────     │
│  1  Step with Fabric-        │  1  Generic step                 │
│     specific guidance        │  2  Generic step                 │
│  2  Step with Salesforce-    │  3  Generic step                 │
│     aware enum guard         │                                  │
│  3  Incremental + lookback   │  Files: 2                        │
│  4  Weekly reconciliation    │  ✎ models/silver/customer.sql    │
│                              │  ✎ models/silver/schema.yml      │
│  Files: 3                    │                                  │
│  ✎ models/silver/customer.sql│                                  │
│  ✎ models/silver/schema.yml  │                                  │
│  + models/recon/customer.sql │                                  │
├──────────────────────────────┴──────────────────────────────────┤  ← drag
│  EVALUATOR                                                       │
│  ─────────────────────────────────────────────────────────────  │
│  ↑  Skill adds Fabric-specific context — lookback window and CDC lag handling absent from baseline.  │
│  ↑  Step count higher with skill (4 vs 3) — reconciliation model is a production-relevant addition. │
│  ↑  Enum guard is Salesforce-aware; baseline uses generic values that will miss real picklist values.│
│  ↓  Neither plan addresses SCD Type 2 — customer table at silver often needs history tracking.      │
│  ↓  Test severity levels (warn vs error) absent from both plans.                                    │
├─────────────────────────────────────────────────────────────────┤
│  ● completed · dbt-fabric-skill · plan mode · 2.3s              │
└─────────────────────────────────────────────────────────────────┘
```

### Panel details

**Agent Plan (with skill / no skill)**
- Displays plan mode output: summary sentence, numbered steps, files to create/modify
- Monospace font, step numbers in blue, file icons (`✎` modify, `+` create)
- Both panels stream simultaneously; vertical divider is draggable (22–78% bounds)

**Evaluator**
- Single scrollable list; one sentence per bullet
- `↑` green = improvement the skill produced
- `↓` red = gap present in both or regression
- Starts after both plan responses complete

---

## What the evaluator sees

The evaluator call receives:
- The original test prompt
- The full with-skill plan response
- The full no-skill plan response

It does **not** receive the skill content itself — it judges the output, not the intent. This keeps it honest: if the skill didn't guide the agent toward better plans, the evaluator will say so.

Evaluator prompt focus:
1. Where did the skill produce concretely different steps or files?
2. What domain-specific guidance appeared only in the with-skill plan?
3. What gaps remain in both plans (skill didn't help here)?

---

## What this is not

- **Not the full eval harness** — no 7-dimension scoring rubric, no multi-prompt batch runs, no JSON output. That's `scripts/eval/eval-skill-quality.sh`.
- **Not a chat interface** — no multi-turn, no session, no message history.
- **Not Refine** — no skill editing, no file diffs, no agent session persistence.

---

## Visual reference

See `mockup.html` in this folder — open in any browser.

---

## Implementation notes

- Route: `/test`, sidebar nav entry alongside Refine
- State: local component state only, clears on new run (no Zustand store needed)
- Transport: new Rust command `run_skill_test(skill_name, prompt)` → spawns two parallel `tokio::process::Command` children, emits Tauri events for streaming
- Evaluator: third `claude -p` call after both streams complete, no plugin dir
- Temp workspace: create per-run dir in `$TMPDIR` with empty `.claude/CLAUDE.md`, clean up after run

---

## How the prompt is used

The user enters a single prompt in the textarea. That **same text is sent verbatim** to both the with-skill and without-skill plan agents — no wrapping or prefix is added.

The difference between the two runs is the **working directory**, not the prompt. Each agent's working directory contains a pre-populated `.claude/CLAUDE.md`:

- **Without skill**: skill-test context only (`skills/skill-test/SKILL.md` body)
- **With skill**: skill-test context + the user's skill body under `## Active Skill: {name}`

The SDK loads the workspace CLAUDE.md automatically, so each agent receives different ambient context while processing the same user prompt.

After both plans complete, the evaluator receives a constructed prompt containing the original user prompt, Plan A (with-skill output), and Plan B (without-skill output), and is asked to score differences using the Evaluation Rubric from the skill-test context.

See [PROMPTS.md](PROMPTS.md) in this folder for the exact prompt strings sent to each agent.

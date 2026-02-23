# Skill Tester

**Issue:** VD-603

---

## Purpose

The Skill Tester lets you run a single prompt against a coding agent twice — once with your skill loaded, once without — and see a side-by-side plan comparison with an automated evaluation of the delta.

Each run is stateless: fresh agent processes, no prior conversation, no accumulated context. This makes the skill's influence on agent behaviour visible in isolation.

---

## How it works

Two plan agents run in parallel, then an evaluator runs after both complete.

| Run | What the agent sees |
|---|---|
| **With skill** | skill-test context + your skill body |
| **Without skill** | skill-test context only |

Both agents receive the same user prompt. The difference is entirely in the workspace context loaded by each agent. After both plans complete, a third evaluator agent compares them and scores the delta across the six rubric dimensions.

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

**Plan panels** stream simultaneously. The vertical divider is draggable.

**Evaluator** starts after both plan agents complete. `↑` = improvement the skill produced. `↓` = gap in both plans or regression. Followed by a Recommendations section with actionable suggestions for improving the skill.

---

## What the evaluator sees

The evaluator receives the original prompt, the full with-skill plan, and the full without-skill plan. It does **not** receive the skill content itself — it judges the output, not the intent. If the skill didn't guide the agent toward better plans, the evaluator will say so.

---

## What this is not

- **Not the full eval harness** — no 7-dimension scoring rubric, no multi-prompt batch runs, no JSON output. That's `scripts/eval/eval-skill-quality.sh`.
- **Not a chat interface** — no multi-turn, no session, no message history.
- **Not Refine** — no skill editing, no file diffs, no agent session persistence.

---

## Prompts

See [PROMPTS.md](PROMPTS.md) for the exact prompt strings sent to each agent — workspace context formats, plan agent prompt, and evaluator prompt.

## Visual reference

See `mockup.html` in this folder — open in any browser.

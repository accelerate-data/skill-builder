# Skill Tester — Prompts

Three agents run per test: two plan agents in parallel, then one evaluator after both complete.

---

## Plan agents

Both agents receive the same user-supplied prompt verbatim. What differs is the context each agent loads from its workspace.

### Without-skill workspace context

```
# Test Workspace

## Skill Context

{skill-test body — see below}
```

### With-skill workspace context

```
# Test Workspace

## Skill Context

{skill-test body — see below}

---

## Active Skill: {skill_name}

{user's skill body}
```

### Skill-test context (injected into both workspaces)

```
## Test Context

You are assisting an **analytics engineer** answering a business question using dbt. The goal is **plan mode**: identify what dbt models need to be built or modified in a **dbt lakehouse** (silver and gold layers).

When asking clarifying questions or forming a plan, orient toward:

| Area | What to uncover |
| -- | -- |
| **Silver vs gold** | Which lakehouse layer does this model belong to? |
| **dbt project structure** | Where does this model fit — staging, intermediate, marts? |
| **dbt tests** | What unit tests (no materialization, fast) vs data tests are needed? |
| **dbt contracts** | What contract changes are required for this model? |
| **Semantic model** | What metrics, entities, or measures need to be added to the semantic layer? |

Do not respond as a generic coding assistant. The user is an analytics engineer building a lakehouse — every question and recommendation should reflect that context.

---

## Evaluation Rubric

You are comparing two plans produced for the same analytics engineering task:

- **Plan A** — produced with a skill loaded
- **Plan B** — produced with no skill loaded

Score each dimension **comparatively (A vs B)** only if it is **relevant to the test prompt**. Skip dimensions the prompt does not touch.

### Dimensions

| Dimension | What to score |
| -- | -- |
| **Silver vs gold** | Does the response correctly identify which lakehouse layer the model belongs to? |
| **dbt project structure** | Does it correctly place models within a typical dbt project structure (staging → intermediate → marts)? |
| **dbt tests** | Does it differentiate unit tests (quick, no materialization) from data tests, and recommend the right ones? |
| **Unit test cases** | Does it identify specific assertions to write for unit testing vs what requires data tests? |
| **dbt contracts** | Does it identify the impact on dbt model contracts? |
| **Semantic model** | Does it identify what to add to the semantic layer (metrics, entities, measures)? |

### Scoring rules

- **Always A vs B** — never evaluate either plan in isolation
- **Never score**: "B didn't use the skill" — that is the test setup, not an insight
- **Never score surface observations**: generic intros, formatting, length, response structure
- Prefix with ↑ if the skill improved the plan on this dimension
- Prefix with ↓ if there is a gap or regression
- Output ONLY bullet points, one per line, no other text
```

Note: both plan agents see the Evaluation Rubric in their workspace context but are not asked to use it — it exists for the evaluator.

### Plan agent prompt

```
{user input}
```

---

## Evaluator

Starts after both plan agents complete. Runs with the without-skill workspace context — sees the skill-test context only, not the user's skill body.

### Evaluator prompt

```
Task prompt:
"""
{user input}
"""

Plan A (with skill "{skill_name}" loaded):
"""
{with-skill plan output}
"""

Plan B (no skill loaded):
"""
{without-skill plan output}
"""

Use the Evaluation Rubric from your context to compare the two plans.

First, output bullet points (one per line) using:
- ↑ if Plan A (with skill) is meaningfully better on this dimension
- ↓ if Plan B (no skill) is meaningfully better on this dimension
- → if both plans are similar, weak, or neither is clearly better

Then output a "## Recommendations" section with 2-4 specific, actionable suggestions for how to improve the skill based on the evaluation. Focus on gaps where Plan A underperformed or where the skill could have provided more guidance.
```

---

## What each agent sees

| Agent | Context | Prompt |
|---|---|---|
| Plan agent (with skill) | skill-test context + user's skill body | user input |
| Plan agent (without skill) | skill-test context only | user input (identical) |
| Evaluator | skill-test context only | both plans + user input embedded |

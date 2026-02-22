---
name: skill-test
description: Test context and evaluation rubric for dbt lakehouse planning skill tests
domain: Skill Builder
type: skill-builder
---

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

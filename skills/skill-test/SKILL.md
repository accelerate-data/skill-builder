---
name: skill-test
description: >
  Analytics engineer framing and dbt-specific evaluation rubric for skill test runs.
version: 1.0.0
model: sonnet
argument-hint: ""
user-invocable: false
disable-model-invocation: false
---

## Test Context

You are an **analytics engineer** planning **dbt models** for a **Microsoft Fabric** lakehouse. Given a data or business requirement, identify which dbt models to create or modify, their lakehouse layer (**silver** = clean, source-aligned; **gold** = business-ready aggregates), and project placement.

Orient questions and plans toward:

| Area | What to uncover |
| -- | -- |
| **Silver vs gold** | Which lakehouse layer? |
| **Model transformations** | Joins, aggregations, business rules, derived columns, grain? |
| **dbt project structure** | Staging, intermediate, or marts? |
| **dbt tests** | Unit tests vs data tests? |
| **dbt contracts** | Contract changes required? |
| **Semantic model** | Metrics, entities, or measures to add? |
| **Fabric endpoint & adapter** | Lakehouse or Warehouse endpoint? dbt-fabric adapter constraints (materialization, merge strategy, incremental)? |

---

## Evaluation Rubric

Compare two plans for the same task:

- **Plan A** — skill loaded
- **Plan B** — no skill loaded

Score each dimension **A vs B** only if **relevant to the test prompt**. Skip irrelevant dimensions.

### Dimensions

| Dimension | What to score |
| -- | -- |
| **Silver vs gold** | Correct lakehouse layer identification? |
| **Model transformations** | Correct joins, aggregations, business rules, derived columns, grain? |
| **dbt project structure** | Correct placement (staging → intermediate → marts)? |
| **dbt tests** | Unit tests vs data tests correctly differentiated? |
| **Unit test cases** | Specific assertions for unit vs data tests? |
| **dbt contracts** | Contract impact identified? |
| **Semantic model** | Semantic layer additions identified? |
| **Fabric endpoint & adapter** | Target endpoint and dbt-fabric constraints (merge strategy, incremental) addressed? |

### Scoring rules

- **Always A vs B** — never evaluate in isolation
- **Never score** "B didn't use the skill"
- **Never score** formatting, length, structure
- ↑ = skill improved this dimension
- ↓ = gap or regression
- Output ONLY bullet points, one per line

# Scoring Rubric for Dimension Selection

---

## Scoring Frame

For every dimension, ask: **"What would a data engineer joining this team need to know to build correct dbt silver/gold models on day one that Claude can't already tell them?"**

Score only on the **delta** — customer-specific and domain-specific knowledge gaps. Standard methodologies (Kimball, SCD types, star schemas, standard object models) are not delta.

---

## Scoring Rubric

| Score | Meaning | Action |
|-------|---------|--------|
| 5 | Critical delta — engineer will produce wrong models without this | Always include |
| 4 | High value — non-obvious knowledge that saves significant rework | Include if in top 5 |
| 3 | Moderate — useful but Claude's parametric knowledge covers 70%+ | Skip — note as companion candidate |
| 2 | Low — mostly standard knowledge, small delta | Skip |
| 1 | Redundant — Claude already knows this well | Skip |

---

## Topic Relevance Pre-Check

Before scoring, decide whether the domain is legitimate for the given purpose.

**Not relevant** (e.g., "pizza-jokes" for a data engineering skill):
- `topic_relevance: not_relevant`, `dimensions_evaluated: 0`, `dimensions_selected: 0`
- Empty selected list with brief explanation. Return immediately.

**Plausibly relevant**: proceed with scoring.

---

## Step-by-Step Scoring Instructions

### 1. Evaluate each candidate dimension

For each of the 5–6 candidate dimensions from the type-scoped set:

1. Assign a score (1–5) using the rubric above
2. Write a one-sentence reason grounded in the domain
3. Write a tailored focus line (see Tailored Focus Line guidelines below)
4. For scores 2–3, note a companion skill candidate that could cover this area

### 2. Select top dimensions

Pick the top 3–5 scoring dimensions. Prefer quality of coverage over exact count.

### 3. Return the scored dimension table

Use the canonical format in the Scoring Output Format section below.

---

## Tailored Focus Line Guidelines

1–2 sentence instruction to the dimension research agent. Must be specific enough to begin researching immediately.

**Good:** "Identify sales pipeline metrics like coverage ratio, win rate, velocity, and where standard formulas diverge from company-specific definitions — e.g. whether win rate counts all closes or only qualified-stage entries."

**Poor:** "Identify key business metrics."

### Requirements:

- Reference domain-specific entities, metric names, pattern types, or platform specifics
- Identify what diverges from standard practice
- Be self-contained
- Scope to the delta

---

## Scoring Output Format

Canonical format for the `=== RESEARCH PLAN ===` section:

```markdown
---
purpose: [purpose]
domain: [domain name]
topic_relevance: relevant | not_relevant
dimensions_evaluated: [count of all scored dimensions]
dimensions_selected: [count of selected dimensions]
---
# Research Plan

## Skill: [domain name] ([purpose])

## Dimension Scores

| Dimension | Score | Reason | Companion Note |
|-----------|-------|--------|----------------|
| [slug] | [1-5] | [one-sentence reason] | [optional] |
| ... | ... | ... | ... |

## Selected Dimensions

| Dimension | Focus |
|-----------|-------|
| [slug] | [tailored focus line] |
| ... | ... |
```

`dimensions_evaluated` and `dimensions_selected` must be accurate counts.

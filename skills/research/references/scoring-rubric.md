# Scoring Rubric for Dimension Selection

This file defines the scoring criteria used in Step 2 of the research skill. The skill coordinator scores each candidate dimension against the domain inline (no sub-agent) using extended thinking, then selects the top 3–5 dimensions for parallel research.

---

## Scoring Frame

For every dimension, ask: **"What would a data engineer joining this team need to know to build correct dbt silver/gold models on day one that Claude can't already tell them?"**

Skills encode the **delta** — the customer-specific and domain-specific knowledge that Claude gets wrong or misses when working without the skill. Claude already knows standard methodologies (Kimball, SCD types, star schemas, standard object models) from training. Score only on non-obvious, domain-specific knowledge gaps.

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

Before scoring any dimensions, decide whether the domain is a legitimate topic for the given skill type.

**If the domain is clearly not relevant** (e.g., "pizza-jokes" for a data engineering skill, or a non-data topic for any skill type):

- Score: `topic_relevance: not_relevant`
- Set `dimensions_evaluated: 0`, `dimensions_selected: 0`
- Return an empty selected list with a brief explanation
- Do not attempt to score dimensions — return immediately

**If the domain is plausibly relevant**, proceed with scoring all type-scoped candidate dimensions.

---

## Step-by-Step Scoring Instructions

### 1. Evaluate each candidate dimension

For each of the 5–6 candidate dimensions from the type-scoped set:

1. Assign a score (1–5) using the rubric above
2. Write a one-sentence reason grounded in the domain
3. Write a tailored focus line (see Tailored Focus Line guidelines below)
4. For scores 2–3, note a companion skill candidate that could cover this area

### 2. Select top dimensions

Pick the top scoring dimensions. Aim for 3–5 selections. Do not apply a hard cap — prefer quality of coverage over meeting a target count.

### 3. Return the scored dimension table

Return a scored dimension table as part of the `=== RESEARCH PLAN ===` section in your inline response. Use the canonical format shown in the Scoring Output Format section below.

---

## Tailored Focus Line Guidelines

The focus line is a 1–2 sentence instruction to the dimension research agent. It must be specific enough that the agent can begin researching immediately without additional context.

**Good focus line:** "Identify sales pipeline metrics like coverage ratio, win rate, velocity, and where standard formulas diverge from company-specific definitions — e.g. whether win rate counts all closes or only qualified-stage entries."

**Poor focus line:** "Identify key business metrics."

### Requirements for focus lines:

- Reference domain-specific entities, metric names, pattern types, or platform specifics
- Identify what is likely to diverge from standard practice
- Be self-contained — the agent receives this line alongside the domain name and dimension spec
- Scope to the delta: what Claude gets wrong, not what Claude knows well

---

## Scoring Output Format

The scored dimension table is returned as part of the `=== RESEARCH PLAN ===` section. Use this canonical format:

```markdown
---
skill_type: [skill_type]
domain: [domain name]
topic_relevance: relevant | not_relevant
dimensions_evaluated: [count of all scored dimensions]
dimensions_selected: [count of selected dimensions]
---
# Research Plan

## Skill: [domain name] ([skill_type])

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

The YAML frontmatter fields `dimensions_evaluated` and `dimensions_selected` must be accurate counts.

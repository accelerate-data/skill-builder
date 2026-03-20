# Scoring Rubric for Dimension Scoring

---

## Scoring Frame

For every dimension, ask: **"What would a data engineer joining this team need to know to build correct dbt silver/gold models on day one that Claude can't already tell them?"**

Score only on the **delta** — customer-specific and domain-specific knowledge gaps. Standard methodologies (standard data modeling approaches, standard source system data models, standard business processes, standard source system configurations) are not delta.

---

## Scoring Rubric

| Score | Meaning | Interpretation |
| ----- | ------- | -------------- |
| 5 | Critical delta — engineer will produce wrong models without this | Highest-priority signal for downstream selection |
| 4 | High value — non-obvious knowledge that saves significant rework | Strong signal for downstream selection |
| 3 | Moderate — useful but Claude's parametric knowledge covers 70%+ | Conditional signal; include only if needed for minimum viable coverage |
| 2 | Low — mostly standard knowledge, small delta | Low signal; generally not selected |
| 1 | Redundant — Claude already knows this well | Minimal signal; generally not selected |

---

## Step-by-Step Scoring Instructions

### 1. Evaluate each candidate dimension

For each of the candidate dimensions from the type-scoped set:

1. Assign a score (1–5) using the rubric above
2. Write a one-sentence reason grounded in the domain
3. Write a tailored focus line (see Tailored Focus Line guidelines below)

### 2. Emit summary table and construct scoring JSON internally

After scoring all dimensions, emit a **markdown summary table** as your visible text output so the user sees a scannable overview:

| Dimension | Score | Reason |
| --------- | ----- | ------ |
| <slug> | <1-5> | <one-sentence reason> |

Include one row per evaluated dimension. This table is the only scoring output the user should see.

Then construct the scoring JSON object internally using the canonical format in the Scoring Output Format section below. **Do not emit the JSON as visible text output.** The JSON is consumed programmatically by downstream steps, not displayed to the user.

---

## Tailored Focus Line Guidelines

1–2 sentence instruction to the dimension research agent. Must be specific enough to begin researching immediately.

**Good:** "Identify sales pipeline metrics like coverage ratio, win rate, velocity, and where standard formulas diverge from company-specific definitions — e.g. whether win rate counts all closes or only qualified-stage entries."

**Poor:** "Identify key business metrics."

### Requirements

- Reference domain-specific entities, metric names, pattern types, or platform specifics
- Identify what diverges from standard practice
- Be self-contained
- Scope to the delta

---

## Scoring Output Format (internal construction only — do not emit as text output)

Canonical scoring JSON object — construct this internally for downstream consumption:

```json
{
  "purpose": "<purpose label>",
  "domain": "<domain name>",
  "topic_relevance": "relevant|not_relevant",
  "candidate_dimension_scores": [
    {
      "name": "<dimension slug>",
      "score": 1,
      "reason": "<one-sentence reason grounded in domain delta>",
      "focus": "<tailored focus line for this dimension>"
    }
  ]
}
```

Rules:

- Include one `candidate_dimension_scores` entry per evaluated dimension.
- Each entry must include non-empty `name`, `reason`, and `focus`, plus integer `score`.
- `score` must use the rubric scale (1-5).
- Set `topic_relevance` deterministically:
  - `"not_relevant"` when all candidate scores are `<=2`
  - `"relevant"` otherwise
- Do not perform selection or branching in this rubric output.

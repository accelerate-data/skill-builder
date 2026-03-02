---
name: research
description: >
  Runs the research phase for a skill. Use when researching dimensions and producing
  clarifications for a purpose and domain. Returns a scored dimension table and
  complete clarifications.json content as inline text with === RESEARCH PLAN === and
  === CLARIFICATIONS === delimiters.
---

# Research Skill

Given a `purpose` and `domain`, produce two inline-text outputs:

1. A scored dimension table (becomes `research-plan.md`)
2. Complete `clarifications.json` content in canonical JSON format

Pure computation — takes inputs, returns inline text, writes nothing to disk.

---

## Inputs

| Input | Values | Example |
|-------|--------|---------|
| `purpose` | Purpose label or token (use mapping table below to resolve) | `"Business process knowledge"` |

## Purpose → Dimension Set Mapping

| Purpose (label or token) | Dimension set |
|---|---|
| Business process knowledge (`domain`) | Domain Dimensions |
| Source system customizations (`source`) | Source Dimensions |
| Organization specific data engineering standards (`data-engineering`) | Data-Engineering Dimensions |
| Organization specific Azure or Fabric standards (`platform`) | Platform Dimensions |

---

## Step 1 — Select Dimension Set

Read `references/dimension-sets.md`. Match the purpose to its dimension set section (5-6 candidate dimensions with slugs).

---

## Step 2 — Score and Select (Inline, Extended Thinking)

Read `references/scoring-rubric.md`.

Use **extended thinking**. Score each candidate dimension against the domain inline — no sub-agent.

### Pre-check: topic relevance

If the domain is clearly not relevant for the purpose, produce `=== RESEARCH PLAN ===` with `topic_relevance: not_relevant` and an empty selected list, then stop.

### Scoring

For each candidate dimension, apply the rubric and follow `references/scoring-rubric.md`.

### Selection

Select the top 3–5 dimensions by score. Prefer quality of coverage over exact count.

---

## Step 3 — Parallel Dimension Research

For each selected dimension, read `references/dimensions/{slug}.md`.

Spawn a Task sub-agent per dimension. Pass the full user context. Construct the Task prompt:

```text
You are researching the {dimension_name} dimension for a {purpose} skill about {skill_name}.

{full content of references/dimensions/{slug}.md}

Tailored focus: {tailored focus line from Step 2}

## User Context
{paste the full user context received from the orchestrator — purpose, description, what Claude needs to know, industry, function, etc.}

Return detailed research text covering the dimension's questions and decision points for this skill. 500–800 words. Return raw research text only — no headings, no JSON, no structured format. Write as if briefing a colleague who needs to understand the key questions and tradeoffs for this dimension in the context of {skill_name}. Use the user context above to tailor the research to their specific environment.
```

Wait for all Tasks to return before proceeding to Step 4.

---

## Step 4 — Consolidate

Read `references/consolidation-handoff.md`. Follow its instructions to deduplicate and synthesize all dimension Task outputs into canonical `clarifications.json` content (valid JSON).

**CRITICAL — the output JSON MUST use this exact top-level structure:**

```json
{
  "version": "1",
  "metadata": { "title": "...", "question_count": N, "section_count": N, "refinement_count": 0, "must_answer_count": N, "priority_questions": [...], "duplicates_removed": N, "scope_recommendation": false },
  "sections": [ { "id": "S1", "title": "...", "description": "...", "questions": [ { "id": "Q1", "title": "...", "must_answer": true, "text": "...", "choices": [...], "recommendation": "...", "answer_choice": null, "answer_text": null, "refinements": [] } ] } ],
  "notes": []
}
```

Do NOT invent alternative structures like `{"clarifications": [...]}` or flat question arrays. The downstream UI parser requires exactly `sections[].questions[]`.

---

## Return Format

Return inline text with two delimited sections. Delimiter lines must be exactly as shown:

```text
=== RESEARCH PLAN ===
---
purpose: [purpose]
domain: [domain name]
topic_relevance: relevant
dimensions_evaluated: [count]
dimensions_selected: [count]
---
# Research Plan

## Skill: [domain name] ([purpose])

## Dimension Scores

| Dimension | Score | Reason | Companion Note |
|-----------|-------|--------|----------------|
| [slug] | [score] | [one-sentence reason] | [optional] |

## Selected Dimensions

| Dimension | Focus |
|-----------|-------|
| [slug] | [tailored focus line] |

=== CLARIFICATIONS ===
{
  "version": "1",
  "metadata": {
    "title": "Clarifications: [Domain Name]",
    "question_count": [n],
    "section_count": [n],
    "refinement_count": 0,
    "must_answer_count": [n],
    "priority_questions": ["Q1", "Q3"],
    "duplicates_removed": [n],
    "scope_recommendation": false
  },
  "sections": [
    {
      "id": "S1",
      "title": "Section Name",
      "description": "...",
      "questions": [
        {
          "id": "Q1",
          "title": "Short Title",
          "must_answer": true,
          "text": "Full question text...",
          "consolidated_from": ["Metrics Research"],
          "choices": [
            {"id": "A", "text": "Choice A", "is_other": false},
            {"id": "B", "text": "Choice B", "is_other": false},
            {"id": "D", "text": "Other (please specify)", "is_other": true}
          ],
          "recommendation": "A — reasoning...",
          "answer_choice": null,
          "answer_text": null,
          "refinements": []
        }
      ]
    }
  ],
  "notes": []
}
```

Both sections must be present. The `=== CLARIFICATIONS ===` section must be valid JSON matching the full schema in `references/consolidation-handoff.md`.

---

## Error Handling

**Topic not relevant**: Return `=== RESEARCH PLAN ===` with `topic_relevance: not_relevant` and empty selected list. Return `=== CLARIFICATIONS ===` with a minimal JSON object: `version: "1"`, metadata with `question_count: 0`, `section_count: 0`, `duplicates_removed: 0`, `refinement_count: 0`, `must_answer_count: 0`, `priority_questions: []`, `scope_recommendation: true`, empty `sections` array, and a single note explaining inapplicability.

**Dimension Task failure**: Proceed with available outputs. Mark failed dimensions in the scored table with `score: 0` and reason `"Research task failed"`. Exclude from selected dimensions.

**No dimensions selected**: If all dimensions score 2 or below, select the single highest-scoring dimension (minimum score 2) and run research for it.

---

## Output Checklist

- Both `=== RESEARCH PLAN ===` and `=== CLARIFICATIONS ===` sections present
- `=== CLARIFICATIONS ===` content is valid JSON matching the schema in `references/consolidation-handoff.md`
- `metadata` counts accurate (`question_count`, `section_count`, `must_answer_count`)
- Every question has 2-4 choices + "Other (please specify)" with `is_other: true`
- Every question has a `recommendation` field
- `metadata.priority_questions` lists all question IDs where `must_answer: true`
- `metadata.refinement_count` is `0`
- All `answer_choice` and `answer_text` values are `null`
- All `refinements` arrays are empty `[]`

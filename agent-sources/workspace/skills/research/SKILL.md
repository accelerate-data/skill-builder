---
name: research
description: >
  Runs the research phase for a skill. Use when researching dimensions and producing
  clarifications for a purpose and domain. Returns a scored dimension table and
  complete clarifications.json content as inline text with === RESEARCH PLAN === and
  === CLARIFICATIONS === delimiters.
---

# Research Skill

## Overview

Given a `purpose` and `domain`, produce two inline-text outputs:

1. A scored dimension table (becomes `research-plan.md`)
2. Complete `clarifications.json` content in canonical JSON format

Pure computation. Read inputs and references, return inline output, write nothing to disk.

## Quick Reference

- Resolve `purpose` to one dimension set from `references/dimension-sets.md`
- Score all candidate dimensions using `references/scoring-rubric.md`
- Select top 3-5 dimensions (or one fallback when all scores are low)
- Run parallel sub-agent research for selected dimensions
- Consolidate using `references/consolidation-handoff.md`
- Return exactly two sections: `=== RESEARCH PLAN ===` and `=== CLARIFICATIONS ===`

## Inputs

| Input | Values | Example |
|-------|--------|---------|
| `purpose` | Purpose label or token (use mapping table below) | `"Business process knowledge"` |
| `domain` | Skill domain name | `"Revenue Recognition"` |
| `skill_name` | Skill slug/name | `"revenue-domain"` |
| `user_context` | Full user context payload | inline object/text |

## Purpose → Dimension Set Mapping

| Purpose (label or token) | Dimension set |
|---|---|
| Business process knowledge (`domain`) | Domain Dimensions |
| Source system customizations (`source`) | Source Dimensions |
| Organization specific data engineering standards (`data-engineering`) | Data-Engineering Dimensions |
| Organization specific Azure or Fabric standards (`platform`) | Platform Dimensions |

## Step 1 — Select Dimension Set

Read `references/dimension-sets.md` and select the matching section.

## Step 2 — Score and Select

Read `references/scoring-rubric.md`.

Use extended thinking and score each candidate dimension inline.

### Pre-check: topic relevance

If domain is not relevant to the purpose, return `topic_relevance: not_relevant` with empty selected dimensions and stop.

### Selection rules

- Select top 3-5 dimensions by score.
- Prefer coverage quality over exact count.
- If every score is <=2, select one highest-scoring dimension (minimum 2).

## Step 3 — Parallel Dimension Research

For each selected dimension:

- Read `references/dimensions/{slug}.md`
- Spawn one Task sub-agent per selected dimension
- Pass full user context and tailored focus line
- Require raw research text only (500-800 words)

Wait for all tasks before consolidation.

## Step 4 — Consolidate

Read `references/consolidation-handoff.md` and produce canonical `clarifications.json`.

Use this exact top-level shape:

```json
{
  "version": "1",
  "metadata": {
    "title": "...",
    "question_count": 0,
    "section_count": 0,
    "refinement_count": 0,
    "must_answer_count": 0,
    "priority_questions": [],
    "duplicates_removed": 0,
    "scope_recommendation": false
  },
  "sections": [],
  "notes": []
}
```

Do not emit alternative JSON structures.

## Return Format

Return inline text with exactly these delimiters:

```text
=== RESEARCH PLAN ===
[content]
=== CLARIFICATIONS ===
[valid JSON]
```

Both sections are required.

## Error Handling

- Topic not relevant: emit empty selected dimensions + minimal clarifications JSON with `scope_recommendation: true`.
- Dimension task failure: score failed dimensions as `0`, reason `Research task failed`, continue with available results.
- No dimensions selected: force-select one fallback dimension as above.

## Output Checklist

- Both required delimited sections present
- Clarifications section is valid JSON
- `metadata` counts are accurate
- Each question includes 2-4 choices plus `Other (please specify)` with `is_other: true`
- `recommendation` present on every question
- `answer_choice` and `answer_text` are `null`
- `refinements` arrays are empty

## Reference Files

- `references/dimension-sets.md`: dimension candidates by purpose
- `references/scoring-rubric.md`: scoring rules and thresholds
- `references/dimensions/{slug}.md`: per-dimension research prompts
- `references/consolidation-handoff.md`: canonical clarifications schema

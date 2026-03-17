---
name: research
description: ALWAYS use this skill when producing clarification questions for any skill-building purpose (domain, source, data-engineering, platform). Invoke immediately in the research phase: score candidate dimensions, select top dimensions, run parallel dimension research, and return the complete clarifications.json payload. Do not attempt to produce clarifications without using this skill.
user_invocable: false
---

# Research Skill needs

Given a `purpose`, produce clarification questions which can be used for writing the skill. 
The overall flow is as follows 

- Resolve `purpose` to one dimension set from `references/dimension-sets.md`
- Score all candidate dimensions using `references/scoring-rubric.md`
- Emit scope recommendation output when rubric `topic_relevance` is `not_relevant`.
- Select top 3-5 dimensions when viable.
- Run parallel sub-agent research for selected dimensions
- Consolidate using `references/consolidation-handoff.md`
- Validate final payload against `references/schemas.md`
- Return the canonical `clarifications.json` object as top-level JSON

## Step 1 — Select Dimension Set

Read `references/dimension-sets.md` and select the matching section.
Use table below to resolve `purpose` to one dimension set from `references/dimension-sets.md`

| Purpose (label or token) | Dimension set |
| --- | --- |
| Business process knowledge (`domain`) | Domain Dimensions |
| Source system customizations (`source`) | Source Dimensions |
| Organization specific data engineering standards (`data-engineering`) | Data-Engineering Dimensions |
| Organization specific Azure or Fabric standards (`platform`) | Platform Dimensions |

## Step 2 — Score dimensions

Use the `references/scoring-rubric.md` to produce scoring-only JSON for all candidate dimensions.
Use that scoring JSON to construct `metadata.research_plan` which is part of clarifications.json and schema defined in `references/schemas.md`.

- Set `topic_relevance` from scoring JSON (`relevant|not_relevant`).
- Set `dimensions_evaluated` from the count of entries in the candidate_dimension_scores array in scoring JSON
- Set `dimension_scores` from `candidate_dimension_scores` (`name`, `score`, `reason`, `focus`).
- If `topic_relevance` is `not_relevant`, return canonical minimal/scope-recommendation clarifications output per `references/schemas.md` with:
  - `metadata.scope_recommendation: true`
  - `metadata.scope_reason`: one-sentence explanation of why no dimensions scored high enough
  - `metadata.warning.code: "all_dimensions_low_score"`
  - `metadata.warning.message`: concise explanation for UI
  - `metadata.research_plan` present and schema-valid with minimal values per `references/schemas.md` Scope/Error Minimal Output (including `topic_relevance: "not_relevant"`, zero counts, and empty selected arrays)
  - zero selected dimensions.

## Step 3 - Select dimensions for research

Apply these only when `topic_relevance` is `relevant`.

- Select top 3-5 dimensions by score.
- Prefer coverage quality over exact count.
- Prefer dimensions scored 4-5.
- Include score = 3 dimensions only when needed for minimum viable coverage.

Update the `metadata.research_plan` created in Step 2.

- Set `selected_dimensions` as an array of `{ name, focus }` objects copied from the selected `dimension_scores` entries.
- Set accurate counts `dimensions_selected`.

## Step 4 — Parallel Dimension Research

For each selected dimension object in `metadata.research_plan.selected_dimensions`:

- Spawn one Task sub-agent per selected dimension. Mode: `bypassPermissions`.
- Wait for all tasks before consolidation.

### Sub-agent prompt

Spawn each sub-agent with the following prompt verbatim, substituting `{name}`, `{focus}`, and `{user_context}`:

---
**Dimension**: {name}
**Focus**: {focus}

{user_context}

Read `references/dimensions/{name}.md`.

Your output should be raw research text only (500-800 words).
Frame your research such that user responses will answer:
- What should this skill enable Claude to do?
- When should this skill trigger?
- What's the expected output format?
- Should we set up test cases?

Proactively think about edge cases, input/output formats, example files, success criteria, and dependencies.

---

## Step 5 — Consolidate

- Use `references/consolidation-handoff.md` to produce `clarifications_json`. 
- Return the results as JSON only (no wrappers and no additional text). 

  ```json
  {
    "dimensions_selected": `metadata.research_plan.dimensions_selected` ,
    "question_count": `metadata.question_count` from `clarifications_json`, 
    "research_output" : { 
      "version": "1",
      "metadata": {
        "question_count": `metadata.question_count` from `clarifications_json`,
        "section_count": `metadata.section_count` from `clarifications_json`,
        "refinement_count": `metadata.refinement_count` from `clarifications_json`,
        "must_answer_count": `metadata.must_answer_count` from `clarifications_json`,
        "priority_questions": `metadata.priority_questions` from `clarifications_json`,
        "scope_recommendation": `metadata.scope_recommendation` from `clarifications_json`,
        "scope_reason": `metadata.scope_reason` from `clarifications_json`,
        "warning": {... : `metadata.warning` } , 
        "error": null,
        "research_plan" : `metadata.research_plan`
      }
      "sections": `sections` from `clarifications_json`,
      "notes" : `notes` from `clarifications_json`,
      "answer_evaluator_notes": []
    }
  }
  ```

### Output Contract

1. `research_output` should follow the the canonical clarifications JSON object. 
2. Before returning:

- Validate against `references/schemas.md` exactly.
- Ensure `metadata.research_plan` is present and schema-valid.
- Ensure `metadata.research_plan.selected_dimensions` is present as `{ name, focus }` objects aligned to selected dimensions.
- Preserve note separation (`notes` vs `answer_evaluator_notes`). Always emit `answer_evaluator_notes: []` — this field is populated by a downstream agent after user answers are evaluated, never during research.
- Keep warning/error channels separate (`metadata.warning` and `metadata.error`).

2. All-low-scores behavior:
- If `topic_relevance` is `not_relevant`, emit the minimal scope-recommendation payload from `references/schemas.md` with `metadata.scope_recommendation: true` and no dimension fan-out.

3. If the research task fails for a selected dimension 
- Remove the dimension from `metadata.research_plan.selected_dimensions`.  
- Update the score of that dimension in `metadata.research_plan.dimension_scores` as `1` with reason `Research task failed`. This is not an error. 
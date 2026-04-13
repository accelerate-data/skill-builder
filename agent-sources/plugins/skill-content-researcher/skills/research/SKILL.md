---
name: research
description: ALWAYS use this skill when producing clarification questions for any skill-building purpose (domain, source, data-engineering, platform). Invoke immediately in the research phase: score candidate dimensions, select top dimensions, run parallel dimension research, and return the complete clarifications.json payload. Do not attempt to produce clarifications without using this skill.
user_invocable: false
---

# Research Skill needs

Given a `purpose`, produce clarification questions which can be used for writing the skill.
The overall flow is as follows

- Understand the user's intent and the skill's purpose
- Resolve `purpose` to one dimension set from `references/dimension-sets.md`
- Score all candidate dimensions using `references/scoring-rubric.md`
- Emit scope recommendation output when rubric `topic_relevance` is `not_relevant`.
- Select top 3-5 dimensions when viable.
- Run parallel sub-agent research for selected dimensions
- Consolidate using `references/consolidation-handoff.md`
- Validate final payload against `../shared/schemas.md`
- Return the canonical `clarifications.json` object as top-level JSON

## Step 0: Read user context

Read `{workspace_dir}/user-context.md`.

- If `user-context.md` contains a `## Reference Documents` section with location of one or more named documents supplied by the user **always read first and incorporate these documents**. If a document is missing or its content appears truncated, note this to the user and proceed with the information available.

If missing, return:

```json
{
  "status": "research_complete",
  "dimensions_selected": 0,
  "question_count": 0,
  "research_output": {
    "version": "1",
    "metadata": {
      "question_count": 0,
      "section_count": 0,
      "refinement_count": 0,
      "must_answer_count": 0,
      "priority_questions": [],
      "scope_recommendation": false,
      "scope_reason": "missing user-context.md",
      "warning": null,
      "error": {
        "code": "missing_user_context",
        "message": "user-context.md not found in workspace directory"
      },
      "research_plan": {
        "purpose": "",
        "domain": "",
        "topic_relevance": "not_relevant",
        "dimensions_evaluated": 0,
        "dimensions_selected": 0,
        "dimension_scores": [],
        "selected_dimensions": []
      }
    },
    "sections": [],
    "notes": [],
    "answer_evaluator_notes": []
  }
}
```

## Step 1: Insufficient context guard

After reading `user-context.md`, check whether the description is clearly insufficient for research — e.g. fewer than 20 non-whitespace characters, contains only placeholder text like "just testing" or "test skill", or is not relevant or lacks substantive domain detail.

If any of these conditions exist, stop and return:

```json
{
  "status": "research_complete",
  "dimensions_selected": 0,
  "question_count": 0,
  "research_output": {
    "version": "1",
    "metadata": {
      "question_count": 0,
      "section_count": 0,
      "refinement_count": 0,
      "must_answer_count": 0,
      "priority_questions": [],
      "scope_recommendation": true,
      "scope_reason": "<one-sentence reason the context was insufficient>",
      "warning": {
        "code": "scope_guard_triggered",
        "message": "<concise explanation for UI>"
      },
      "error": null,
      "research_plan": {
        "purpose": "",
        "domain": "",
        "topic_relevance": "not_relevant",
        "dimensions_evaluated": 0,
        "dimensions_selected": 0,
        "dimension_scores": [],
        "selected_dimensions": []
      }
    },
    "sections": [],
    "notes": [],
    "answer_evaluator_notes": []
  }
}
```

## Step 2 - Capture Intent

The research should focus on producing high-quality, actionable clarifications that directly inform skill-building.

Start by understanding the user's intent. The user may need to fill the gaps, and should confirm before proceeding to the next step.

1. What should this skill enable Claude to do?
2. When should this skill trigger? (what user phrases/contexts)
3. What's the expected output format?
4. Who's the typical user?

Proactively ask questions about edge cases, input/output formats, example files, success criteria, and dependencies.

Check available MCPs - if useful for research (searching docs, finding similar skills, looking up best practices), research in parallel via subagents if available, otherwise inline. Come prepared with context to reduce burden on the user.

## Step 3 — Select Dimension Set

Extract `purpose` from the `**Purpose**` field in `user_context`. Read `references/dimension-sets.md` and resolve it to the matching dimension set using the table below.

| Purpose (label or token) | Dimension set |
| --- | --- |
| Business process knowledge (`domain`) | Domain Dimensions |
| Source system customizations (`source`) | Source Dimensions |
| Organization specific data engineering standards (`data-engineering`) | Data-Engineering Dimensions |
| Organization specific Azure or Fabric standards (`platform`) | Platform Dimensions |

## Step 4 — Score dimensions

Use `references/scoring-rubric.md` to score all candidate dimensions. Emit a markdown summary table of dimension scores (dimension, score, reason) as visible output, then construct the scoring JSON internally — do not emit the JSON as visible text output.
Use that scoring JSON to construct `metadata.research_plan` which is part of clarifications.json and schema defined in `../shared/schemas.md`.

- Set `topic_relevance` from scoring JSON (`relevant|not_relevant`).
- Set `dimensions_evaluated` from the count of entries in the candidate_dimension_scores array in scoring JSON
- Set `dimension_scores` from `candidate_dimension_scores` (`name`, `score`, `reason`, `focus`).
- If `topic_relevance` is `not_relevant`, return canonical minimal/scope-recommendation clarifications output per `../shared/schemas.md` with:
  - `metadata.scope_recommendation: true`
  - `metadata.scope_reason`: one-sentence explanation of why no dimensions scored high enough
  - `metadata.warning.code: "all_dimensions_low_score"`
  - `metadata.warning.message`: concise explanation for UI
  - `metadata.research_plan` present and schema-valid with minimal values per `../shared/schemas.md` Scope/Error Minimal Output (including `topic_relevance: "not_relevant"`, zero counts, and empty selected arrays)
  - zero selected dimensions.

## Step 5 - Select dimensions for research

Apply these only when `topic_relevance` is `relevant`.

- Select top 3-5 dimensions by score.
- Prefer coverage quality over exact count.
- Prefer dimensions scored 4-5.
- Include score = 3 dimensions only when needed for minimum viable coverage.

Update the `metadata.research_plan` created in Step 2.

- Set `selected_dimensions` as an array of `{ name, focus }` objects copied from the selected `dimension_scores` entries.
- Set accurate counts `dimensions_selected`.

## Step 6 — Parallel Dimension Research

For each selected dimension object in `metadata.research_plan.selected_dimensions` spawn one subagent in parallel the same turn, mode: bypassPermissions. **This is important:** don't spawn one and and then come back for the others. Launch everything at once so it all finishes around the same time.

Wait for all subagents to complete and return results before proceeding to step 5.

### Sub-agent prompt

Before spawning subagents, read `references/dimensions/entities.md`. Note the **absolute path** from the Read result (e.g. `/.../references/dimensions/entities.md`). Strip the filename to get `{dim_refs_dir}`. Subagents don't inherit the skill's `references/` resolution, so you must pass the absolute path.

Spawn each subagent with the following prompt verbatim, substituting `{name}`, `{focus}`, `{user_context}`, and `{dim_refs_dir}`:

---
**Dimension**: {name}
**Focus**: {focus}

{user_context}

Read `{dim_refs_dir}/{name}.md`.

Your output should be raw research text only (500-800 words).
Frame your research such that user responses will answer:

- What should this skill enable Claude to do?
- When should this skill trigger?
- What's the expected output?
- Who's the typical user?
- Should we set up test cases?

Proactively think about edge cases, input/output formats, example files, success criteria, and dependencies.

---

## Step 7 — Consolidate

- Use `references/consolidation-handoff.md` to produce `clarifications_json`.
- Construct the result object internally — **do not emit it as visible text output**. Pass it directly to `StructuredOutput` using the schema below.

  ```json
  {
    "dimensions_selected": "<metadata.research_plan.dimensions_selected>",
    "question_count": "<metadata.question_count from clarifications_json>",
    "research_output" : {
      "version": "1",
      "metadata": {
        "question_count": "<metadata.question_count from clarifications_json>",
        "section_count": "<metadata.section_count from clarifications_json>",
        "refinement_count": "<metadata.refinement_count from clarifications_json>",
        "must_answer_count": "<metadata.must_answer_count from clarifications_json>",
        "priority_questions": "<metadata.priority_questions from clarifications_json>",
        "scope_recommendation": "<metadata.scope_recommendation from clarifications_json>",
        "scope_reason": "<metadata.scope_reason from clarifications_json>",
        "warning": "<metadata.warning>",
        "error": null,
        "research_plan" : "<metadata.research_plan>"
      },
      "sections": "<sections from clarifications_json>",
      "notes" : "<notes from clarifications_json>",
      "answer_evaluator_notes": []
    }
  }
  ```

## Step 8 — Return final payload

**CRITICAL — your final message MUST be ONLY a raw JSON object.** No markdown, no explanation, no summary, no code fences, no wrapping text. If you write anything other than a valid JSON object, the backend will REJECT your output and the entire step will FAIL. The required output schema is provided in the system prompt of the orchestrator that invoked this skill.

**NEVER abbreviate or truncate the JSON output.** Every question object MUST include ALL required fields: `id`, `title`, `text`, `must_answer`, `choices`, `refinements`. Do NOT use `"..."` as a placeholder for any field or value. Do NOT omit fields to save tokens. The backend performs strict schema validation — any missing required field will cause the entire step to FAIL.

Return JSON only in this envelope shape:

```json
{
  "status": "research_complete",
  "dimensions_selected": 3,
  "question_count": 5,
  "research_output": {
    "version": "1",
    "metadata": { "question_count": 5, "section_count": 2, "refinement_count": 0, "must_answer_count": 2, "priority_questions": ["Q1","Q2"] },
    "sections": [
      {
        "id": 1,
        "title": "Section Title",
        "questions": [
          {
            "id": "Q1",
            "title": "Question Title",
            "text": "Full question text — this field is REQUIRED and must not be abbreviated",
            "must_answer": true,
            "choices": [
              {"id": "A", "text": "Choice text", "is_other": false},
              {"id": "B", "text": "Other (please specify)", "is_other": true}
            ],
            "refinements": []
          }
        ]
      }
    ],
    "notes": [],
    "answer_evaluator_notes": []
  }
}
```

### Output Contract

1. `research_output` must follow the canonical clarifications JSON object. Every question must have all required fields (`id`, `title`, `text`, `must_answer`, `choices`, `refinements`) — omitting any field causes a hard failure.
2. Before returning:
   - Validate against `../shared/schemas.md` exactly.
   - Ensure `metadata.research_plan` is present and schema-valid.
   - Ensure `metadata.research_plan.selected_dimensions` is present as `{ name, focus }` objects aligned to selected dimensions.
   - Preserve note separation (`notes` vs `answer_evaluator_notes`). Always emit `answer_evaluator_notes: []` — this field is populated by a downstream agent after user answers are evaluated, never during research.
   - Keep warning/error channels separate (`metadata.warning` and `metadata.error`).
3. All-low-scores behavior:
   - If `topic_relevance` is `not_relevant`, emit the minimal scope-recommendation payload from `../shared/schemas.md` with `metadata.scope_recommendation: true` and no dimension fan-out.
4. If the research task fails for a selected dimension:
   - Remove the dimension from `metadata.research_plan.selected_dimensions`.
   - Update the score of that dimension in `metadata.research_plan.dimension_scores` as `1` with reason `Research task failed`. This is not an error.
5. If all selected dimension research tasks fail:
   - Return the error envelope with `metadata.error.code: "all_dimensions_failed"` and `metadata.error.message: "all selected dimension research tasks failed"`.
   - Set `metadata.research_plan.selected_dimensions` to `[]` and `dimensions_selected` to `0`.

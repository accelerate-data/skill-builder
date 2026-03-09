# Research Output Schemas

Canonical schema contracts for the `research` skill output.

Use this file as the source of truth for clarifications schema validation before returning final JSON.

---

## Final Return Envelope

The research skill returns the canonical `clarifications.json` object directly as top-level JSON.

- No wrapper object (for example, do not nest under `clarifications_json`).
- No extra top-level keys outside the canonical `clarifications.json` schema.

---

## `clarifications.json` Canonical Schema (Step 0 output)

```json
{
  "version": "1",
  "metadata": {
    "title": "Clarifications: <domain>",
    "question_count": 0,
    "section_count": 0,
    "refinement_count": 0,
    "must_answer_count": 0,
    "priority_questions": [],
    "duplicates_removed": 0,
    "scope_recommendation": false,
    "scope_reason": "<optional reason>",
    "warning": {
      "code": "scope_guard_triggered|all_dimensions_low_score|<other_warning_code>",
      "message": "Human-readable warning summary."
    },
    "error": {
      "code": "missing_user_context|invalid_research_output|scope_guard_triggered|<other_machine_code>",
      "message": "Human-readable error summary."
    },
    "research_plan": {
      "purpose": "<purpose label>",
      "domain": "<domain name>",
      "topic_relevance": "relevant|not_relevant",
      "dimensions_evaluated": 0,
      "dimensions_selected": 0,
      "dimension_scores": [
        {
          "name": "<dimension slug>",
          "score": 1,
          "reason": "<one-sentence reason grounded in domain delta>",
          "focus": "<tailored focus line for this dimension>",
          "companion_skill": null
        }
      ],
      "selected_dimensions": [
        {
          "name": "<dimension slug>",
          "focus": "<tailored focus line passed to dimension sub-agent>"
        }
      ]
    }
  },
  "sections": [
    {
      "id": "S1",
      "title": "Section Name",
      "description": "Brief section summary.",
      "questions": [
        {
          "id": "Q1",
          "title": "Short title",
          "must_answer": true,
          "text": "Full question text...",
          "consolidated_from": ["Source A", "Source B"],
          "choices": [
            {"id": "A", "text": "Choice A", "is_other": false},
            {"id": "B", "text": "Choice B", "is_other": false},
            {"id": "C", "text": "Choice C", "is_other": false},
            {"id": "D", "text": "Other (please specify)", "is_other": true}
          ],
          "recommendation": "A - Rationale",
          "answer_choice": null,
          "answer_text": null,
          "refinements": []
        }
      ]
    }
  ],
  "notes": [
    {
      "type": "inconsistency|critical_gap|flag|scope_recommendation",
      "title": "Short note title",
      "body": "Detailed explanation."
    }
  ],
  "answer_evaluator_notes": [
    {
      "type": "vague|contradictory|not_answered|needs_refinement",
      "question_id": "Q1",
      "question_title": "Short question title",
      "body": "Evaluator rationale shown separately in UI."
    }
  ]
}
```

### Invariants

- `version` must be `"1"`.
- `metadata.question_count` equals total `sections[].questions[]` count.
- `metadata.section_count` equals `sections.length`.
- `metadata.must_answer_count` equals count of questions with `must_answer: true`.
- `metadata.priority_questions` lists all question IDs with `must_answer: true`.
- `metadata.research_plan` must be present and schema-valid.
- `metadata.research_plan.selected_dimensions` must be present as an array of `{ name, focus }` objects (empty array allowed only when no dimensions are selected).
- In research step output, `metadata.refinement_count` is `0`; refinements are added in step 1.
- `metadata.warning` is optional; when present it must include non-empty `code` and `message`.
- `metadata.warning.code` semantics are intentionally distinct:
  - `scope_guard_triggered`: orchestrator preflight scope/bad-intent guard triggered before scoring.
  - `all_dimensions_low_score`: scoring completed but all candidate dimensions were low signal (`<=2`).
- `metadata.error` is optional; when present it must include non-empty `code` and `message`.
- Keep channels separate: `notes` (research/planning) and `answer_evaluator_notes` (evaluation feedback).
- `metadata.research_plan.dimension_scores[]` element schema:
  - `name`: non-empty string
  - `score`: integer
  - `reason`: non-empty string
  - `focus`: non-empty string (tailored focus line carried through from scoring)
  - `companion_skill`: string or `null` (optional)
- `metadata.research_plan.selected_dimensions[]` element schema:
  - `name`: non-empty string (selected dimension slug)
  - `focus`: non-empty string (tailored focus line used for dimension fan-out)

---

## Scope/Error Minimal Output

For orchestrator preflight scope guard, all-dimensions-low-score, missing-user-context, or invalid-research-output returns, emit canonical minimal clarifications JSON with:

- `metadata.scope_recommendation: true` for scope-triggered returns; `false` for missing-user-context and invalid-research-output hard errors.
- `metadata.scope_reason` populated when `scope_recommendation: true`.
- `metadata.warning.code` set to:
  - `scope_guard_triggered` for orchestrator preflight guard.
  - `all_dimensions_low_score` for completed scoring with no viable dimensions.
- `metadata.error.code` set to:
  - `missing_user_context` for missing context hard error.
  - `invalid_research_output` for invalid research output hard error.
- zero counts and empty `sections`.
- `metadata.research_plan` present and schema-valid with minimal values:
  - `topic_relevance: "not_relevant"`
  - `dimensions_evaluated: 0`
  - `dimensions_selected: 0`
  - `dimension_scores: []`
  - `selected_dimensions: []`
  - `purpose`/`domain`: use known input values when available; otherwise use empty strings.

### Canonical Orchestrator Envelopes

  > `status` is a phase-complete signal, not an outcome signal. All paths return `"research_complete"` to indicate the
  research phase finished; the actual outcome (success, error, guard) is communicated via `research_output.metadata.*`.

When `research-orchestrator` returns a result envelope, use this exact top-level shape:

```json
{
  "status": "research_complete",
  "dimensions_selected": 0,
  "question_count": 0,
  "research_output": { "...": "canonical clarifications object" }
}
```


Path-specific envelope requirements:

- **Missing user-context hard error**
  - `dimensions_selected: 0`
  - `question_count: 0`
  - `research_output.metadata.error.code: "missing_user_context"`
  - `research_output.metadata.scope_recommendation: false`

- **Preflight scope guard (orchestrator Step 1)**
  - `dimensions_selected: 0`
  - `question_count: 0`
  - `research_output.metadata.warning.code: "scope_guard_triggered"`
  - `research_output.metadata.scope_recommendation: true`

- **All-dimensions-low-score guard (research skill scoring path)**
  - `dimensions_selected: 0`
  - `question_count: 0`
  - `research_output.metadata.warning.code: "all_dimensions_low_score"`
  - `research_output.metadata.scope_recommendation: true`

- **Invalid research output hard error**
  - `dimensions_selected: 0`
  - `question_count: 0`
  - `research_output.metadata.error.code: "invalid_research_output"`
  - `research_output.metadata.scope_recommendation: false`

- **Normal successful path**
  - `dimensions_selected` must equal `research_output.metadata.research_plan.dimensions_selected`
  - `question_count` must equal `research_output.metadata.question_count`

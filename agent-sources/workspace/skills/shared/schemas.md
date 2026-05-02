# Research Output Schemas -- Semantic Invariants

Structural contracts (field names, types, nesting) are enforced by SDK
`outputFormat` JSON Schema generated from Rust source types. This file
documents **semantic invariants only** -- rules that cannot be expressed
in JSON Schema alone.

---

## Version

- `version` must be the string `"1"`.

## Metadata Counts

- `metadata.question_count` must equal the total number of items across
  all `sections[].questions[]`.
- `metadata.section_count` must equal `sections.length`.
- `metadata.must_answer_count` must equal the count of questions where
  `must_answer` is `true`.
- `metadata.priority_questions` must list every question ID where
  `must_answer` is `true`.
- `metadata.refinement_count` must be `0` in initial research output;
  refinements are added later by detailed-research.

## Section IDs

- `sections[].id` must be sequential integers starting at `1`.

## Question IDs

- Top-level question IDs follow the pattern `Q{n}` (e.g. `Q1`, `Q12`).
- Refinement IDs follow the pattern `R{n}.{m}` where `n` is the parent
  question number and `m` is a sequential index starting at `1`.
  Parent is embedded in the ID: `R1.1` refines **Q1**.

## Choices

- Every question must have 2-4 concrete choices (`is_other: false`)
  plus one final catch-all choice with text exactly
  `"Other (please specify)"` and `is_other: true`.
- `is_other: true` is reserved exclusively for the catch-all
  "Other (please specify)" choice. Concrete choices -- even negations
  like "No X exists" -- must have `is_other: false`.

## Refinements

- Refinements do not nest: `refinements[].refinements` must always
  be `[]` (depth 1 max by convention).
- Transient merge-helper fields (`detailed_research_type`,
  `parent_question_id`) must be stripped before the payload is written
  to disk or returned.

## Notes Separation

- `notes` contains research/planning notes (types: `inconsistency`,
  `critical_gap`, `flag`, `scope_recommendation`).
- `answer_evaluator_notes` contains evaluation feedback (types: `vague`,
  `not_answered`, `needs_refinement`). Always emit as `[]` during
  research -- populated by a downstream agent after user answers are
  evaluated.

## Warning / Error Channels

- `metadata.warning` and `metadata.error` are separate channels.
- When present, each must include non-empty `code` and `message`.
- Warning codes: `scope_guard_triggered` for insufficient context, low topic
  usefulness, or no high-value organization-specific clarification topics.
- Error codes: `missing_user_context`, `invalid_research_output`.

## Research Flow Privacy

- The research skill may privately score topic usefulness, decide which
  research lenses are relevant, and rank candidate clarification topics.
- The returned payload must not include `research_plan`, `research_lens`,
  `dimension_scores`, `selected_dimensions`, `topic_relevance`,
  `dimensions_evaluated`, scoring summaries, or consolidation handoff fields.
- The returned payload should contain only final clarification output plus
  scope, warning, error, and note channels when applicable.

## Orchestrator Envelope

- `status` is always `"research_complete"` -- it signals phase
  completion, not outcome. Outcome is communicated via
  `research_output.metadata.*`.
- `question_count` must equal
  `research_output.metadata.question_count`.

## Scope / Error Minimal Output

- Zero counts and empty `sections` for all guard/error paths.
- `metadata.scope_recommendation: true` for scope-triggered returns;
  `false` for hard errors.
- Do not include `metadata.research_plan` in minimal outputs.

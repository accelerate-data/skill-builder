# Canonical Workflow Contracts

This document records the active app ↔ agent contracts for workflow artifacts
and terminal step outputs.

The authoritative type definitions live in Rust under
`app/src-tauri/src/contracts/`. If examples in this doc ever diverge from those
types, treat the Rust structs as source of truth and update this page in the
same change.

## Contract Sources Of Truth

| Contract | Rust source |
|---|---|
| Clarifications artifact | `app/src-tauri/src/contracts/clarifications.rs` |
| Decisions artifact | `app/src-tauri/src/contracts/decisions.rs` |
| Step output wrappers | `app/src-tauri/src/contracts/workflow_outputs.rs` |
| Artifact CRUD DTOs | `app/src-tauri/src/contracts/workflow_artifacts.rs` |
| Event envelope contracts | `app/src-tauri/src/contracts/agent_events.rs` |

## Enforcement

The current validation path is:

1. Rust attaches an output schema to OpenHands requests where applicable.
2. The prompt instructs the agent to return raw JSON.
3. The backend extracts terminal `conversation_state.result_text`.
4. Rust deserializes that payload into typed contract structs.
5. Validated results are persisted or materialized by the workflow command path.

Primary code:

- `app/src-tauri/src/commands/workflow/runtime.rs`
- `app/src-tauri/src/commands/workflow/output_format.rs`

### Required validation when contracts change

| Changed area | Required checks |
|---|---|
| `agent-sources/workspace/**` | `cd app && npm run test:agents:structural` |
| Parser-facing fixtures | `cd app && npm run test:unit` |
| Rust contract or extraction logic | `cd app && cargo test --manifest-path src-tauri/Cargo.toml commands::workflow` |
| Generated schemas/types | `cd app && npm run codegen && git diff --exit-code src/generated/ sidecar/generated/ src-tauri/src/generated/` |

## Active Workflow Outputs

### Step 0: Research

Rust type: `ResearchStepOutput`

```json
{
  "status": "research_complete",
  "question_count": 7,
  "research_output": {
    "version": "1",
    "metadata": {
      "title": "Clarifications: Example",
      "question_count": 7,
      "section_count": 2,
      "refinement_count": 0,
      "must_answer_count": 3,
      "priority_questions": ["Q1", "Q2"]
    },
    "sections": [],
    "notes": []
  }
}
```

Rules:

- `status` is `research_complete`
- `research_output` is a full `ClarificationsFile`

### Step 1: Detailed Research

Rust type: `DetailedResearchOutput`

```json
{
  "status": "detailed_research_complete",
  "refinement_count": 2,
  "section_count": 3,
  "clarifications_json": {
    "version": "1",
    "metadata": {
      "title": "Clarifications: Example",
      "question_count": 8,
      "section_count": 3,
      "refinement_count": 2,
      "must_answer_count": 3,
      "priority_questions": ["Q1", "Q2"]
    },
    "sections": [],
    "notes": []
  }
}
```

Rules:

- `status` is `detailed_research_complete`
- `clarifications_json` is a full `ClarificationsFile`

### Step 2: Confirm Decisions

Rust type: `DecisionsOutput`

```json
{
  "version": "1",
  "metadata": {
    "decision_count": 2,
    "conflicts_resolved": 1,
    "round": 1
  },
  "decisions": [
    {
      "id": "D1",
      "title": "Framework Choice",
      "original_question": "Which framework?",
      "decision": "Use React",
      "implication": "Need React expertise",
      "status": "resolved"
    }
  ]
}
```

Rules:

- `status` is not wrapped at the top level for this step
- decision status values are:
  - `resolved`
  - `conflict-resolved`
  - `needs-review`
  - `revised`

### Step 3: Generate Skill

Rust type: `GenerateSkillOutput`

```json
{
  "status": "generated",
  "skipped": false,
  "commit_summary": "Updated SKILL.md and references",
  "call_trace": ["wrote SKILL.md", "wrote references/source-system.md"]
}
```

Optional fields:

- `benchmark_path`
- `skipped`
- `commit_summary`
- `call_trace`

The durable skill output still lives on disk in the skills path:

- `SKILL.md`
- `references/**`

## Active Artifact Schemas

### Clarifications Artifact

Rust type: `ClarificationsFile`

High-level shape:

```json
{
  "version": "1",
  "metadata": {
    "title": "Clarifications: Example",
    "question_count": 7,
    "section_count": 2,
    "refinement_count": 0,
    "must_answer_count": 3,
    "priority_questions": ["Q1", "Q2"]
  },
  "sections": [
    {
      "id": 1,
      "title": "Business Rules",
      "description": "Optional",
      "questions": [
        {
          "id": "Q1",
          "title": "Question title",
          "text": "Full question text",
          "must_answer": true,
          "choices": [],
          "refinements": []
        }
      ]
    }
  ],
  "notes": []
}
```

Important current details from code:

- `Section.id` is an integer
- `Question.refinements` is recursive `Vec<Question>`
- `metadata.warning` and `metadata.error` are optional structured objects
- `answer_evaluator_notes` is optional

### Decisions Artifact

Rust types: `DecisionsMetadata`, `Decision`

High-level shape:

```json
{
  "version": "1",
  "metadata": {
    "decision_count": 2,
    "conflicts_resolved": 1,
    "round": 1,
    "contradictory_inputs": true,
    "scope_recommendation": false
  },
  "decisions": [
    {
      "id": "D1",
      "title": "Decision title",
      "original_question": "Source question",
      "decision": "Chosen answer",
      "implication": "Engineering consequence",
      "status": "resolved"
    }
  ]
}
```

Important current details from code:

- `contradictory_inputs` is an untagged union:
  - `true` / `false`
  - `"revised"`
- decision statuses are kebab-case strings

### Answer Evaluation Output

Rust type: `AnswerEvaluationOutput`

High-level shape:

```json
{
  "verdict": "mixed",
  "answered_count": 5,
  "empty_count": 3,
  "vague_count": 1,
  "contradictory_count": 0,
  "total_count": 9,
  "reasoning": "5 of 9 questions have substantive answers.",
  "gate_decision": "run_research",
  "per_question": [
    { "question_id": "Q1", "verdict": "needs_refinement", "reason": "Missing threshold." },
    { "question_id": "Q2", "verdict": "clear" }
  ]
}
```

Current gate decisions allowed by code:

- `run_research`
- `revise`

Current per-question verdict values:

- `clear`
- `needs_refinement`
- `not_answered`
- `vague`
- `contradictory`

## Event Contracts

The old sidecar event model is no longer the active runtime contract.

Current event contracts are defined in:

- `app/src-tauri/src/contracts/agent_events.rs`
- OpenHands-facing message normalization in the frontend under
  `app/src/lib/openhands-conversation-events.ts`

For the active runtime event model, see
[../openhands-runtime-model/README.md](../openhands-runtime-model/README.md).

## Deprecated Contracts Removed From This Doc

These are no longer documented as active contracts here:

- `user-context.md` as a canonical persisted workflow artifact
- `test-skill.md`
- `agent-validation-log.md`
- Claude-sidecar JSONL transcript config/event envelopes

Those either belong to historical fixtures or to other docs, not to the active
workflow artifact contract.

---
functional-specs: []
---

# Workflow Artifact Storage

> **Status:** Draft
> **Linear:** VU-1157
> **Functional specs:** Not applicable. This design covers app runtime storage boundaries for workflow artifacts and frontend data flow.

## Overview

Today the Skill Builder workflow stores its core artifacts — clarifications, decisions, answer-evaluator feedback — as canonical JSON files in the workspace. SQLite owns surrounding state (workflow runs/steps/sessions, usage, plugins, skills), but the **content** of each step is on disk.

VU-1157 moves those artifacts into SQLite as canonical normalized state. The workspace becomes runtime scratch only; the frontend reads via typed query hooks instead of JSON file IO.

This is a clean-break refactor. No dual-write, no file fallback, no startup reconciliation, no legacy backfill. Skill Builder is in dev — we are not protecting any workspaces in flight.

Generation-owned eval files and description-tuning files are not part of the
clean-break storage model. Step 3 should not materialize `evals/evals.json`,
`pending-eval.json`, or description-candidate artifacts in the workspace.

## Scope

**In scope**

- Canonical SQLite schema for clarifications and decisions, fully normalized (no JSON blobs).
- Removal of `context/clarifications.json`, `context/decisions.json`, `answer-evaluation.json`, `user-context.md`, and root-level `.agents/` from the workspace.
- Rust unpacks agent JSON output into rows at the boundary; renders prompts inline from DB context.
- Frontend reads via TanStack Query hooks against new typed Tauri commands; deletes JSON file IO and the `Note`-shape round-trip.
- Reconciliation/startup recon code paths that probe these files are deleted.

**Not in scope**

- Eval and benchmark functionality (`benchmark-meta.json`, Eval Workbench schema). Being redone in a separate effort. The current `benchmark-meta.json` writer is removed without DB replacement.
- The shipped skill output under `skills_path` (`SKILL.md`, `references/`). That stays as durable filesystem state, untouched.
- Refine and Test surfaces beyond what touches the four artifacts above.
- Question merging, splitting, deduplication, and priority tracking. These features are not part of the supported workflow; agent output that includes them is ignored at the unpack boundary.

## Current State

### What lives where today

| Artifact | Location | Owner | Read by |
|---|---|---|---|
| Clarifications root | `{workspace}/{plugin}/{skill}/context/clarifications.json` | Agent (steps 0/1) writes; frontend gate hook patches `answer_evaluator_notes` post-eval | Frontend editor, Rust guards/evaluation, prompt builder |
| Decisions | `{workspace}/{plugin}/{skill}/context/decisions.json` | Agent (step 2) | Frontend, Rust guards (`needs-review` gate), prompt builder |
| Answer evaluation | `{workspace}/{plugin}/{skill}/answer-evaluation.json` | Frontend gate hook materializes from agent output | UI for transient gate display only |
| Benchmark metadata | `{workspace}/{plugin}/{skill}/context/benchmark-meta.json` | Rust after step 3 | UI |
| User context | `{workspace}/{plugin}/{skill}/user-context.md` | Rust materializes from DB-backed skill metadata | Agents read via `read_file` tool call |

### Key code

| File | Role |
|---|---|
| `app/src-tauri/src/commands/workflow/output_format.rs` | Writes clarifications/decisions/benchmark-meta from agent structured output |
| `app/src-tauri/src/commands/workflow/evaluation.rs` | Reads clarifications/decisions content; validates JSON shape; step-completion checks |
| `app/src-tauri/src/commands/workflow/guards.rs` | Reads `decisions.json` for needs-review and `clarifications.json` for `metadata.scope_recommendation` |
| `app/src-tauri/src/commands/workflow/runtime.rs` | References file paths in reset/error messages |
| `app/src-tauri/src/commands/workflow/user_context.rs` | Writes `user-context.md` to workspace |
| `app/src-tauri/src/commands/workflow/prompt.rs` | Injects workspace dir + skill output dir into prompts; agent prompts instruct file discovery |
| `app/src-tauri/src/commands/workflow/step_config.rs` | Declares `output_file` per step |
| `app/src/hooks/use-workflow-gate.ts` | Calls `buildGateFeedbackNotes`, patches clarifications JSON |
| `app/src/lib/gate-feedback.ts` | Builds `Note` objects from per-question evaluator verdicts |
| `app/src/lib/clarifications-review.ts` | Parses note titles back to `(questionId, status)` for the editor |
| `app/src/components/clarifications-editor/index.tsx` | Renders per-question review feedback from notes |
| `agent-sources/plugins/skill-content-researcher/agents/research-agent.md` | Instructs agent to read/write `clarifications.json` from a `context_dir` path |

## Target Boundary

### SQLite owns canonical workflow artifacts

Per-artifact normalized tables. JSON is the wire format only; rows are typed.

### Workspace is runtime scratch

```text
{workspace}/{plugin}/{skill}/
  .agents/              ← skill-scoped agent prompts (deploy step)
  logs/                 ← OpenHands JSONL run logs
  tmp/                  ← optional throwaway materialized files
```

Removed: `context/`, `user-context.md`, `answer-evaluation.json`, root-level `.agents/`.

### Skills path unchanged

`{skills_path}/{plugin}/{skill}/SKILL.md` and `references/` remain durable shipped output.

### Frontend reads DB

Frontend stops reading or writing workflow JSON files. TanStack Query hooks under `app/src/lib/queries/` wrap typed Tauri commands. Mutations invalidate query keys; agent event streams update or invalidate the cache via `agent-stream-cache.ts`.

## Schema

Six new tables (zero JSON columns; zero schema changes to `skills`).

### `clarifications`

One row per skill workflow.

| Column | Type | Notes |
|---|---|---|
| `skill_id` | TEXT PK FK → `skills(id)` | |
| `version` | TEXT | `version` from agent output |
| `refinement_count` | INTEGER | step 1 increments |
| `must_answer_count`, `question_count`, `section_count` | INTEGER | denormalized counts from agent metadata |
| `title` | TEXT | |
| `scope_recommendation` | INTEGER NULL | tri-state boolean (NULL/0/1) |
| `scope_reason`, `scope_next_action` | TEXT NULL | |
| `error_code`, `error_message` | TEXT NULL | flattened from `metadata.error` |
| `warning_code`, `warning_message` | TEXT NULL | flattened from `metadata.warning` |
| `eval_verdict` | TEXT NULL | `'sufficient' \| 'insufficient'` |
| `eval_reasoning` | TEXT NULL | |
| `eval_at` | INTEGER NULL | unix-ms timestamp |
| `eval_answered_count`, `eval_empty_count`, `eval_vague_count`, `eval_contradictory_count` | INTEGER NULL | aggregate counters from answer evaluator |
| `created_at`, `updated_at` | INTEGER | unix-ms |

### `clarification_sections`

| Column | Type | Notes |
|---|---|---|
| `skill_id` | TEXT FK → `clarifications(skill_id)` ON DELETE CASCADE | |
| `section_id` | INTEGER | from agent output |
| `ordinal` | INTEGER | display order |
| `title` | TEXT | |
| `description` | TEXT NULL | |
| PK | `(skill_id, section_id)` | |

### `clarification_questions`

Self-referential for refinements (a refinement is a question with `parent_question_id` set).

| Column | Type | Notes |
|---|---|---|
| `skill_id` | TEXT | FK → `clarifications` ON DELETE CASCADE |
| `question_id` | TEXT | from agent output |
| `section_id` | INTEGER | FK → `clarification_sections(section_id)` |
| `parent_question_id` | TEXT NULL | self-FK for refinements |
| `ordinal` | INTEGER | |
| `title`, `text` | TEXT | |
| `must_answer` | INTEGER | 0/1 |
| `answer_choice` | TEXT NULL | references a `clarification_choices(choice_id)` |
| `answer_text` | TEXT NULL | |
| `recommendation` | TEXT NULL | |
| `answer_verdict` | TEXT NULL | `'clear' \| 'vague' \| 'not_answered' \| 'needs_refinement' \| 'contradictory'` |
| `answer_verdict_reason` | TEXT NULL | LLM rationale, replaces the per-question note round-trip |
| PK | `(skill_id, question_id)` | |

### `clarification_choices`

| Column | Type | Notes |
|---|---|---|
| `skill_id` | TEXT | FK → `clarifications` ON DELETE CASCADE |
| `question_id` | TEXT | composite FK with `skill_id` to `clarification_questions` |
| `choice_id` | TEXT | from agent output |
| `ordinal` | INTEGER | |
| `text` | TEXT | |
| `is_other` | INTEGER | 0/1 |
| PK | `(skill_id, question_id, choice_id)` | |

### `clarification_notes`

Clarification-level LLM annotations only (general research notes). Per-question evaluator feedback lives on `clarification_questions.answer_verdict[_reason]` instead.

| Column | Type | Notes |
|---|---|---|
| `skill_id` | TEXT | FK → `clarifications` ON DELETE CASCADE |
| `note_id` | INTEGER | autoincrement |
| `ordinal` | INTEGER | |
| `type` | TEXT | from agent output |
| `title`, `body` | TEXT | |
| PK | `note_id` | |

### `decisions`

| Column | Type | Notes |
|---|---|---|
| `skill_id` | TEXT PK FK → `skills(id)` | |
| `version` | TEXT | |
| `round` | INTEGER | |
| `decision_count` | INTEGER | |
| `conflicts_resolved` | INTEGER | |
| `contradictory_inputs_state` | TEXT NULL | `'inactive' \| 'active' \| 'revised'` |
| `scope_recommendation` | INTEGER NULL | tri-state |
| `created_at`, `updated_at` | INTEGER | |

### `decision_items`

| Column | Type | Notes |
|---|---|---|
| `skill_id` | TEXT | FK → `decisions` ON DELETE CASCADE |
| `decision_id` | TEXT | from agent output |
| `ordinal` | INTEGER | |
| `title`, `original_question`, `decision`, `implication` | TEXT | |
| `status` | TEXT | enum: `'resolved' \| 'conflict-resolved' \| 'needs-review' \| 'revised'` |
| PK | `(skill_id, decision_id)` | |

## Runtime Boundaries

### Agent → Rust

Agents return structured JSON output (existing wire format under `agent-sources/plugins/skill-content-researcher/shared/output-schemas/`). Rust unpacks into rows in a single transaction at the workflow step-completion boundary. Agents do not write workflow JSON to disk.

The schema above ignores three agent-emitted fields: `metadata.priority_questions`, `metadata.duplicates_removed`, and `question.consolidated_from`. Question merging/splitting/deduplication is not a supported workflow.

### Rust → Frontend

Typed Tauri commands return DTOs derived from `app/src-tauri/src/contracts/`. Frontend imports types from `app/src/generated/contracts.ts`, calls via `invokeCommand()` per the codegen rule, and consumes through TanStack Query hooks under `app/src/lib/queries/`.

### Prompt rendering

`prompt.rs` reads DB rows for the active skill and renders the relevant clarifications/decisions content **inline** in the prompt. No file paths beyond `workspace_dir` and `skill_output_dir` are mentioned. The agent does not need filesystem discovery for app state.

`user-context.md` is dropped — its content is inlined into the system/user prompt for the same reason. Saves a `read_file` tool call per agent run.

### Reconciliation

The startup reconciliation paths that detect step progress from workspace JSON files are deleted, not refactored. DB rows are the only source of truth. Workspace cleanup becomes idempotent: anything outside `.agents/`, `logs/`, `tmp/` is fair game to remove.

## Frontend Data Flow

### Removed

- `app/src/lib/gate-feedback.ts` — `buildGateFeedbackNotes`
- `app/src/lib/clarifications-review.ts` — `getReviewFeedbackMap`, `parseAnswerFeedback`
- File IO calls: `getClarificationsContent`, `saveClarificationsContent`, equivalents for decisions/answer-evaluation
- `parseClarifications` JSON-shape validation in the editor

### Added

- `app/src/lib/queries/clarifications.ts` — `useClarifications(skillId)`, `useUpdateClarificationAnswer`, `useUpdateClarificationVerdicts`
- `app/src/lib/queries/decisions.ts` — `useDecisions(skillId)`, mutations as needed
- Query keys under `app/src/lib/queries/query-keys.ts`
- Agent stream cache integration in `app/src/lib/queries/agent-stream-cache.ts` so step-complete events invalidate the right keys

### Editor

`clarifications-editor/index.tsx` reads `useClarifications(skillId)` and renders per-question feedback directly from `(answer_verdict, answer_verdict_reason)` columns. No more title-string parsing.

The post-eval write path in `use-workflow-gate.ts` becomes a single mutation that updates per-question verdict + reason rows in one call.

## Removed Workspace Surfaces

- `context/clarifications.json`
- `context/decisions.json`
- `context/benchmark-meta.json` (and the writer in `output_format.rs`; eval/benchmark redo will replace)
- `answer-evaluation.json`
- `user-context.md`
- Root-level `.agents/` deployment (skill-scoped only)

## Open Questions

None blocking. Remaining detail decisions live in the migration plan task notes.

## Relationship To Existing Design Specs

| Spec | Relationship |
|---|---|
| `docs/design/agent-specs/storage.md` | Predecessor; refresh after this lands |
| `docs/design/openhands-runtime-model/README.md` | Runtime/session model for workflow and refine surfaces that consume these artifacts |

## Migration Sequencing

This work originally landed as part of the OpenHands clean-break rollout. The
implementation now lives on `main`; no separate plan document is maintained
here.

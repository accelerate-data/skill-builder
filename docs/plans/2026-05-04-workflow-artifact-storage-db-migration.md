# Workflow Artifact Storage DB Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Linear issue:** VU-1157
**Design spec:** `docs/design/workflow-artifact-storage/README.md`
**Base branch for PR:** `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime` (OpenHands accumulation branch). Implementation worktree forks off VU-1145; PR targets VU-1145.

**Goal:** Move clarifications and decisions from canonical workspace JSON files to canonical SQLite rows. Frontend reads from DB via TanStack Query. Workspace becomes runtime scratch only. Clean break — no dual-write, no file fallback, no startup reconciliation, no legacy backfill.

**Out of scope:** Eval and benchmark functionality. The `benchmark-meta.json` writer is deleted without replacement; the redo lands separately.

**Tech stack:** Tauri/Rust, rusqlite, TypeScript/React, TanStack Query, OpenHands Agent Server, Vitest, cargo test.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/src-tauri/src/db/migrations.rs` | Add 6 new artifact tables in one migration |
| `app/src-tauri/src/db/workflow_artifacts.rs` | New module: typed CRUD for clarifications + decisions |
| `app/src-tauri/src/db/mod.rs` | Export new module |
| `app/src-tauri/src/contracts/workflow_artifacts.rs` | TS-Rust DTOs (codegen source) |
| `app/src-tauri/src/contracts/mod.rs` | Register new contracts |
| `app/src-tauri/src/commands/workflow/output_format.rs` | Replace file writes with DB unpack; delete benchmark-meta writer |
| `app/src-tauri/src/commands/workflow/evaluation.rs` | Replace file reads with DB reads |
| `app/src-tauri/src/commands/workflow/guards.rs` | Replace `decisions.json` / `clarifications.json` reads with DB |
| `app/src-tauri/src/commands/workflow/prompt.rs` | Render inline DB context; drop file-discovery prompt language |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Drop file-path references in errors/reset |
| `app/src-tauri/src/commands/workflow/step_config.rs` | Drop `output_file` declarations for step 0/1/2 |
| `app/src-tauri/src/commands/workflow/user_context.rs` | Delete; content inlined into prompt |
| `app/src-tauri/src/commands/workflow/clarifications.rs` | New typed Tauri commands for frontend reads/mutations |
| `app/src-tauri/src/commands/workflow/decisions.rs` | New typed Tauri commands |
| `app/src-tauri/src/commands/workflow/answer_evaluation.rs` | New typed Tauri command for evaluator-result write (per-question verdict + reason) |
| `app/src-tauri/src/reconciliation/skill_builder.rs` | Drop file-probe paths for these artifacts |
| `app/src-tauri/src/fs_validation.rs` | Drop step detection for `context/*.json` |
| `app/src-tauri/src/commands/workspace.rs` | Remove `context/` setup; remove root `.agents/` deploy if present |
| `app/src-tauri/src/commands/workflow/deploy.rs` | Skill-scoped `.agents/` only |
| `agent-sources/plugins/skill-content-researcher/agents/research-agent.md` | Drop "read clarifications.json from context_dir" instructions |
| `agent-sources/plugins/skill-content-researcher/agents/*.md` | Drop file-path instructions; agents return structured output only |
| `app/src/lib/tauri-command-types.ts` | Add new command shapes |
| `app/src/lib/queries/clarifications.ts` | New: TanStack Query hooks |
| `app/src/lib/queries/decisions.ts` | New: TanStack Query hooks |
| `app/src/lib/queries/query-keys.ts` | Add `clarifications`, `decisions` key families |
| `app/src/lib/queries/agent-stream-cache.ts` | Invalidate new keys on step-complete events |
| `app/src/components/clarifications-editor/index.tsx` | Read DB via hooks; render verdicts from row columns |
| `app/src/hooks/use-workflow-gate.ts` | Replace JSON patch with verdict mutation |
| `app/src/lib/gate-feedback.ts` | Delete |
| `app/src/lib/clarifications-review.ts` | Delete |
| `app/src/lib/clarifications-types.ts` | Drop `Note` round-trip type |
| `app/src/__tests__/components/clarifications-editor.test.tsx` | Update fixtures to DB shape |
| `app/src/__tests__/lib/canonical-format.test.ts` | Drop or repurpose — JSON canonical format no longer applies |
| `docs/design/workflow-state/README.md` | Update step output column to reference DB rows |
| `docs/design/agent-specs/storage.md` | Refresh storage boundary section |
| `repo-map.json` | New module entries: `db::workflow_artifacts`, `commands::workflow::clarifications`, `decisions`, `answer_evaluation` |
| `TEST_MAP.md` | Update mappings for new modules |

---

## Task 1: Schema And DB Module

**Files:**

- Modify: `app/src-tauri/src/db/migrations.rs`
- Create: `app/src-tauri/src/db/workflow_artifacts.rs`
- Modify: `app/src-tauri/src/db/mod.rs`

- [ ] Add a single migration creating `clarifications`, `clarification_sections`, `clarification_questions`, `clarification_choices`, `clarification_notes`, `decisions`, `decision_items`. ON DELETE CASCADE from each child to its parent (skill_id-keyed).
- [ ] Add indexes: `clarification_questions(skill_id, parent_question_id)`, `clarification_questions(skill_id, section_id)`, `clarification_choices(skill_id, question_id)`, `decision_items(skill_id)`.
- [ ] Add typed Rust structs in `workflow_artifacts.rs`:
  - `ClarificationsRecord`, `ClarificationSection`, `ClarificationQuestion`, `ClarificationChoice`, `ClarificationNote`
  - `DecisionsRecord`, `DecisionItem`
- [ ] Add CRUD with bound parameters:
  - `upsert_clarifications(tx, skill_id, full_record_with_children)` — atomic replace within a transaction
  - `read_clarifications(skill_id) -> Option<FullRecord>`
  - `update_question_verdicts(skill_id, Vec<(question_id, verdict, reason)>)` — partial update for the gate hook
  - `update_question_answer(skill_id, question_id, answer_choice, answer_text)` — partial update for the editor
  - `upsert_decisions(tx, skill_id, full_record_with_items)`
  - `read_decisions(skill_id) -> Option<FullRecord>`
  - `delete_clarifications(skill_id)` and `delete_decisions(skill_id)` (called from skill deletion path)
- [ ] DB tests: insert+read roundtrip; cascade delete; partial verdict update preserves answers; recursive refinement insert (parent + child question rows).
- [ ] Run: `cargo test --manifest-path app/src-tauri/Cargo.toml db::workflow_artifacts`
- [ ] Commit: `VU-1157: add workflow artifact tables and crud`

## Task 2: Tauri Contracts And Commands

**Files:**

- Create: `app/src-tauri/src/contracts/workflow_artifacts.rs`
- Modify: `app/src-tauri/src/contracts/mod.rs`
- Create: `app/src-tauri/src/commands/workflow/clarifications.rs`
- Create: `app/src-tauri/src/commands/workflow/decisions.rs`
- Create: `app/src-tauri/src/commands/workflow/answer_evaluation.rs`
- Modify: `app/src/lib/tauri-command-types.ts`
- Modify: `app/src/lib/tauri-command-types.typecheck.ts`

- [ ] Define DTO contracts mirroring DB rows. Optional fields use `Option<T>`. Enums are stringly-typed in the DTO and validated at the boundary.
- [ ] Add commands:
  - `get_clarifications(skill_id) -> Option<ClarificationsDto>`
  - `update_clarification_answer(skill_id, question_id, answer_choice, answer_text)`
  - `update_clarification_verdicts(skill_id, Vec<{question_id, verdict, reason}>)`
  - `get_decisions(skill_id) -> Option<DecisionsDto>`
- [ ] All commands log `info!` on entry with `skill_id` (no payload bodies).
- [ ] Register commands in `lib.rs` `tauri::generate_handler!`.
- [ ] Run: `cd app && npm run codegen` and commit regenerated `app/src/generated/contracts.ts`, `app/sidecar/generated/contracts.ts`, `app/src-tauri/src/generated/schemas.rs`.
- [ ] Run: `cd app && npx tsc --noEmit && cd src-tauri && cargo test contracts::`
- [ ] Run: `cd app && npm run test:guard`
- [ ] Commit: `VU-1157: typed tauri commands for workflow artifacts`

## Task 3: Replace File Writes With DB Unpack

**Files:**

- Modify: `app/src-tauri/src/commands/workflow/output_format.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/commands/workflow/step_config.rs`
- Delete: `app/src-tauri/src/commands/workflow/user_context.rs`
- Modify: `app/src-tauri/src/commands/workflow/mod.rs` (remove `user_context` module)

- [ ] In `output_format.rs`:
  - Step 0/1: parse agent JSON → `ClarificationsRecord` + children → `upsert_clarifications` in a single transaction. Drop the `clarifications.json` write.
  - Ignore agent-emitted fields `metadata.priority_questions`, `metadata.duplicates_removed`, `question.consolidated_from` at the unpack boundary.
  - Step 2: parse → `DecisionsRecord` + items → `upsert_decisions`. Drop the `decisions.json` write.
  - Step 3: delete the `benchmark-meta.json` writer entirely (no DB replacement).
  - Drop `answer-evaluation.json` writer if present.
- [ ] In `runtime.rs`: replace file-path mentions in reset/error messages with semantic step names ("clarifications", "decisions"). Drop reset logic that touches `context/`.
- [ ] In `step_config.rs`: drop `output_file` for steps 0/1/2; keep only the SKILL.md output for step 3.
- [ ] Delete `user_context.rs` and its `mod.rs` registration. The DB skill metadata that was being written is read directly in prompt rendering (Task 5).
- [ ] Run: `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow`
- [ ] Commit: `VU-1157: persist workflow artifacts to db at step completion`

## Task 4: Replace File Reads With DB Reads

**Files:**

- Modify: `app/src-tauri/src/commands/workflow/evaluation.rs`
- Modify: `app/src-tauri/src/commands/workflow/guards.rs`
- Modify: `app/src-tauri/src/fs_validation.rs`
- Modify: `app/src-tauri/src/reconciliation/skill_builder.rs`
- Modify: `app/src-tauri/src/reconciliation/tests.rs`

- [ ] `evaluation.rs`: drop `validate_clarifications_json`, drop file-path constants, drop step-completion checks against `context/*.json`. Step completion is determined by row presence (`get_clarifications(skill_id).is_some()` etc.) and `clarifications.refinement_count` for step 1.
- [ ] `guards.rs`: rewrite `check_scope_recommendation` to read `clarifications.scope_recommendation` column. Rewrite the needs-review guard to read `decision_items` `WHERE status = 'needs-review'`.
- [ ] `fs_validation.rs`: drop probes for `context/clarifications.json`, `context/decisions.json`, `answer-evaluation.json`, `user-context.md`. Workspace validation now only ensures `.agents/`, `logs/`, `tmp/` are managed.
- [ ] `reconciliation/`: delete the rehydration paths that backfill DB rows from file content. Reconciliation reads DB directly; if no rows exist, the skill is considered at step 0.
- [ ] Update reconciliation tests to use DB fixtures.
- [ ] Run: `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow fs_validation reconciliation`
- [ ] Commit: `VU-1157: read workflow artifacts from db only`

## Task 5: Render Prompts From DB Inline

**Files:**

- Modify: `app/src-tauri/src/commands/workflow/prompt.rs`
- Modify: `agent-sources/plugins/skill-content-researcher/agents/research-agent.md`
- Modify: `agent-sources/plugins/skill-content-researcher/agents/*.md` (any other agent referencing `context_dir` or `clarifications.json`)
- Modify: `agent-sources/plugins/skill-content-researcher/skills/research/SKILL.md` if it instructs reading workspace files
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`

- [ ] `prompt.rs`: read `get_clarifications(skill_id)` / `get_decisions(skill_id)` and inline the relevant content into the rendered prompt. For step 1, inline current clarifications + per-question verdicts so the agent can refine. For step 2, inline clarifications. For step 3, inline both.
- [ ] Inline DB-backed user context (skill metadata, document references) directly into the prompt — the content that `user_context.rs` used to write to `user-context.md`.
- [ ] Drop all file-discovery instructions from agent prompts: no more "read `{context_dir}/clarifications.json`", no `context_dir` placeholder.
- [ ] Keep `workspace_dir` and `skill_output_dir` placeholders — agents still need them for `.agents/` access and step-3 SKILL.md output.
- [ ] Update prompt tests:
  - Assert DB content is embedded
  - Assert no `clarifications.json`, `decisions.json`, `context_dir`, `user-context.md` strings remain
- [ ] Run: `cd app && npm run test:agents:structural` and `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow::tests`
- [ ] Commit: `VU-1157: inline db context into workflow prompts`

## Task 6: Workspace Cleanup

**Files:**

- Modify: `app/src-tauri/src/commands/workspace.rs`
- Modify: `app/src-tauri/src/commands/workflow/deploy.rs`
- Modify: `app/src-tauri/src/cleanup.rs` (if present)

- [ ] `workspace.rs`: remove `context/` directory creation; remove any `user-context.md` materialization remnants; remove root-level `.agents/` deploy. Workspace init creates only `.agents/` (skill-scoped), `logs/`, and an optional `tmp/`.
- [ ] `deploy.rs`: deploy `.agents/` only into `{workspace}/{plugin}/{skill}/.agents/`, never at the workspace root.
- [ ] `cleanup.rs`: anything outside the runtime set (`.agents/`, `logs/`, `tmp/`) is fair game to remove. Update tests for the new contract.
- [ ] Run: `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workspace cleanup commands::workflow::deploy`
- [ ] Commit: `VU-1157: workspace becomes runtime scratch only`

## Task 7: Frontend Query Layer And Editor

**Files:**

- Create: `app/src/lib/queries/clarifications.ts`
- Create: `app/src/lib/queries/decisions.ts`
- Modify: `app/src/lib/queries/query-keys.ts`
- Modify: `app/src/lib/queries/agent-stream-cache.ts`
- Modify: `app/src/components/clarifications-editor/index.tsx`
- Modify: `app/src/hooks/use-workflow-gate.ts`
- Delete: `app/src/lib/gate-feedback.ts`
- Delete: `app/src/lib/clarifications-review.ts`
- Modify: `app/src/lib/clarifications-types.ts`
- Modify: `app/src/__tests__/components/clarifications-editor.test.tsx`
- Delete or modify: `app/src/__tests__/lib/canonical-format.test.ts`

- [ ] Add query hooks:
  - `useClarifications(skillId)` → wraps `get_clarifications`
  - `useUpdateClarificationAnswer()` → wraps `update_clarification_answer`, invalidates `['clarifications', skillId]`
  - `useUpdateClarificationVerdicts()` → wraps `update_clarification_verdicts`, invalidates same key
  - `useDecisions(skillId)` → wraps `get_decisions`
- [ ] Add query keys: `['clarifications', skillId]`, `['decisions', skillId]`.
- [ ] In `agent-stream-cache.ts`, on step-complete events for steps 0/1/2, invalidate the matching key.
- [ ] `clarifications-editor/index.tsx`:
  - Replace `data` prop and `parseClarifications` consumption with `useClarifications(skillId)`
  - Render per-question feedback by reading `question.answer_verdict` + `question.answer_verdict_reason` directly
  - Save edits via `useUpdateClarificationAnswer`
  - Drop `getReviewFeedbackMap` and the `Note[]` traversal
- [ ] `use-workflow-gate.ts`:
  - Replace the `getClarificationsContent` / `parseClarifications` / `saveClarificationsContent` block with `updateClarificationVerdicts({skillId, verdicts: evaluation.per_question.map(...)})`
  - Drop `buildGateFeedbackNotes` import
- [ ] Delete `gate-feedback.ts`, `clarifications-review.ts`. Drop `Note` type from `clarifications-types.ts` if it has no remaining consumers.
- [ ] Update editor test fixtures to DB shape (typed records, not JSON).
- [ ] Drop or repurpose `canonical-format.test.ts` — JSON canonical format is no longer the contract.
- [ ] Run: `cd app && npm run test:unit && npx tsc --noEmit`
- [ ] Commit: `VU-1157: frontend reads workflow artifacts from db`

## Task 8: Docs And Inventory

**Files:**

- Modify: `docs/design/workflow-state/README.md`
- Modify: `docs/design/agent-specs/storage.md`
- Modify: `repo-map.json`
- Modify: `TEST_MAP.md`
- Modify: `AGENTS.md` (if storage notes drift)

- [ ] Update `workflow-state` step table: step 0/1/2 outputs are DB rows, not files. Step 3 still writes `SKILL.md` and `references/` to `skills_path`.
- [ ] Refresh `agent-specs/storage.md` storage boundary section to match this design.
- [ ] Update `repo-map.json`:
  - Add `app/src-tauri/src/db/workflow_artifacts.rs` to db modules
  - Add `app/src-tauri/src/commands/workflow/clarifications.rs`, `decisions.rs`, `answer_evaluation.rs`
  - Remove `user_context.rs` from `commands/workflow/`
  - Add `app/src/lib/queries/clarifications.ts`, `decisions.ts`
- [ ] Update `TEST_MAP.md`:
  - `app/src-tauri/src/db/workflow_artifacts.rs` → `cargo test db::workflow_artifacts`
  - `app/src/lib/queries/{clarifications,decisions}.ts` → `npm run test:unit`
  - Drop `canonical-format.test.ts` references if removed
- [ ] Run:
  - `cd app && npm run test:repo-map`
  - `bash app/scripts/lint-agent-docs.sh` (if AGENTS.md or .claude/rules touched)
  - `markdownlint docs/design/workflow-artifact-storage/README.md docs/plans/2026-05-04-workflow-artifact-storage-db-migration.md`
- [ ] Commit: `VU-1157: docs and inventory for workflow artifact storage`

## Task 9: Verify And Open PR

- [ ] Run full validation:
  - `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`
  - `cd app && npx tsc --noEmit`
  - `cd app && npm run test:unit`
  - `cd app && npm run test:agents:structural`
  - `cd app && npm run test:repo-map`
  - `cargo test --manifest-path app/src-tauri/Cargo.toml`
- [ ] Manual smoke (UI in browser): start a workflow, run steps 0–3, confirm clarifications + decisions appear via DB query in editor; confirm no `context/` or `user-context.md` files appear in the workspace skill dir.
- [ ] Open PR titled `VU-1157: workflow artifact storage in sqlite`. PR body includes `Fixes VU-1157`. **Base branch: `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`** (not `main`).

---

## Decisions Captured (For Context)

- **Per-artifact normalized tables, no JSON columns.** Six new tables.
- **Refinements as self-FK on `clarification_questions`**, not a separate table.
- **Per-question evaluator feedback as columns** (`answer_verdict`, `answer_verdict_reason`), not a notes round-trip.
- **General `notes[]` kept** as `clarification_notes` (clarification-level LLM annotations only).
- **No question merging/splitting/dedup**: ignore `priority_questions`, `consolidated_from`, `duplicates_removed` at the unpack boundary.
- **No benchmark/eval scope.** Benchmark redo lands separately.
- **Clean break: no dual-write, no fallback, no startup recon, no legacy backfill.**
- **`user-context.md` deleted**, content inlined into the prompt.
- **PR targets VU-1145**, the OpenHands accumulation branch.

# Workflow Artifact Storage DB Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move workflow artifacts from workspace-owned canonical files to SQLite-owned canonical state while keeping the workspace as a runtime-only OpenHands area and preserving the existing shipped skill output path.

**Architecture:** Add first-class DB ownership for clarifications, decisions, answer evaluation, and benchmark metadata; dual-write during transition; then switch prompt building and workflow reads to DB-first. Keep `.agents`, logs, and `user-context.md` as filesystem runtime artifacts, and keep `skills_path` as the durable shipped skill library.

**Tech Stack:** Tauri/Rust, SQLite via rusqlite, React/TypeScript command consumers, OpenHands Agent Server, JSONL runtime logs, Vitest, cargo test.

**Design Spec:** `docs/design/workflow-artifact-storage/README.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `app/src-tauri/src/db/migrations.rs` | Add canonical workflow artifact tables |
| `app/src-tauri/src/db/workflow_artifact_state.rs` | CRUD for clarifications, decisions, answer evaluations, benchmark metadata |
| `app/src-tauri/src/db/mod.rs` | Export new DB helpers |
| `app/src-tauri/src/commands/workflow/evaluation.rs` | Switch clarifications/decisions read-write helpers to DB-first |
| `app/src-tauri/src/commands/workflow/output_format.rs` | Dual-write and later DB-only materialization for workflow step outputs |
| `app/src-tauri/src/commands/workflow/prompt.rs` | Render prompts from DB-backed context instead of filesystem discovery |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Materialize transient files only when a step still needs them |
| `app/src-tauri/src/commands/workspace.rs` | Remove legacy context migration assumptions once DB is canonical |
| `app/src-tauri/src/fs_validation.rs` | Revisit step detection logic that currently keys off workspace files |
| `app/src-tauri/src/reconciliation/` | Reconcile DB-first, file-fallback for legacy workspaces |
| `app/src-tauri/src/commands/files.rs` | Keep file listing behavior aligned with reduced workspace surface |
| `docs/design/agent-specs/storage.md` | Update or supersede stale storage documentation |
| `repo-map.json` | Update module descriptions after schema and runtime boundary changes |

---

## Task 1: Introduce Canonical Workflow Artifact Tables

**Files:**
- Modify: `app/src-tauri/src/db/migrations.rs`
- Create: `app/src-tauri/src/db/workflow_artifact_state.rs`
- Modify: `app/src-tauri/src/db/mod.rs`

- [ ] Add a migration for canonical workflow artifacts.
- [ ] Choose one table shape and keep it consistent:
  `workflow_state_artifacts(skill_id, artifact_type, json_content, version, created_at, updated_at)`
  or separate per-artifact tables.
- [ ] Add typed Rust structs and bound-parameter CRUD helpers for:
  `clarifications`, `decisions`, `answer_evaluation`, `benchmark_meta`.
- [ ] Add DB tests covering insert, update, read-latest, and delete-on-skill-removal.
- [ ] Run:
  `cargo test --manifest-path app/src-tauri/Cargo.toml db`
- [ ] Commit:
  `git commit -m "VU-1156: add workflow artifact state tables"`

## Task 2: Dual-Write Step Outputs Into DB And Workspace

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/output_format.rs`
- Modify: `app/src-tauri/src/commands/workflow/evaluation.rs`

- [ ] Update step 0 and step 1 output materialization so `clarifications.json` is still written for compatibility but the parsed payload is also saved to DB.
- [ ] Update step 2 output materialization so `decisions.json` is dual-written to DB and workspace.
- [ ] Update answer evaluator output so the parsed payload is saved to DB and still materialized to the current workspace file path during transition.
- [ ] Update benchmark metadata handling so pending/skipped state is saved to DB and still written to `context/benchmark-meta.json` during transition.
- [ ] Add tests that assert DB rows are written even when compatibility files are still created.
- [ ] Run:
  `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow`
- [ ] Commit:
  `git commit -m "VU-1156: dual-write workflow artifacts to db"`

## Task 3: Make Workflow Reads DB-First

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/evaluation.rs`
- Modify: `app/src-tauri/src/commands/workflow/settings.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`

- [ ] Change read paths for clarifications and decisions to prefer DB-backed artifacts.
- [ ] Keep filesystem fallback for legacy workspaces or partial migrations.
- [ ] Update disabled-step guards and validation helpers to read DB first.
- [ ] Add tests for:
  DB present + file absent;
  DB absent + file present;
  DB and file both present with DB preferred.
- [ ] Run:
  `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow fs_validation reconciliation`
- [ ] Commit:
  `git commit -m "VU-1156: switch workflow artifact reads to db first"`

## Task 4: Render Prompts From DB-Backed Context

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/prompt.rs`
- Modify: `agent-sources/prompts/research.txt`
- Modify: `agent-sources/prompts/detailed-research.txt`
- Modify: `agent-sources/prompts/confirm_decisions.txt`
- Modify: `agent-sources/prompts/skill-generation.txt`
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`

- [ ] Remove prompt assumptions that the agent must discover canonical state from `context/*.json`.
- [ ] Inject the relevant clarifications/decisions content from DB-backed reads into the rendered prompt.
- [ ] Keep `workspace_dir` and `skill_output_dir` explicit in the prompt contract.
- [ ] Preserve `user-context.md` references until that artifact is intentionally redesigned.
- [ ] Update prompt tests to prove DB-backed context is embedded and file-discovery language is gone.
- [ ] Run:
  `cd app && npm run test:agents:structural`
  `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow::tests`
- [ ] Commit:
  `git commit -m "VU-1156: render workflow prompts from db context"`

## Task 5: Reduce Workspace To Runtime Materialization

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/commands/files.rs`
- Modify: `app/src-tauri/src/commands/workspace.rs`
- Modify: `app/src-tauri/src/cleanup.rs`

- [ ] Keep `.agents`, `logs`, and `user-context.md` as first-class runtime files.
- [ ] Move any remaining artifact file writes behind explicit compatibility or temporary materialization helpers.
- [ ] Introduce a dedicated transient directory if needed for one-shot materialized files instead of treating workspace `context/` as canonical state.
- [ ] Remove legacy startup context migration once DB ownership is established and backfill has landed.
- [ ] Update cleanup behavior so runtime files are disposable and canonical state is not inferred from them.
- [ ] Run:
  `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workspace cleanup files`
- [ ] Commit:
  `git commit -m "VU-1156: reduce workspace to runtime artifacts"`

## Task 6: Rework Reconciliation And Step Detection

**Files:**
- Modify: `app/src-tauri/src/fs_validation.rs`
- Modify: `app/src-tauri/src/reconciliation/skill_builder.rs`
- Modify: `app/src-tauri/src/reconciliation/tests.rs`

- [ ] Stop using workspace artifact files as the primary detector for workflow progress.
- [ ] Use DB-backed workflow artifact state first.
- [ ] Keep a legacy filesystem probe path only for migration fallback and stale pre-migration workspaces.
- [ ] Ensure startup reconciliation can rehydrate DB rows from legacy files exactly once when needed.
- [ ] Add tests for:
  DB-only current state;
  file-only legacy state;
  conflicting DB/file state with DB winning after backfill.
- [ ] Run:
  `cargo test --manifest-path app/src-tauri/Cargo.toml reconciliation fs_validation`
- [ ] Commit:
  `git commit -m "VU-1156: make reconciliation db first"`

## Task 7: Update Docs And Inventory

**Files:**
- Modify: `docs/design/agent-specs/storage.md`
- Modify: `docs/design/README.md`
- Modify: `repo-map.json`
- Modify: `TEST_MAP.md`

- [ ] Update the storage doc so it matches the actual runtime layout and canonical DB ownership.
- [ ] Add this design doc to the design index.
- [ ] Update repo-map module descriptions for the new workflow artifact DB module and reduced workspace contract.
- [ ] Update test guidance if changed-path expectations move with the refactor.
- [ ] Run:
  `cd app && npm run test:repo-map`
  `markdownlint docs/design/agent-specs/storage.md docs/design/workflow-artifact-storage/README.md docs/plans/2026-05-03-workflow-artifact-storage-db-migration.md`
- [ ] Commit:
  `git commit -m "VU-1156: document workflow artifact storage boundary"`

## Task 8: Remove Compatibility File Dependencies

**Files:**
- Modify: any remaining workflow readers/materializers that still require legacy files

- [ ] Delete compatibility-only file reads once all prompts and guards are DB-backed.
- [ ] Keep optional explicit export/debug actions if filesystem dumps are still useful.
- [ ] Verify no app-owned workflow path still depends on canonical `clarifications.json`, `decisions.json`, `answer-evaluation.json`, or `benchmark-meta.json` files.
- [ ] Run:
  `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`
  `cd app && npm run test:unit`
  `cd app && npm run test:agents:structural`
  `cd app && npm run test:repo-map`
- [ ] Commit:
  `git commit -m "VU-1156: remove legacy workflow artifact file dependencies"`

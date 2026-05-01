# VU-1050 Generated Skill Version Tag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generated-skill materialization publishes, commits, and creates the initial skill version tag without relying on agent-run git commands.

**Architecture:** Keep agent ownership unchanged: `skill-creator:generate-skill` returns structured output only. Move backend publish/commit/tag behavior into a small testable helper in `app/src-tauri/src/commands/workflow/output_format.rs`, then call it from the Tauri command path after successful step-3 materialization.

**Tech Stack:** Rust, Tauri command backend, `git2`, existing skill path helpers, deterministic `cargo test`.

---

## Source Context

- Functional spec: `not_applicable` for this backend bug.
- Related design docs: `docs/design/agent-specs/README.md`, `docs/design/backend-design/skill-metadata-ownership.md`, `docs/design/data-contracts/README.md`.
- Related implementation plan: this file.
- Manual checks: No manual tests required.
- Evals: No live Promptfoo/OpenCode evals required; the behavior is backend git materialization and can be covered by deterministic Rust tests.

## Files

- Modify: `app/src-tauri/src/commands/workflow/output_format.rs`
- Test: `app/src-tauri/src/commands/workflow/tests.rs`

## Task 1: Add Regression Coverage

- [ ] **Step 1: Write failing helper-level test for commit and tag**

Add a test in `app/src-tauri/src/commands/workflow/tests.rs` that builds a generated workspace skill, calls a backend helper, and asserts `skills/tagged-skill/v1.0.0` exists via `crate::git::skill_version_tag_exists()`.

- [ ] **Step 2: Run RED test**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml publish_commit_and_tag_generated_skill_creates_initial_version_tag
```

Expected: FAIL because `publish_commit_and_tag_generated_skill` does not exist.

## Task 2: Implement Publish, Commit, Tag Helper

- [ ] **Step 1: Add helper**

Add `publish_commit_and_tag_generated_skill()` in `app/src-tauri/src/commands/workflow/output_format.rs`. It should publish generated output, commit the skills repo, create `v1.0.0` with the existing plugin/skill tag convention, and return `Err` on commit or tag failure.

- [ ] **Step 2: Replace inline command logic**

Inside `materialize_workflow_step_output()`, replace the inline publish/commit/log block with the helper call.

- [ ] **Step 3: Run GREEN test**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml publish_commit_and_tag_generated_skill_creates_initial_version_tag
```

Expected: PASS.

## Task 3: Add Failure Coverage

- [ ] **Step 1: Add duplicate-tag failure test**

Add a test that pre-creates `skills/tagged-skill/v1.0.0`, runs the helper, and asserts the returned error contains `version tag failed`.

- [ ] **Step 2: Run targeted helper tests**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml publish_commit_and_tag_generated_skill
```

Expected: PASS.

## Task 4: Validate Changed Area

- [ ] **Step 1: Run workflow Rust tests**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
```

Expected: PASS.

- [ ] **Step 2: Run clippy for Rust backend**

Run:

```bash
cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings
```

Expected: PASS.

- [ ] **Step 3: Evaluate E2E/manual need**

No E2E, manual, or live eval tests are required because the changed behavior is covered at the backend git boundary with temp repos. Do not run `test:agents:smoke`.

## Task 5: Handoff

- [ ] **Step 1: Update Linear**

Post implementation status with source paths, automated verification, and no manual-test requirement.

- [ ] **Step 2: Commit**

Run:

```bash
git status --short
git add app/src-tauri/src/commands/workflow/output_format.rs app/src-tauri/src/commands/workflow/tests.rs docs/superpowers/plans/2026-05-01-vu-1050-generated-skill-version-tag.md
git commit -m "VU-1050: tag generated skills after commit"
```

Expected: clean worktree after commit.

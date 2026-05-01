# VU-1137 Performance Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce workflow DB contention and agent-output render cost without changing workflow behavior.

**Architecture:** Keep the existing Tauri/SQLite/React boundaries. Move filesystem and git work outside the global SQLite mutex by splitting command-level settings/metadata reads from inner filesystem/DB phases. Keep agent-output rendering semantically identical for normal runs, but window large lists in the display layer and use stable markdown plugin arrays. Add a small index migration for current query predicates only.

**Tech Stack:** Rust/Tauri commands, SQLite migrations, React 19, Zustand, Vitest, Playwright mocked E2E, Cargo tests.

---

## Manual Test Scope

No manual tests are required.

All scenarios can be covered by automation:

- Rust unit tests for skill create/delete behavior and index migration.
- Vitest component tests for workflow active-run selection, markdown plugin constants, and large agent-output windowing.
- Mocked Playwright `@workflow` and `@evals` smoke coverage for the UI surfaces that embed agent output.

Live agent smoke evals are not required because this refactor does not change agent prompts, sidecar output formats, or Promptfoo eval packages.

## Discovery Notes

- Linear issue: `VU-1137`.
- Linear team/project: `Utilities` / `Skill Builder`.
- Functional spec: `not_applicable`. The issue is an internal performance refactor; this repo has no `docs/functional/` tree.
- Related design docs:
  - `docs/design/backend-design/database.md`
  - `docs/design/workflow-state/README.md`
  - `docs/design/backend-design/agent-event-contracts.md`
- Existing related implementation plan: `not_applicable`.

## Files

- Modify: `app/src-tauri/src/commands/skill/crud.rs`
- Modify: `app/src-tauri/src/commands/skill/tests.rs`
- Modify: `app/src-tauri/src/db/migrations.rs`
- Modify: `app/src-tauri/src/db/tests.rs`
- Modify: `app/src/pages/workflow.tsx`
- Modify: `app/src/__tests__/lib/runtime-api-contract.test.ts`
- Modify: `app/src/components/agent-output-panel.tsx`
- Modify: `app/src/components/agent-items/display-item-list.tsx`
- Modify: `app/src/__tests__/components/agent-output-panel.test.tsx`
- Modify: `app/src/__tests__/components/agent-items/display-item-memoization.test.tsx`
- Modify: `app/src/components/agent-items/memoized-markdown.tsx`
- Modify: `app/src/components/step-complete/file-content-renderer.tsx`
- Modify: `app/src/components/workspace/benchmark-overview-card.tsx`
- Modify: `app/src/__tests__/guards/markdown-link-guard.test.ts`
- Modify: `TEST_MANIFEST.md` only if E2E mappings change.

## Tasks

### Task 1: Backend RED Tests For DB Lock Boundary

- [x] Add tests in `app/src-tauri/src/commands/skill/tests.rs` that exercise `create_skill_inner` and `delete_skill_inner` through the intended split:
  - filesystem directories are created/deleted before or after the DB phase as appropriate;
  - DB rows are still created/deleted correctly;
  - existing rollback behavior is preserved when the DB phase fails.
- [x] Add a command-level helper test if the helper can be made testable without Tauri state. The helper tests cover DB-only and filesystem-only phases without requiring Tauri state.
- [x] Run:

  ```bash
  cd app/src-tauri && cargo test commands::skill
  ```

- [x] Expected RED: at least one test fails because the helper split did not exist yet.

### Task 2: Refactor Skill Create/Delete Lock Scope

- [x] Split `create_skill` into:
  - short DB lock for settings, author, and avatar reads;
  - filesystem preflight and directory creation without the DB lock;
  - short DB transaction for `workflow_runs`, tags, author, intake, and behavior;
  - manifest regeneration and git commit without the DB lock.
- [x] Split `delete_skill` into:
  - short DB lock for settings and plugin slug lookup;
  - filesystem deletion and manifest/git work without the DB lock;
  - short DB lock for workflow/imported-skill cleanup.
- [x] Preserve existing logs, path traversal checks, and reconciliation assumptions.
- [x] Run:

  ```bash
  cd app/src-tauri && cargo test commands::skill
  ```

- [x] Backend slice completed in the final combined implementation commit.

### Task 3: Add Current-Query Index Migration

- [x] Add migration 42 in `app/src-tauri/src/db/migrations.rs`.
- [x] Create indexes only for current query predicates:
  - `workflow_steps(workflow_run_id, step_id)`
  - `workflow_artifacts(workflow_run_id)`
  - `agent_runs(workflow_session_id, reset_marker, started_at)`
  - `agent_runs(skill_name, started_at)`
  - `workflow_sessions(reset_marker, started_at, skill_name)`
- [x] Use `CREATE INDEX IF NOT EXISTS` so the migration is idempotent.
- [x] Add DB tests that apply all numbered migrations and assert each index exists in `sqlite_master`.
- [x] Run:

  ```bash
  cd app/src-tauri && cargo test db::tests::test_migration_count_matches_expected
  cd app/src-tauri && cargo test db::tests
  ```

- [x] DB slice completed in the final combined implementation commit.

### Task 4: Frontend RED Tests For Active Run Selection And Markdown Constants

- [x] Add a static workflow contract test that prevents broad `runs` map subscription and requires active-run display count selection.
- [x] Add a guard test that production `ReactMarkdown` usages do not pass inline `remarkPlugins={[...]}` or `rehypePlugins={[...]}` arrays.
- [x] Run:

  ```bash
  cd app && npx vitest run src/__tests__/pages/workflow.test.tsx src/__tests__/guards/markdown-link-guard.test.ts
  ```

- [x] Expected RED: tests failed against broad `runs` subscription and inline plugin arrays.

### Task 5: Narrow Workflow Subscription And Stabilize Markdown Plugins

- [x] In `app/src/pages/workflow.tsx`, select `activeRunDisplayItemCount` or `activeRun` directly from `useAgentStore` instead of selecting the full `runs` map.
- [x] In markdown renderers, define stable plugin arrays at module scope:
  - `app/src/components/agent-items/memoized-markdown.tsx`
  - `app/src/components/step-complete/file-content-renderer.tsx`
  - `app/src/components/workspace/benchmark-overview-card.tsx`
- [x] Keep `app/src/components/refine/preview-panel.tsx` unchanged unless a shared helper makes the code clearer; it already uses constants.
- [x] Run:

  ```bash
  cd app && npx vitest run src/__tests__/pages/workflow.test.tsx src/__tests__/guards/markdown-link-guard.test.ts
  ```

- [x] Frontend slice completed in the final combined implementation commit.

### Task 6: Agent Output Windowing RED Tests

- [x] Add tests for `DisplayItemList` / `AgentOutputPanel`:
  - lists with 100 or fewer grouped display items render all groups;
  - lists with more than 100 grouped display items render a bounded tail window plus a compact omitted-count indicator;
  - terminal/result/error items remain visible when they are in the tail;
  - nested subagent display lists keep full rendering unless they cross the same threshold.
- [x] Run:

  ```bash
  cd app && npx vitest run src/__tests__/components/agent-output-panel.test.tsx src/__tests__/components/agent-items/display-item-memoization.test.tsx
  ```

- [x] Expected RED: large lists rendered every group and had no omitted-count indicator.

### Task 7: Implement Agent Output Windowing

- [x] Add constants in `display-item-list.tsx`, for example `DISPLAY_ITEM_WINDOW_THRESHOLD = 100` and `DISPLAY_ITEM_WINDOW_SIZE = 100`.
- [x] Window after grouping, not before grouping, so tool activity groups remain intact.
- [x] Render only the tail group window when `groups.length > DISPLAY_ITEM_WINDOW_THRESHOLD`.
- [x] Add a compact, accessible indicator such as `data-testid="display-item-window-indicator"` with the omitted group count.
- [x] Keep scroll-to-bottom behavior in `AgentOutputPanel` based on the original `displayItems.length`.
- [x] Run:

  ```bash
  cd app && npx vitest run src/__tests__/components/agent-output-panel.test.tsx src/__tests__/components/agent-items/display-item-memoization.test.tsx
  ```

- [x] Rendering slice completed in the final combined implementation commit.

### Task 8: Automated Workflow And Evals Surface Verification

- [x] Run changed frontend unit/integration coverage:

  ```bash
  cd app && npm run test:unit
  cd app && npm run test:guard
  cd app && npm run test:integration
  ```

- [x] Run Rust validation:

  ```bash
  cd app/src-tauri && cargo test commands::skill
  cd app/src-tauri && cargo test db::tests
  ```

- [x] Run mocked E2E surfaces:

  ```bash
  cd app && npm run test:e2e:workflow
  cd app && playwright test --project smoke --grep @evals
  ```

- [x] Run type/lint validation required by repo guidance:

  ```bash
  cd app && npx tsc --noEmit
  cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings
  ```

- [x] Record that live agent smoke evals are not applicable for this issue.

### Task 9: Quality Gates, Linear Update, And Final Commit

- [ ] Run the required independent gates:
  - code review;
  - simplification review;
  - test coverage review;
  - acceptance-criteria review.
- [ ] Apply only verified feedback after using `superpowers:receiving-code-review`.
- [x] Update VU-1137 with:
  - functional spec: `not_applicable`;
  - related design docs;
  - this implementation plan path;
  - completed automation and eval coverage;
  - no manual tests required;
  - any remaining risk.
- [x] Check off completed acceptance criteria in Linear.
- [ ] Create the final local commit.
- [ ] Leave the worktree clean and stop before PR creation.

## Self-Review

- The plan covers all VU-1137 acceptance criteria without implementing obsolete original-audit items.
- It avoids sidecar heartbeat/runtime changes unless new evidence appears.
- It covers the Evals surface with mocked UI automation and explicitly excludes live/model evals because no agent artifacts change.
- It keeps the refactor behavior-preserving and avoids new external dependencies.

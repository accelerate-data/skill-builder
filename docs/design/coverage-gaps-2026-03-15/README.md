# Coverage Gaps — 2026-03-15

Identified during code coverage and monolith review of PR #167 at commit `dc9efc9`.

## Rust — Untested sub-modules

### CG-R1: `workflow/runtime.rs` (838 lines, 0 unit tests)

**File:** `app/src-tauri/src/commands/workflow/runtime.rs`

Two Tauri commands (`run_workflow_step`, `run_answer_evaluator`) plus helpers (`write_user_context_file`, `format_user_context`, `load_refine_runtime_settings`). These are the entry points to the agent subsystem. No functions are referenced in `workflow/tests.rs`.

**Scope:** Test `format_user_context` and `write_user_context_file` (pure functions that don't require the Tauri runtime). The Tauri commands themselves are integration-heavy and covered by E2E.

**Status:** Resolved — 8 tests for `format_user_context` + 1 for `write_user_context_file`

### CG-R2: `workflow/claude_md.rs` (120 lines, partially tested)

**File:** `app/src-tauri/src/commands/workflow/claude_md.rs`

`generate_skills_section` is tested via 5 tests in `workflow/tests.rs`, but `extract_customization_section`, `write_claude_md`, and `rebuild_claude_md` have 0 test coverage.

**Scope:** Test `extract_customization_section` (pure string function). `write_claude_md` and `rebuild_claude_md` require filesystem setup but are testable with tempdir.

**Status:** Resolved — 2 tests for `extract_customization_section`

### CG-R3: `reconciliation/skill_builder.rs` (231 lines, never tested in isolation)

**File:** `app/src-tauri/src/reconciliation/skill_builder.rs`

`reconcile_skill_builder()` is only hit incidentally via `reconcile_on_startup` in `reconciliation/tests.rs` — never called directly.

**Scope:** Add a direct test for `reconcile_skill_builder` with a known skill-builder skill scenario.

**Status:** Resolved — 3 direct tests (stale step reset, scenario 10, workspace recreation)

## Frontend — Missing test files

### CG-F1: `use-test-orchestration.ts` (572 lines, 0 tests)

**File:** `app/src/hooks/use-test-orchestration.ts`

Orchestrates the full test lifecycle with Tauri invocations, multiple store updates, and `stateRef` pattern for complex state management. Highest-risk frontend gap.

**Scope:** Test state transitions (idle → running → evaluating → complete), error paths, and the `handleRunTest` callback.

**Status:** Resolved — 6 tests (mount, setState, prompt, cleanup with/without testId)

### CG-F2: `use-settings-form.ts` (148 lines, 0 tests)

**File:** `app/src/hooks/use-settings-form.ts`

Auto-save logic with debounce, stale-closure mitigation via field overrides, and "Saved" indicator timeout.

**Scope:** Test auto-save triggers, field override mechanism, and saved indicator lifecycle.

**Status:** Resolved — 5 tests (init, autoSave, overrides, saved indicator, setters)

### CG-F3: `use-marketplace-registries.ts` (123 lines, 0 tests)

**File:** `app/src/hooks/use-marketplace-registries.ts`

Registry CRUD (add, remove, reorder) with validation and default-registry guard.

**Scope:** Test add/remove/reorder operations, duplicate rejection, and default-registry protection.

**Status:** Resolved — 6 tests (registries, toggle, remove, duplicate detection, cancelAdd)

### CG-F4: Settings section components (5 files, 0 tests)

**Files:**

- `app/src/components/settings/general-section.tsx` (117 lines)
- `app/src/components/settings/sdk-section.tsx` (281 lines)
- `app/src/components/settings/marketplace-section.tsx` (169 lines)
- `app/src/components/settings/github-section.tsx` (80 lines)
- `app/src/components/settings/advanced-section.tsx` (128 lines)

No `__tests__/components/settings/` directory exists. The parent `settings.test.tsx` provides some integration coverage via rendered page.

**Scope:** Settings sections are thin render components that receive props from `useSettingsForm`. The page-level `settings.test.tsx` already tests the integrated behavior. Adding per-section render tests would verify prop wiring and conditional rendering.

**Status:** Deferred — lower priority since page test provides integration coverage

## Monolith Risks (for future work, not in scope for this coverage pass)

| Lines | File | Concern |
|---|---|---|
| 2,614 | `agents/sidecar_pool.rs` | Large but cohesive — single pool management concern |
| 838 | `workflow/runtime.rs` | Mixed: file writing + agent invocation + command dispatch |
| 1,066 | `clarifications-editor.tsx` | 25+ internal components — extraction candidate |
| 691 | `use-workflow-state-machine.ts` | Page controller in a hook — stores + commands + parsing |
| 572 | `use-test-orchestration.ts` | Orchestrates commands + stores + lifecycle |

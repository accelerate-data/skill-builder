# OpenHands Runtime Clean-Break Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining OpenHands clean-break follow-up work by removing stale trigger-mode residue, normalizing remaining throwaway naming drift, and tightening persistent-session orchestration around one canonical persistent-turn runtime path.

**Architecture:** Keep the product-layer commands (`start_refine_session`, workflow step commands, eval workbench commands) intact, but simplify the runtime beneath them. The runtime should expose clear persistent-session and throwaway-session semantics, while the eval workbench and sidecar contracts stop carrying dead trigger-mode and one-shot terminology. Refine should keep explicit up-front prepare/resume semantics, but the actual persistent turn execution path should be unified beneath refine and workflow.

**Tech Stack:** Rust (Tauri commands, runtime helpers, SQLite), TypeScript/React (typed Tauri wrappers and eval workbench UI contracts), Vitest, cargo test, Playwright E2E tags, markdownlint.

---

## File Structure

### Runtime and orchestration

- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
  - Extract or consolidate the canonical persistent-turn execution helper used by refine/workflow send paths.
  - Keep `prepare_openhands_session*`, `openhands_send_message`, `pause_openhands_session`, and `run_throwaway_openhands_session` as the durable runtime surface.
- Modify: `app/src-tauri/src/commands/refine/mod.rs`
  - Keep up-front session preparation in `start_refine_session`.
  - Move send-time orchestration onto the shared persistent-turn path.
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
  - Route workflow persistent turns through the same canonical runtime send path used by refine.
- Modify: `app/src-tauri/src/commands/skill/scope_review.rs`
  - Confirm throwaway naming is used consistently in scope review config and call sites.

### Throwaway naming cleanup

- Modify: `app/src-tauri/src/agents/sidecar.rs`
  - Rename remaining one-shot config helpers/types to throwaway/runtime terminology where they are still exposed internally.
  - Decide whether the serialized `mode: "one-shot"` field remains as transport compatibility or is renamed if downstream accepts it.
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
  - Stop importing or calling `run_openhands_one_shot` / `OpenHandsOneShotRunParams`.
  - Move scenario-suggestion / eval-generation paths to throwaway naming.
- Modify: `app/src-tauri/src/types/mod.rs`
  - Keep any shared config defaults aligned with the renamed runtime terminology if needed.

### Trigger-mode residue removal

- Modify: `app/src-tauri/src/db/eval_workbench.rs`
  - Remove `Trigger` mode and `should_trigger` from the live scenario storage model if no migration compatibility reason requires them to remain.
- Modify: `app/src-tauri/src/db/migrations.rs`
  - Add the required migration or compatibility handling for removing dead trigger fields from the app-owned schema.
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
  - Remove trigger-mode branches, defaults, labels, DTO handling, and unreachable backend paths.
- Modify: `app/src-tauri/src/commands/eval_workbench/scenarios.rs`
  - Keep file-backed scenario tags aligned to performance-only behavior.
- Modify: `app/src/lib/eval-workbench.ts`
  - Keep the frontend type surface performance-only and remove any remaining compatibility scaffolding if present.
- Modify: `app/src/components/workspace/workspace-eval-workbench.tsx`
  - Ensure the UI continues to reflect only performance scenario authoring after backend cleanup.
- Modify: `app/src/generated/contracts.ts`
  - Regenerate if the Tauri contract changes.

### Tests and docs

- Modify: `app/src-tauri/src/commands/refine/tests.rs`
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`
- Modify: `app/src-tauri/src/db/eval_workbench.rs` test module
- Modify: `app/src/__tests__/lib/eval-workbench-tauri.test.ts`
- Modify: `app/src/__tests__/lib/runtime-api-contract.test.ts`
- Modify: `app/src/__tests__/components/workspace/workspace-evals.test.tsx`
- Modify: `app/src/__tests__/components/workspace/workspace-shell.test.tsx`
- Modify: `docs/design/openhands-runtime-model/README.md`
- Modify: `repo-map.json` if command/module structure changes

## Workstream Coverage

This plan explicitly covers all three requested issue areas:

1. **Trigger-mode residue removal**
   - backend/storage cleanup
   - DTO/type cleanup
   - unreachable eval workbench path removal
   - migration/test updates

2. **Throwaway naming cleanup**
   - eval workbench runtime helper rename
   - sidecar helper/type rename
   - transport/config terminology review

3. **Persistent-session orchestration tightening**
   - retain refine’s explicit bootstrap behavior
   - unify refine/workflow send-time orchestration beneath one canonical persistent-turn helper
   - tighten runtime layering without reintroducing a synthetic product/session abstraction

## Task 1: Write Contract Coverage Tests First

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`
- Modify: `app/src-tauri/src/commands/refine/tests.rs`
- Modify: `app/src/__tests__/lib/runtime-api-contract.test.ts`
- Modify: `app/src/__tests__/lib/eval-workbench-tauri.test.ts`

- [ ] **Step 1: Add a failing Rust test for the persistent-turn helper shape**

Add or update tests so they assert:
- refine still prepares a conversation during `start_refine_session`
- workflow persistent turns do not depend on a separate product-only send path
- the runtime layer exposes the persistent-turn path through `openhands_send_message` rather than duplicated orchestration

```rust
#[test]
fn workflow_and_refine_share_persistent_turn_runtime_path_contract() {
    // Assert against the common helper entry point or shared resolution/send policy
    // after extraction so future drift is caught in one place.
}
```

- [ ] **Step 2: Add failing frontend contract assertions for performance-only eval workbench**

Extend the contract tests so they assert:
- no trigger-mode command or frontend mode remains in the live eval workbench contract
- eval workbench uses throwaway runtime naming at its backend boundary

```ts
it("keeps eval workbench performance-only with no trigger contract", () => {
  const source = readSource("lib/eval-workbench.ts");
  expect(source).not.toContain("trigger");
});
```

- [ ] **Step 3: Run the focused contract tests and confirm failure**

Run:

```bash
cd app && npx vitest run \
  src/__tests__/lib/runtime-api-contract.test.ts \
  src/__tests__/lib/eval-workbench-tauri.test.ts
```

Expected:
- failing assertions for the current trigger residue and one-shot naming

- [ ] **Step 4: Commit the test-first checkpoint**

```bash
git add \
  app/src-tauri/src/commands/refine/tests.rs \
  app/src-tauri/src/commands/workflow/tests.rs \
  app/src/__tests__/lib/runtime-api-contract.test.ts \
  app/src/__tests__/lib/eval-workbench-tauri.test.ts
git commit -m "test: codify clean-break follow-up contracts"
```

## Task 2: Remove Trigger-Mode Residue from Eval Workbench Storage and Commands

**Files:**
- Modify: `app/src-tauri/src/db/eval_workbench.rs`
- Modify: `app/src-tauri/src/db/migrations.rs`
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `app/src-tauri/src/commands/eval_workbench/scenarios.rs`
- Modify: `app/src/lib/eval-workbench.ts`
- Modify: `app/src/components/workspace/workspace-eval-workbench.tsx`
- Modify: `app/src/generated/contracts.ts`
- Test: `app/src/__tests__/components/workspace/workspace-evals.test.tsx`
- Test: `app/src/__tests__/components/workspace/workspace-shell.test.tsx`

- [ ] **Step 1: Remove trigger-only enum variants and fields from the live eval workbench model**

Delete:
- `EvalWorkbenchMode::Trigger`
- `should_trigger`
- any trigger-specific validation, labels, defaults, or DTO conversion

Target shape:

```rust
pub enum EvalWorkbenchMode {
    Performance,
}

pub struct Scenario {
    pub id: String,
    pub plugin_slug: String,
    pub skill_name: String,
    pub name: String,
    pub mode: EvalWorkbenchMode,
    pub prompt: String,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
    pub assertions: Vec<String>,
}
```

- [ ] **Step 2: Add migration or compatibility logic for old trigger rows**

If existing local DBs may still contain trigger rows/columns, add a migration that:
- drops dead trigger data from the app-owned schema, or
- maps the app-owned live path away from those fields while preserving compatibility safely

The migration must be explicit and testable in `migrations.rs`.

- [ ] **Step 3: Remove trigger-specific command branches from eval workbench**

Delete or rewrite paths such as:
- trigger mode labels/default names
- trigger-mode scenario creation branches
- trigger-only execution helpers
- dead backend execution/config paths that are unreachable from the live UI

The command layer should reject any non-performance mode at the boundary or remove the mode parameter if no longer needed.

- [ ] **Step 4: Align frontend types and tests to performance-only behavior**

Keep the app-owned TS contract at:

```ts
export type EvalWorkbenchMode = "performance";
export type ScenarioTag = "performance";
```

Update component tests so they cover:
- scenario list/select/save/delete
- no trigger authoring path
- no trigger-mode contract assumptions

- [ ] **Step 5: Regenerate contracts if needed and run focused tests**

Run:

```bash
cd app && npm run codegen
cd app && npx vitest run \
  src/__tests__/components/workspace/workspace-evals.test.tsx \
  src/__tests__/components/workspace/workspace-shell.test.tsx \
  src/__tests__/lib/eval-workbench-tauri.test.ts \
  src/__tests__/lib/runtime-api-contract.test.ts
```

Expected:
- all focused eval workbench tests pass

- [ ] **Step 6: Commit the trigger-residue cleanup**

```bash
git add \
  app/src-tauri/src/db/eval_workbench.rs \
  app/src-tauri/src/db/migrations.rs \
  app/src-tauri/src/commands/eval_workbench/mod.rs \
  app/src-tauri/src/commands/eval_workbench/scenarios.rs \
  app/src/lib/eval-workbench.ts \
  app/src/components/workspace/workspace-eval-workbench.tsx \
  app/src/generated/contracts.ts \
  app/src/__tests__/components/workspace/workspace-evals.test.tsx \
  app/src/__tests__/components/workspace/workspace-shell.test.tsx \
  app/src/__tests__/lib/eval-workbench-tauri.test.ts \
  app/src/__tests__/lib/runtime-api-contract.test.ts
git commit -m "refactor: remove trigger residue from eval workbench"
```

## Task 3: Normalize Throwaway Naming in Eval Workbench and Sidecar Helpers

**Files:**
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `app/src-tauri/src/agents/sidecar.rs`
- Modify: `app/src-tauri/src/types/mod.rs`
- Modify: `docs/design/openhands-runtime-model/README.md`

- [ ] **Step 1: Rename eval workbench runtime imports and call sites**

Replace remaining one-shot symbols with throwaway/runtime equivalents, for example:

```rust
use crate::agents::openhands_server::{
    run_throwaway_openhands_session, OpenHandsThrowawayRunParams,
};
```

and update the call sites accordingly.

- [ ] **Step 2: Rename sidecar helper/type names away from one-shot terminology**

Rename internal helper/type symbols like:
- `OpenHandsOneShotConfigParams`
- `build_openhands_one_shot_config`

to names aligned with the runtime model, for example:
- `OpenHandsThrowawayConfigParams`
- `build_openhands_throwaway_config`

If the serialized transport field must remain `mode: "one-shot"` for compatibility, keep the wire value and document that decision. If it can be renamed safely, rename it consistently and update tests.

- [ ] **Step 3: Update shared defaults and tests for the chosen transport naming**

Update any shared config builders/tests that still assert old helper/type names or transport literals without reason.

Document the chosen compatibility stance in the runtime design doc so future cleanup does not reopen the question.

- [ ] **Step 4: Run focused Rust tests for throwaway naming cleanup**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml \
  commands::eval_workbench \
  commands::skill::scope_review \
  agents::sidecar
```

Expected:
- focused Rust tests pass with updated throwaway naming

- [ ] **Step 5: Commit the naming cleanup**

```bash
git add \
  app/src-tauri/src/commands/eval_workbench/mod.rs \
  app/src-tauri/src/agents/sidecar.rs \
  app/src-tauri/src/types/mod.rs \
  docs/design/openhands-runtime-model/README.md
git commit -m "refactor: rename remaining one-shot runtime helpers"
```

## Task 4: Tighten Persistent-Session Orchestration Around One Canonical Send Path

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Modify: `app/src-tauri/src/commands/refine/mod.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/commands/refine/tests.rs`
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`
- Modify: `docs/design/openhands-runtime-model/send-turn-semantics.md`

- [ ] **Step 1: Extract the shared persistent-turn execution helper**

Create or consolidate one internal helper that owns:
- existing conversation validation
- send semantics
- event recovery
- terminal observation
- conversation-id reuse/update semantics where applicable

Target shape:

```rust
async fn run_persistent_turn(
    app: &tauri::AppHandle,
    agent_id: &str,
    config: SidecarConfig,
    conversation_id: String,
) -> Result<String, String> {
    // shared runtime-owned send path
}
```

The exact name can differ, but there should be one canonical path.

- [ ] **Step 2: Keep refine bootstrap explicit, but route sends through the canonical helper**

Refine should continue to:
- prepare/resume up front in `start_refine_session`
- store the prepared conversation id in the session state

But `send_refine_message` should no longer own bespoke persistent-turn orchestration beyond product-specific prompt/session validation.

- [ ] **Step 3: Route workflow persistent turns through the same canonical helper**

Workflow can keep its product-specific command shape, but the actual send/observe path should delegate to the same runtime helper used by refine sends.

- [ ] **Step 4: Add regression tests for the shared orchestration contract**

Cover at least:
- refine preserves explicit prepare/resume semantics
- workflow still dispatches correctly
- both flows use the same runtime send semantics
- conversation compatibility mismatches still fail loudly

Example focused assertions:

```rust
#[test]
fn refine_bootstraps_but_runtime_send_path_is_shared() {}

#[test]
fn workflow_persistent_turn_uses_shared_runtime_send_path() {}
```

- [ ] **Step 5: Run focused runtime tests**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::refine
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
cargo test --manifest-path app/src-tauri/Cargo.toml agents::openhands_server
```

Expected:
- runtime/refine/workflow tests all pass

- [ ] **Step 6: Commit the orchestration tightening**

```bash
git add \
  app/src-tauri/src/agents/openhands_server/mod.rs \
  app/src-tauri/src/commands/refine/mod.rs \
  app/src-tauri/src/commands/workflow/runtime.rs \
  app/src-tauri/src/commands/refine/tests.rs \
  app/src-tauri/src/commands/workflow/tests.rs \
  docs/design/openhands-runtime-model/send-turn-semantics.md
git commit -m "refactor: unify persistent turn orchestration"
```

## Task 5: Run Full Validation, Docs Checks, and Repo Metadata Audit

**Files:**
- Modify: `repo-map.json` if structure changed
- Modify: `docs/plans/2026-05-08-openhands-runtime-clean-break-followups-plan.md` only if the implementation requires tracked plan updates during execution

- [ ] **Step 1: Run Rust quality gates**

Run:

```bash
cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path app/src-tauri/Cargo.toml
```

Expected:
- clippy clean
- full Rust suite passes

- [ ] **Step 2: Run frontend quality gates**

Run:

```bash
cd app && npx tsc --noEmit
cd app && npm run test:unit
cd app && npm run test:integration
cd app && npm run test:repo-map
```

Expected:
- all frontend and repo-map gates pass

- [ ] **Step 3: Run targeted E2E/runtime regression tags**

Because the changes touch workflow, refine, and eval workbench runtime behavior, run:

```bash
cd app && bash tests/run.sh e2e --tag @workflow
cd app && bash tests/run.sh e2e --tag @refine
cd app && bash tests/run.sh e2e --tag @evals
```

Expected:
- all three tags pass

- [ ] **Step 4: Run docs lint on touched design/plan artifacts**

Run:

```bash
markdownlint \
  docs/design/openhands-runtime-model/README.md \
  docs/design/openhands-runtime-model/send-turn-semantics.md \
  docs/plans/2026-05-08-openhands-runtime-clean-break-followups-plan.md
```

Expected:
- no markdownlint violations

- [ ] **Step 5: Audit `repo-map.json` if any command/module structure changed**

Check:
- command/module descriptions still match the filesystem
- any renamed runtime helper/module references are reflected if the map includes them

Run:

```bash
cd app && npm run test:repo-map
```

- [ ] **Step 6: Create the final implementation commit**

```bash
git add repo-map.json
git commit -m "chore: finalize clean-break runtime follow-ups"
```

## Self-Review

- Spec coverage:
  - trigger-mode residue removal is covered in Task 2
  - throwaway naming cleanup is covered in Task 3
  - persistent-session orchestration tightening is covered in Task 4
- Placeholder scan:
  - no `TBD` / `TODO` placeholders remain
  - each workstream has explicit files, commands, and commit checkpoints
- Type consistency:
  - runtime naming is expressed as persistent vs throwaway
  - refine keeps explicit prepare semantics
  - shared send-path unification is scoped to send-time orchestration, not bootstrap

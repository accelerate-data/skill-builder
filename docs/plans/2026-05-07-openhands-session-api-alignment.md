# OpenHands Session API Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Skill Builder's OpenHands command surfaces so persistent conversational flows use a clear refine-session API, persisted one-shot flows use `dispatch_openhands_one_shot(...)`, and disposable eval-only flows use a uniquely named ephemeral helper.

**Architecture:** Keep three distinct runtime paths. Workflow and persisted suggestion-style calls should use the existing persistent one-shot dispatcher. Refine should keep its product-specific API names, but shift resume/create responsibility into `start_refine_session` and rename the Escape action to `pause_refine_session`. Disposable evaluation and diagnosis runs should stay ephemeral, but the helper should be renamed from `run_openhands_one_shot(...)` to `run_openhands_eval(...)` so the persistence boundary is obvious.

**Tech Stack:** Rust / Tauri commands / OpenHands Agent Server REST + WebSocket orchestration / TypeScript runtime wrappers / Vitest / cargo tests.

**Design doc:** N/A; this plan is based on the command-surface decisions confirmed in the current discussion.

---

## File Structure

| File | Change |
|---|---|
| `app/src-tauri/src/agents/openhands_server/mod.rs` | Rename the ephemeral helper, rename the refine-specific dispatcher if needed, and keep persistent one-shot behavior unchanged |
| `app/src-tauri/src/commands/refine/mod.rs` | Move resume-or-replace session ownership into `start_refine_session`, rename pause command, and keep send scoped to message dispatch |
| `app/src-tauri/src/commands/refine/tests.rs` | Add coverage for start-time resume selection, pause naming, and send-path assumptions |
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | Move persisted suggestion-style flows to `dispatch_openhands_one_shot(...)`; keep disposable eval execution/diagnosis on the renamed ephemeral helper |
| `app/src-tauri/src/commands/skill/suggestions.rs` | Rename ephemeral helper usage only if this flow should stay disposable |
| `app/src-tauri/src/commands/skill/scope_review.rs` | Rename ephemeral helper usage only if this flow should stay disposable |
| `app/src-tauri/src/lib.rs` | Update Tauri command registrations and managed state names if types/commands are renamed |
| `app/src-tauri/src/types/refine.rs` | Rename `RefineSessionInfo` fields/comments only where needed to match the new pause/start semantics |
| `app/src/lib/tauri-command-types.ts` | Rename command names and argument shapes for the refine frontend contract |
| `app/src/lib/tauri.ts` | Rename the exported refine runtime wrappers |
| `app/src/components/workspace/workspace-refine.tsx` | Swap to the renamed start/send/pause commands and keep teardown behavior consistent |
| `app/src/components/layout/app-layout.tsx` | Update Escape/cancel hooks to the renamed pause API |
| `app/src/test/mocks/tauri-e2e.ts` | Rename mocked refine commands |
| `app/src/__tests__/components/workspace/workspace-refine.test.tsx` | Update command names and add coverage for start/resume behavior assumptions |
| `app/src/__tests__/guards/tauri-command-policy.test.ts` | Update allowed command names |
| `app/src/lib/tauri-command-types.typecheck.ts` | Update typed invocation coverage for the renamed refine commands |

---

### Task 1: Rename the ephemeral helper so disposable eval flows are explicit

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `app/src-tauri/src/commands/skill/suggestions.rs`
- Modify: `app/src-tauri/src/commands/skill/scope_review.rs`

- [ ] **Step 1: Add a failing Rust compile/test update that expects `run_openhands_eval(...)` instead of `run_openhands_one_shot(...)` in eval-style callers**

Target callers to update:

```rust
use crate::agents::openhands_server::{
    cancel_openhands_one_shots_with_prefix,
    run_openhands_eval,
    OpenHandsOneShotRunParams,
};
```

- [ ] **Step 2: Run the smallest affected Rust test target to verify the rename is red**

Run: `cargo test --manifest-path app/src-tauri/Cargo.toml commands::eval_workbench -- --nocapture`

Expected: FAIL with unresolved import/function name errors for `run_openhands_one_shot`.

- [ ] **Step 3: Rename the helper in the OpenHands server module without changing its disposable behavior**

Implementation target:

```rust
pub async fn run_openhands_eval(
    app: &tauri::AppHandle,
    params: OpenHandsOneShotRunParams,
) -> Result<OpenHandsOneShotRun, String> {
    // existing run_openhands_one_shot body unchanged
}
```

- [ ] **Step 4: Update all disposable-call sites to the renamed helper**

Callers that should stay disposable:

```rust
let run = run_openhands_eval(
    app,
    OpenHandsOneShotRunParams {
        agent_id_prefix: format!("{}-candidate", prompt_set.skill_name),
        config,
        timeout: std::time::Duration::from_secs(90),
    },
)
.await?;
```

- [ ] **Step 5: Re-run the targeted Rust tests and confirm green**

Run: `cargo test --manifest-path app/src-tauri/Cargo.toml commands::eval_workbench commands::skill -- --nocapture`

Expected: PASS

---

### Task 2: Move persisted suggestion-style flows onto `dispatch_openhands_one_shot(...)`

**Files:**

- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs` only if small helper extraction is needed

- [ ] **Step 1: Add a failing Rust test that persisted suggestion-style flows use the persistent one-shot dispatcher path instead of the disposable helper**

Add/adjust tests around:
- scenario suggestion
- description candidate generation

Target assertion shape:

```rust
assert_eq!(config.skill_name.as_deref(), Some("my-skill"));
assert_eq!(config.run_source.as_deref(), Some("test"));
assert_eq!(config.step_id, Some(-12));
```

and a behavioral assertion that the flow no longer depends on the ephemeral helper result wrapper.

- [ ] **Step 2: Run the targeted eval workbench Rust tests to verify the expected red failure**

Run: `cargo test --manifest-path app/src-tauri/Cargo.toml commands::eval_workbench -- --nocapture`

Expected: FAIL in the updated suggestion-path tests.

- [ ] **Step 3: Replace `run_openhands_eval(...)` with `dispatch_openhands_one_shot(...)` for persisted suggestion-style flows**

Persisted flows to change:

```rust
// suggest_scenario
dispatch_openhands_one_shot(&app, &agent_id, config).await?;

// description candidate generation
dispatch_openhands_one_shot(app, &agent_id, config).await?;
```

Keep disposable flows unchanged:

```rust
// package evaluation execution
run_openhands_eval(...)

// diagnosis helper
run_openhands_eval(...)
```

- [ ] **Step 4: If the persisted suggestion path still needs terminal structured output, add a minimal helper to read the saved run result from the agent event stream or existing persistence rather than relying on the ephemeral return value**

The helper must reuse existing run-result infrastructure instead of duplicating OpenHands parsing rules.

- [ ] **Step 5: Re-run the targeted eval workbench tests and confirm green**

Run: `cargo test --manifest-path app/src-tauri/Cargo.toml commands::eval_workbench -- --nocapture`

Expected: PASS

---

### Task 3: Tighten refine semantics around start/send/pause

**Files:**

- Modify: `app/src-tauri/src/commands/refine/mod.rs`
- Modify: `app/src-tauri/src/commands/refine/tests.rs`
- Modify: `app/src-tauri/src/types/refine.rs`

- [ ] **Step 1: Add a failing Rust test that `start_refine_session` owns resume-or-replace selection and returns the active restored conversation state**

Cover these cases:

```rust
// existing compatible conversation -> restore messages and keep conversation id
// incompatible/missing conversation -> clear or replace before send path
```

- [ ] **Step 2: Add a failing Rust test that `send_refine_message` assumes an already-selected conversation session and only performs message dispatch**

Expected red condition:
- send path still branches on session-held resume/create semantics instead of using start-established state.

- [ ] **Step 3: Rename `cancel_refine_turn` to `pause_refine_session` in Rust while preserving pause semantics**

Target command shape:

```rust
#[tauri::command]
pub async fn pause_refine_session(
    session_id: String,
    sessions: tauri::State<'_, RefineSessionManager>,
) -> Result<(), String> {
    // current cancel_refine_turn body
}
```

- [ ] **Step 4: Refactor `start_refine_session` so it becomes the owner of conversation readiness**

Implementation intent:

```rust
// start_refine_session
// - load saved conversation id
// - validate it against current refine config/session policy
// - persist replacement id if needed
// - restore messages from the active conversation only
```

- [ ] **Step 5: Simplify `send_refine_message` to use the established session conversation and only update `current_agent_id` / returned agent id**

The send path may still update a replacement `conversation_id` if OpenHands returns one, but it should not be the primary resume-policy owner.

- [ ] **Step 6: Run refine-targeted Rust tests and confirm green**

Run: `cargo test --manifest-path app/src-tauri/Cargo.toml commands::refine -- --nocapture`

Expected: PASS

---

### Task 4: Rename the refine frontend/runtime contract

**Files:**

- Modify: `app/src/lib/tauri-command-types.ts`
- Modify: `app/src/lib/tauri.ts`
- Modify: `app/src/components/workspace/workspace-refine.tsx`
- Modify: `app/src/components/layout/app-layout.tsx`
- Modify: `app/src/test/mocks/tauri-e2e.ts`
- Modify: `app/src/__tests__/components/workspace/workspace-refine.test.tsx`
- Modify: `app/src/__tests__/guards/tauri-command-policy.test.ts`
- Modify: `app/src/lib/tauri-command-types.typecheck.ts`

- [ ] **Step 1: Add failing TypeScript/unit expectations for the renamed refine commands**

Rename targets:

```ts
start_refine_session
send_refine_message
pause_refine_session
close_refine_session
```

and TS wrappers:

```ts
startRefineSession
sendRefineMessage
pauseRefineSession
closeRefineSession
```

- [ ] **Step 2: Run the smallest frontend tests/typechecks to verify red**

Run:

```bash
cd app && npx vitest run src/__tests__/components/workspace/workspace-refine.test.tsx
cd app && npx tsc --noEmit
```

Expected: FAIL on old command names.

- [ ] **Step 3: Update the typed command map and wrappers**

Representative command-map update:

```ts
pause_refine_session: { args: { sessionId: string }; result: void };
```

Representative wrapper update:

```ts
export const pauseRefineSession = (sessionId: string) =>
  invokeCommand("pause_refine_session", { sessionId });
```

- [ ] **Step 4: Update the refine UI and layout Escape handling to use the renamed pause API**

Representative usage:

```ts
await pauseRefineSession(store.sessionId);
```

- [ ] **Step 5: Update tests, E2E mocks, and command policy fixtures**

Representative mock shape:

```ts
pause_refine_session: undefined,
```

- [ ] **Step 6: Re-run frontend tests/typechecks and confirm green**

Run:

```bash
cd app && npx vitest run src/__tests__/components/workspace/workspace-refine.test.tsx src/__tests__/guards/tauri-command-policy.test.ts src/__tests__/lib/runtime-api-contract.test.ts
cd app && npx tsc --noEmit
```

Expected: PASS

---

### Task 5: Full verification and repo hygiene

**Files:**

- Review only: `repo-map.json`
- Review only: `TEST_MAP.md`
- Modify only if command/module names changed enough that map text is stale

- [ ] **Step 1: Audit whether `repo-map.json` descriptions mention the old refine cancel semantics or the old ephemeral helper name**

If stale, update the relevant descriptions in the same change set.

- [ ] **Step 2: Run the required Rust + frontend verification suite for touched areas**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::refine commands::eval_workbench commands::skill agents::openhands_server -- --nocapture
cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings
cd app && npm run test:unit
cd app && npx tsc --noEmit
git diff --check
```

Expected:
- all targeted cargo tests pass
- clippy clean
- unit tests pass
- typecheck clean
- no whitespace/conflict errors

- [ ] **Step 3: If `repo-map.json` was touched, run the repo-map audit expectations before completion**

Run the repo’s normal pre-PR audit flow for structural changes if any command/module lists moved.

- [ ] **Step 4: Summarize final behavior changes for review**

Review checklist:

```text
- persisted one-shot flows use dispatch_openhands_one_shot(...)
- disposable eval-only flows use run_openhands_eval(...)
- refine command surface is start/send/pause/close
- refine start owns resume-or-replace policy
```

---

## Self-Review

- Spec coverage: the plan covers the three confirmed runtime lanes (persistent one-shot, persistent refine session, disposable eval run), the refine command-surface rename, and the specific suggestion-flow persistence change.
- Placeholder scan: no `TBD`/`TODO` placeholders remain; each task names concrete files, commands, and expected outcomes.
- Type consistency: the renamed ephemeral helper is consistently `run_openhands_eval(...)`; the persisted refine command set is consistently `start_refine_session`, `send_refine_message`, `pause_refine_session`, and `close_refine_session`.

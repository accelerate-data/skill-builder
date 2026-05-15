# OpenHands Runtime Model Refactor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pause` the only non-shutdown OpenHands control path, reserve OpenHands server shutdown for app shutdown only, split raw OpenHands conversation APIs into `send message` and `run`, add raw `ask_agent` support, and make `build_skill_creator_config(...)` the single canonical runtime-config API.

**Architecture:** Keep the lifecycle boundary explicit. Conversation-level control stays on the runtime/session path through `pause_openhands_conversation(...)`, tracked wrappers only own app-run identity plus throwaway waiting, and process shutdown stays confined to app-exit orchestration in `lib.rs` and `commands/runtime_lifecycle.rs`. Raw conversation operations must mirror the OpenHands model: send message, start run, send more messages while the run is active, then pause if needed. Raw `ask_agent` support should exist at the OpenHands layer as a non-authoritative inspection primitive, but its tracked/product usage is intentionally deferred. All throwaway runs use a system temp root, resolved from the configured temp environment (`TMPDIR`, `TMP`, `TEMP`, then `std::env::temp_dir()`), under `skill-builder/throwaway/{surface}/{run_id}`. Throwaway runtime state must not live under the canonical skills output tree. At the config boundary, replace specialized session/workflow config builders with one canonical `build_skill_creator_config(...)` API driven by typed `SkillCreatorIntent` rather than magic `step_id` values or caller-filled policy fields. Remove the cached-server-only pause helper, remove tracked abort/terminate APIs, make delete/reset/stale-run cleanup use the same real pause path as normal session flows, and ensure one local runner owns each live conversation.

**Tech Stack:** Rust, Tauri commands, OpenHands Agent Server runtime, SQLite-backed runtime settings, markdown docs

---

## Task 1: Split Raw Conversation Primitives and Keep One Pause Primitive

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/client.rs`
- Test: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Test: `app/src-tauri/src/agents/openhands_server/client.rs`

- [x] **Step 1: Expose raw send-message and run primitives separately**

Refactor `app/src-tauri/src/agents/openhands_server/mod.rs` so the raw layer
exposes distinct conversation operations:

```rust
pub async fn send_message_to_openhands_conversation(
    config: OpenHandsRuntimeConfig,
    conversation_id: &str,
    prompt: &str,
) -> Result<(), String>

pub async fn run_openhands_conversation(
    app: &tauri::AppHandle,
    agent_id: &str,
    config: OpenHandsRuntimeConfig,
    conversation_id: String,
) -> Result<String, String>
```

`send_message_to_openhands_conversation(...)` should append the user event only.
`run_openhands_conversation(...)` should own the local socket/task lifecycle for
that run.

- [x] **Step 2: Add raw `ask_agent` client and wrapper support**

Add raw Agent Server support in `app/src-tauri/src/agents/openhands_server/client.rs`:

```rust
pub fn build_ask_agent_request(
    &self,
    conversation_id: &str,
    question: &str,
) -> Result<Request, reqwest::Error>

pub async fn ask_agent(
    &self,
    conversation_id: &str,
    question: &str,
) -> Result<String, String>
```

Add the raw wrapper in `app/src-tauri/src/agents/openhands_server/mod.rs`:

```rust
pub async fn ask_openhands_agent(
    config: OpenHandsRuntimeConfig,
    conversation_id: &str,
    question: &str,
) -> Result<String, String>
```

This step is intentionally limited to the raw layer. Do not add tracked,
workflow, or UI usage in this plan.

- [x] **Step 3: Remove the cached-server-only pause helper from the raw wrapper surface**

Delete `pause_conversation_if_server_running(...)` from `app/src-tauri/src/agents/openhands_server/mod.rs` and keep only the real pause API:

```rust
pub async fn pause_openhands_conversation(
    config: OpenHandsRuntimeConfig,
    conversation_id: &str,
) -> Result<(), String> {
    let request = OpenHandsRuntimeRequest::try_from_runtime_config(&config)?;
    let server =
        ensure_agent_server_process(Duration::from_secs(60), Path::new(&request.app_data_root))
            .await?;
    let client = OpenHandsServerClient::new(
        server.base_url().parse::<reqwest::Url>().map_err(|e| {
            OpenHandsRuntimeError::Operation {
                operation: "parse OpenHands Agent Server base URL",
                detail: e.to_string(),
            }
            .to_string()
        })?,
        Some(server.session_api_key),
    );

    client.pause_conversation(conversation_id).await.map_err(|e| {
        OpenHandsRuntimeError::Operation {
            operation: "pause OpenHands Agent Server conversation",
            detail: e.to_string(),
        }
        .to_string()
    })?;

    Ok(())
}
```

- [x] **Step 4: Unbundle the current send-plus-run path**

Refactor `dispatch_openhands_turn_with_request(...)` so it is no longer the
public raw entrypoint for both message send and run start.

Today it conflates:

- conversation resolution
- prompt send
- `run_conversation(...)`
- local socket ownership
- local task/cancel registration

After the refactor, those concerns should be reachable through the explicit raw
APIs above.

- [ ] **Step 5: Run the focused raw-wrapper tests**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml agents::openhands_server --quiet
```

Expected: PASS with distinct raw send/run operations, raw `ask_agent` support,
and no references to `pause_conversation_if_server_running`.

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/agents/openhands_server/mod.rs app/src-tauri/src/agents/openhands_server/client.rs
git commit -m "refactor: expand raw OpenHands conversation APIs"
```

## Task 2: Narrow the Tracked Wrapper Surface and Reuse Live Conversation Runners

**Files:**

- Modify: `app/src-tauri/src/agents/tracked_openhands.rs`
- Modify: `app/src-tauri/src/commands/skill_session.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/commands/refine/mod.rs`
- Modify: `app/src-tauri/src/commands/skill/crud.rs`
- Modify: `app/src-tauri/src/commands/api_validation.rs`
- Modify: `app/src-tauri/src/commands/skill/scope_review.rs`
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Test: `app/src-tauri/src/commands/skill_session.rs`
- Test: `app/src-tauri/src/commands/workflow/runtime.rs`

- [x] **Step 1: Rename the throwaway tracked wrapper to match what it does**

Rename `run_tracked_throwaway_openhands_session(...)` in
`app/src-tauri/src/agents/tracked_openhands.rs` to `send_tracked_throwaway(...)`.
It is a send-and-wait one-shot wrapper, not a generic `run` primitive:

```rust
pub async fn send_tracked_throwaway(
    app: &tauri::AppHandle,
    params: OpenHandsThrowawayRunParams,
) -> Result<OpenHandsThrowawayRun, String> {
    // existing implementation body
}
```

Update callers in:

- `app/src-tauri/src/commands/api_validation.rs`
- `app/src-tauri/src/commands/skill/scope_review.rs`
- `app/src-tauri/src/commands/eval_workbench/mod.rs`

- [x] **Step 2: Remove tracked abort and terminate APIs**

Delete these functions from `app/src-tauri/src/agents/tracked_openhands.rs`:

```rust
pub fn abort_tracked_openhands_run(agent_id: &str) -> bool { ... }

pub async fn terminate_tracked_openhands_session(
    agent_id: &str,
    timeout: Duration,
) -> bool { ... }
```

The tracked layer should not expose local-detach or local-terminate semantics.
Tracked runs stop through pause.

- [x] **Step 3: Extract the existing pause config build pattern into a reusable helper**

Add a helper near `build_skill_session_config(...)` so delete/reset paths can build the same real pause config as selected-skill pause:

```rust
pub(crate) fn build_pause_runtime_config(
    app: &tauri::AppHandle,
    db: &Db,
    skill_name: &str,
    plugin_slug: &str,
) -> Result<crate::agents::runtime_config::OpenHandsRuntimeConfig, String> {
    let runtime_ctx = crate::commands::workflow::read_initialized_runtime_context(db)?;
    let skills_root = resolve_skills_path(db)?;
    let app_data_root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .to_string_lossy()
        .replace('\\', "/");

    Ok(build_skill_session_config(
        skill_name,
        plugin_slug,
        "",
        &app_data_root,
        &skills_root,
        runtime_ctx.llm,
    ))
}
```

Use that helper inside `pause_openhands_session(...)` instead of duplicating the same config-building logic inline.

- [x] **Step 4: Keep the helper read-only in intent**

Do not add new pause semantics here. The helper only builds config for the existing raw pause API:

```rust
let config = build_pause_runtime_config(&app, &db, &skill_name, &plugin_slug)?;
let local_closed = crate::agents::tracked_openhands::pause_tracked_openhands_conversation(
    config,
    &conversation_id,
    agent_id.as_deref(),
)
.await?;
```

- [ ] **Step 5: Rewrite stale-run cleanup to use pause semantics**

Replace stale workflow cleanup in `app/src-tauri/src/commands/workflow/runtime.rs`.
Today it calls `abort_tracked_openhands_run(...)`; instead it should pause the
existing tracked run using the stored conversation context, then remove stale
bookkeeping only after pause has been requested.

If the current workflow-run state does not retain enough conversation context
to pause correctly, add the smallest missing state needed for that operation
instead of reintroducing a local-abort API.

- [x] **Step 6: Make tracked persistent send reuse the existing live runner**

Update `send_tracked_openhands_message(...)` so it no longer assumes every send
must start a new run task.

Target behavior:

- if the conversation is idle:
  - call raw `send_message_to_openhands_conversation(...)`
  - then call raw `run_openhands_conversation(...)`
- if the conversation already has a live local runner:
  - call only raw `send_message_to_openhands_conversation(...)`
  - do not spawn a second socket/task owner for that conversation

This may require adding the smallest conversation-ownership lookup needed to
tell whether a live local runner already exists for the target conversation.

- [x] **Step 7: Rewrite skill-delete cleanup to use pause semantics**

Replace `terminate_tracked_openhands_session(...)` usage in
`app/src-tauri/src/commands/skill/crud.rs` with pause-oriented cleanup. Delete
should pause known conversations and then clear local bookkeeping; it should
not perform local terminate semantics for tracked runs.

- [ ] **Step 8: Run the affected tests**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill_session --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::refine --quiet
```

Expected: PASS with `pause_openhands_session(...)` still using the tracked
pause wrapper, throwaway callers using `send_tracked_throwaway(...)`, no
remaining references to tracked abort/terminate helpers, and no second local
runner created for a send to an already running conversation.

- [ ] **Step 9: Commit**

```bash
git add app/src-tauri/src/agents/tracked_openhands.rs app/src-tauri/src/commands/skill_session.rs app/src-tauri/src/commands/workflow/runtime.rs app/src-tauri/src/commands/refine/mod.rs app/src-tauri/src/commands/skill/crud.rs app/src-tauri/src/commands/api_validation.rs app/src-tauri/src/commands/skill/scope_review.rs app/src-tauri/src/commands/eval_workbench/mod.rs
git commit -m "refactor: reuse live OpenHands conversation runners"
```

## Task 3: Finish the Canonical Config API Cleanup

**Files:**

- Modify: `app/src-tauri/src/agents/skill_creator.rs`
- Modify: `app/src-tauri/src/commands/skill_session.rs`
- Modify: `app/src-tauri/src/commands/refine/mod.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/commands/api_validation.rs`
- Modify: `app/src-tauri/src/commands/skill/scope_review.rs`
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `docs/design/openhands-runtime-contract/README.md`
- Test: `app/src-tauri/src/agents/skill_creator.rs`
- Test: `app/src-tauri/src/commands/refine/tests.rs`

- [x] **Step 1: Replace ad hoc policy fields with typed runtime intent**

Refactor `app/src-tauri/src/agents/skill_creator.rs` so the canonical builder
accepts a typed context:

```rust
pub fn build_skill_creator_config(
    context: SkillCreatorRuntimeContext,
) -> OpenHandsRuntimeConfig

pub struct SkillCreatorRuntimeContext {
    pub app_data_root: String,
    pub skills_root: String,
    pub skill_name: String,
    pub plugin_slug: String,
    pub prompt: String,
    pub llm: WorkflowLlmConfig,
    pub intent: SkillCreatorIntent,
}

pub enum SkillCreatorIntent {
    Refine,
    WorkflowStep { step: WorkflowStepKind },
    AnswerEvaluator,
    Eval,
    ScopeReview,
    ModelValidation,
}
```

The builder should derive `task_kind`, `run_source`, `allowed_tools`,
`max_turns`, `output_format`, and persisted `step_id` from `intent`.

- [x] **Step 2: Keep `step_id` derived, not caller-owned**

Do not make integer `step_id` values the public API. The mapping should live
inside the builder:

```rust
match intent {
    SkillCreatorIntent::Refine => /* derive refine policy + persisted step id */,
    SkillCreatorIntent::WorkflowStep { step } => /* derive step 0-3 policy */,
    SkillCreatorIntent::AnswerEvaluator => /* derive evaluator policy */,
    SkillCreatorIntent::Eval => /* derive eval policy */,
    SkillCreatorIntent::ScopeReview => /* derive scope review policy */,
    SkillCreatorIntent::ModelValidation => /* derive validation policy */,
}
```

- [x] **Step 3: Remove specialized config builders where they add no policy**

Delete or inline wrappers like `build_skill_session_config(...)`,
`build_generation_runtime_config(...)`, and any remaining per-surface config
builders once callers can construct a `SkillCreatorRuntimeContext` directly.

The final caller pattern should look like:

```rust
let config = build_skill_creator_config(SkillCreatorRuntimeContext {
    app_data_root,
    skills_root,
    skill_name,
    plugin_slug,
    prompt,
    llm,
    intent: SkillCreatorIntent::WorkflowStep {
        step: WorkflowStepKind::GenerateSkill,
    },
});
```

Keep `build_pause_runtime_config(...)` only if it remains a pause-config helper
with real caller value. It should not keep `build_skill_session_config(...)`
alive as a compatibility layer.

- [ ] **Step 4: Update all runtime-config callers**

Move these surfaces onto the canonical builder:

- selected-skill/refine session
- workflow steps 0-3
- answer evaluator
- scope review
- model validation
- eval workbench throwaway helpers

If a surface needs a different runtime policy, encode it as a typed intent
variant rather than another thin builder wrapper.

All throwaway intents should resolve their working directory under the system
temp root, not under `skills_path`. Use one shared helper that resolves the
base temp directory from `TMPDIR`, `TMP`, `TEMP`, then `std::env::temp_dir()`,
and place throwaway runs at:

```text
{system_tmp}/skill-builder/throwaway/{surface}/{run_id}
```

Apply this uniformly to scope review, eval workbench, model validation, and any
future throwaway surfaces. Persistent selected-skill or workflow sessions keep
their existing non-throwaway storage contract.

Selected-skill/refine callers should construct `SkillCreatorRuntimeContext`
directly rather than routing through a refine-specific config wrapper.

Update `docs/design/openhands-runtime-contract/README.md` in the same task so
the Layer 4 API list no longer claims `build_skill_session_config(...)` is a
first-class wrapper if that helper is removed.

- [ ] **Step 5: Run focused builder and caller tests**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml agents::skill_creator --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill_session --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::refine --quiet
```

Expected: PASS with one canonical config builder and no public reliance on raw
integer `step_id` as the caller-facing abstraction, no remaining compatibility
wrapper like `build_skill_session_config(...)`, and throwaway callers all using
the shared system-temp runtime root.

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/agents/skill_creator.rs app/src-tauri/src/commands/skill_session.rs app/src-tauri/src/commands/refine/mod.rs app/src-tauri/src/commands/workflow/runtime.rs app/src-tauri/src/commands/api_validation.rs app/src-tauri/src/commands/skill/scope_review.rs app/src-tauri/src/commands/eval_workbench/mod.rs app/src-tauri/src/skill_paths.rs docs/design/openhands-runtime-contract/README.md
git commit -m "refactor: make skill creator config intent-driven"
```

## Task 4: Clean Up Delete and Reset Contract Boundaries

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Modify: `app/src-tauri/src/commands/skill/crud.rs`
- Modify: `app/src-tauri/src/commands/workflow/evaluation.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `docs/design/openhands-runtime-contract/README.md`
- Test: `app/src-tauri/src/commands/skill/tests.rs`
- Test: `app/src-tauri/src/commands/workflow/evaluation.rs`
- Test: `app/src-tauri/src/agents/openhands_server/mod.rs`

- [x] **Step 1: Finish the remaining `delete_skill(...)` contract cleanup**

On this branch, `delete_skill(...)` already takes `app: tauri::AppHandle`,
already builds pause config, and already performs best-effort remote
pause/delete per conversation. The remaining work is to preserve that behavior
while removing the incorrect local cleanup keyed by `conversation_id`.

Preserve this remote cleanup shape:

```rust
#[tauri::command]
pub async fn delete_skill(
    app: tauri::AppHandle,
    workspace_path: String,
    name: String,
    db: tauri::State<'_, Db>,
    workflow_runs: tauri::State<'_, WorkflowStepRunManager>,
    refine_sessions: tauri::State<'_, SkillSessionManager>,
) -> Result<(), String> {
    // ...
    let pause_config =
        crate::commands::skill_session::build_pause_runtime_config(&app, &db, &name, &plugin_slug);

    for conv_id in &conversation_ids {
        if let Ok(config) = pause_config.clone() {
            if let Err(error) =
                crate::agents::openhands_server::pause_openhands_conversation(config, conv_id).await
            {
                log::warn!("[delete_skill] failed to pause conversation {}: {}", conv_id, error);
            }
        }
    }
    // ...
}
```

Important: keep delete as best-effort at the call site. Failure to pause must log and continue; it must not block deletion. After pausing, delete each conversation from the OpenHands server:

```rust
    for conv_id in &conversation_ids {
        if let Ok(config) = pause_config.clone() {
            if let Err(error) =
                crate::agents::openhands_server::delete_openhands_conversation(config, conv_id).await
            {
                log::warn!("[delete_skill] failed to delete conversation {}: {}", conv_id, error);
            }
        }
    }
```

- [x] **Step 2: Fix delete-path local cleanup ownership**

`delete_skill(...)` currently has two distinct cleanup concerns:

- remote cleanup keyed by `conversation_id`
- local tracked-run cleanup keyed by `agent_id`

Do not call `close_local_openhands_run(...)` with `conversation_id` values.
Instead, use the tracked runtime bookkeeping that already knows the active
`agent_id` values for refine/workflow sessions and only close local runs by
`agent_id`.

If the existing shutdown plan already collects the necessary tracked `agent_id`
values, delete the incorrect conversation-ID cleanup loop entirely. If there is
still one missing path, add the smallest helper that resolves tracked
`agent_id`s without broadening the runtime contract.

- [x] **Step 3: Keep reset ownership at the product-command layer**

`reset_workflow_step(...)` is the product owner of reset semantics. It should
sequence:

1. pause current conversation
2. reset local product state
3. fork the paused conversation
4. delete the source conversation
5. bind the skill to the fork ID
6. leave future execution to the normal send/run path

Do not add a Layer 3 reset abstraction.

Do not route reset through a Layer 2 fork helper. The product command should
call the raw Layer 1 fork API directly.

- [x] **Step 4: Align the fork helper boundary with the chosen ownership model**

Make the plan and docs consistent with the chosen ownership model:

- delete `fork_skill_session(...)`
- call `fork_openhands_conversation(...)` directly from the product reset command
- update `docs/design/openhands-runtime-contract/README.md` so it no longer
  claims Layer 2 owns skill rebinding during reset

The raw runtime wrapper remains:

```rust
pub struct ForkedOpenHandsSession {
    pub conversation_id: String,
    pub restored_events: Vec<serde_json::Value>,
}

pub async fn fork_openhands_conversation(
    app: &tauri::AppHandle,
    config: OpenHandsRuntimeConfig,
    source_conversation_id: &str,
) -> Result<ForkedOpenHandsSession, String> {
    // call OpenHands fork
    // fetch restored events for the fork
}
```

Fork creates a new `conversation_id`. It does not create a new `agent_id`.
Do not let any helper silently clear or overwrite the new binding after it is
returned to the product reset flow.

- [x] **Step 5: Update `reset_workflow_step(...)` to pause, reset, fork, delete source, and rebind**

Change reset to this sequence:

1. pause current conversation
2. reset files, artifacts, and DB state to the target step
3. fork the paused conversation
4. delete the source conversation from the OpenHands server
5. bind the skill to the fork ID
6. leave future live execution to the normal workflow send/run path

The old conversation must be deleted after the fork succeeds. Remove the conversation-dir deletion
and do not clear conversation state as a destructive reset primitive.

Final target after this cleanup:

```rust
let pause_config =
    crate::commands::skill_session::build_pause_runtime_config(&app_handle, &db, &skill_name, &plugin_slug)?;

crate::agents::openhands_server::pause_openhands_conversation(
    pause_config.clone(),
    &active_conversation_id,
)
.await?;

// reset files/artifacts/db to target step

let forked = crate::agents::openhands_server::fork_openhands_conversation(
    &app_handle,
    pause_config,
    &active_conversation_id,
)
.await?;
```

Critical correctness rule: do not call `clear_skill_conversation_db_records(...)`
after saving the new fork ID. If old-record cleanup is still needed, it must
target only the superseded source binding without deleting the new fork binding.

- [x] **Step 6: Keep `agent_id` creation in the next live send/run path**

Do not create a new `agent_id` during fork. The next live execution on the fork
should create the new tracked `agent_id` through the existing product send/run
entrypoint, for example in `run_workflow_step(...)`.

If needed, add a short code comment or helper boundary to make this explicit.

- [ ] **Step 7: Add or update tests around the new boundary**

Cover these cases with the smallest existing suites:

```rust
// commands/skill/tests.rs
// Assert delete still completes when pause config resolution fails or pause returns an error.
// Assert delete deletes conversations from the OpenHands server.
// Assert delete only closes local tracked runs by agent_id, not conversation_id.

// commands/workflow/evaluation.rs tests
// Assert reset does not delete conversation storage before fork.
// Assert reset forks, deletes source, and rebinds the skill conversation.
// Assert the previous conversation is deleted from the OpenHands server after fork succeeds.
// Assert the new fork binding remains persisted after reset completes.
```

If a direct async command test is too expensive, extract smaller helpers for:

- pause-and-log behavior
- reset-state mutation
- fork-and-rebind behavior
- delete-path tracked-agent cleanup

- [ ] **Step 8: Run the affected command tests**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml agents::openhands_server --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow --quiet
```

Expected: PASS with no remaining destructive reset of conversation storage and
with reset moving to pause → reset → fork → delete source → rebind semantics,
and with delete-path local cleanup no longer keyed by `conversation_id`.

- [ ] **Step 9: Commit**

```bash
git add app/src-tauri/src/agents/openhands_server/mod.rs app/src-tauri/src/commands/skill/crud.rs app/src-tauri/src/commands/workflow/evaluation.rs app/src-tauri/src/commands/workflow/runtime.rs app/src-tauri/src/commands/skill/tests.rs docs/design/openhands-runtime-contract/README.md
git commit -m "refactor: fork workflow conversations on reset"
```

## Task 5: Validation Cleanup for the Runtime Contract

**Files:**

- Modify: `app/src-tauri/src/commands/workflow/evaluation.rs`
- Modify: `app/src-tauri/src/commands/skill/tests.rs`
- Modify: `app/src-tauri/src/commands/refine/tests.rs`
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`

- [x] **Step 1: Remove tests that encode the wrong reset outcome**

Delete or rewrite any tests that currently simulate:

1. saving a forked `conversation_id`
2. clearing all conversation bindings
3. asserting `None` as the expected post-reset state

That sequence encodes the opposite of the design contract. After a successful
fork-and-rebind reset, the skill should remain bound to the forked
`conversation_id`.

- [ ] **Step 2: Replace DB-only smoke tests with boundary-focused helper tests**

Prefer smaller tests that prove the actual contract boundaries over broad
“smoke” tests that only mutate DB rows. At minimum, cover these helper-level
behaviors:

- successful fork keeps the new bound `conversation_id`
- source conversation delete happens only after fork succeeds
- delete-skill pause/delete stays best-effort and non-blocking
- local tracked-run cleanup uses `agent_id` ownership, not `conversation_id`

If the current command functions are too heavy to test directly, extract narrow
helpers for these boundaries and test those helpers instead.

- [ ] **Step 3: Tighten persistent-send and reuse assertions where the contract changed**

Review refine/workflow tests that cover persistent-send behavior and make sure
they assert the actual one-runner contract:

- sending to an idle conversation performs send then run
- sending to a live conversation performs send only
- the conversation ID is reused
- a new tracked `agent_id` is created only on the next live run boundary, not
  during fork

- [ ] **Step 4: Run the contract-focused test filters**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::refine --quiet
```

Expected: PASS with no test still encoding “clear the fork binding and expect
None,” and with focused coverage around the real delete/reset ownership
boundaries.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/commands/workflow/evaluation.rs app/src-tauri/src/commands/skill/tests.rs app/src-tauri/src/commands/refine/tests.rs app/src-tauri/src/commands/workflow/tests.rs
git commit -m "test: align OpenHands runtime contract coverage"
```

## Task 6: Keep Server Shutdown App-Lifecycle Only and Update Docs

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Verify only: `app/src-tauri/src/lib.rs`
- Verify only: `app/src-tauri/src/commands/runtime_lifecycle.rs`

- [x] **Step 1: Add a raw shutdown wrapper parallel to `ensure_openhands_server(...)`**

Add a raw wrapper in `app/src-tauri/src/agents/openhands_server/mod.rs`:

```rust
pub async fn shutdown_openhands_server() -> Result<(), String> {
    crate::agents::openhands_server::process::shutdown_agent_server().await
}
```

This keeps app-lifecycle callers on the raw OpenHands API surface instead of
reaching into `process.rs` directly.

- [x] **Step 2: Verify shutdown remains confined to app-exit flows**

Confirm the only remaining `shutdown_agent_server()` call sites are app-shutdown lifecycle paths:

```bash
rg -n "shutdown_agent_server\\(" app/src-tauri/src
```

Expected:

```text
app/src-tauri/src/lib.rs
app/src-tauri/src/commands/runtime_lifecycle.rs
app/src-tauri/src/agents/openhands_server/process.rs
```

- [x] **Step 3: Move app-shutdown callers onto the raw shutdown wrapper**

Update app-exit orchestration to call `crate::agents::openhands_server::shutdown_openhands_server()`
instead of `process::shutdown_agent_server()` directly:

```rust
crate::agents::openhands_server::shutdown_openhands_server()
    .await
    .map_err(|e| format!("OpenHands Agent Server shutdown failed: {e}"))?;
```

and

```rust
if let Err(e) = crate::agents::openhands_server::shutdown_openhands_server().await {
    log::warn!("[exit] OpenHands Agent Server shutdown failed: {e}");
}
```

Status on this branch: already implemented in `app/src-tauri/src/agents/openhands_server/mod.rs`,
`app/src-tauri/src/lib.rs`, and `app/src-tauri/src/commands/runtime_lifecycle.rs`.

Expected after the refactor:

```bash
rg -n "process::shutdown_agent_server|shutdown_openhands_server\\(" app/src-tauri/src
```

shows product call sites using the raw wrapper, with `process::shutdown_agent_server()`
remaining only inside the raw wrapper module.

- [x] **Step 4: Run final repo checks for this change**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml agents::openhands_server --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill_session --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow --quiet
```

Expected: PASS

- [x] **Step 5: Commit**

```bash
git add app/src-tauri/src/agents/openhands_server/mod.rs app/src-tauri/src/lib.rs app/src-tauri/src/commands/runtime_lifecycle.rs
git commit -m "refactor: add raw OpenHands shutdown wrapper"
```

Status on this branch: the focused verification filters for this shutdown-wrapper
state have already passed.

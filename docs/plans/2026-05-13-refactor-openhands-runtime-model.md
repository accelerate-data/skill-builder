# OpenHands Runtime Model Refactor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pause` the only non-shutdown OpenHands control path, reserve OpenHands server shutdown for app shutdown only, split raw OpenHands conversation APIs into `send message` and `run`, add raw `ask_agent` support, and make `build_skill_creator_config(...)` the single canonical runtime-config API.

**Architecture:** Keep the lifecycle boundary explicit. Conversation-level control stays on the runtime/session path through `pause_openhands_conversation(...)`, tracked wrappers only own app-run identity plus throwaway waiting, and process shutdown stays confined to app-exit orchestration in `lib.rs` and `commands/runtime_lifecycle.rs`. Raw conversation operations must mirror the OpenHands model: send message, start run, send more messages while the run is active, then pause if needed. Raw `ask_agent` support should exist at the OpenHands layer as a non-authoritative inspection primitive, but its tracked/product usage is intentionally deferred. Skill-related throwaway runs use the canonical skill dir as their working directory; non-skill-related throwaways use `/tmp/skill-builder/throwaway/{surface}/{run_id}`. At the config boundary, replace specialized session/workflow config builders with one canonical `build_skill_creator_config(...)` API driven by typed `SkillCreatorIntent` rather than magic `step_id` values or caller-filled policy fields. Remove the cached-server-only pause helper, remove tracked abort/terminate APIs, make delete/reset/stale-run cleanup use the same real pause path as normal session flows, and ensure one local runner owns each live conversation.

**Tech Stack:** Rust, Tauri commands, OpenHands Agent Server runtime, SQLite-backed runtime settings, markdown docs

---

## Task 1: Split Raw Conversation Primitives and Keep One Pause Primitive

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/client.rs`
- Test: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Test: `app/src-tauri/src/agents/openhands_server/client.rs`

- [ ] **Step 1: Expose raw send-message and run primitives separately**

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

- [ ] **Step 2: Add raw `ask_agent` client and wrapper support**

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

- [ ] **Step 3: Remove the cached-server-only pause helper from the raw wrapper surface**

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

- [ ] **Step 4: Unbundle the current send-plus-run path**

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

- [ ] **Step 1: Rename the throwaway tracked wrapper to match what it does**

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

- [ ] **Step 2: Remove tracked abort and terminate APIs**

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

- [ ] **Step 3: Extract the existing pause config build pattern into a reusable helper**

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

- [ ] **Step 4: Keep the helper read-only in intent**

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

- [ ] **Step 6: Make tracked persistent send reuse the existing live runner**

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

- [ ] **Step 7: Rewrite skill-delete cleanup to use pause semantics**

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

## Task 3: Make `build_skill_creator_config(...)` the Canonical Config API

**Files:**

- Modify: `app/src-tauri/src/agents/skill_creator.rs`
- Modify: `app/src-tauri/src/commands/skill_session.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/commands/api_validation.rs`
- Modify: `app/src-tauri/src/commands/skill/scope_review.rs`
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Test: `app/src-tauri/src/agents/skill_creator.rs`
- Test: `app/src-tauri/src/commands/refine/tests.rs`

- [ ] **Step 1: Replace ad hoc policy fields with typed runtime intent**

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

- [ ] **Step 2: Keep `step_id` derived, not caller-owned**

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

- [ ] **Step 3: Remove specialized config builders where they add no policy**

Delete or inline wrappers like `build_skill_session_config(...)` and the
per-step workflow config builders once callers can construct a
`SkillCreatorRuntimeContext` directly.

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

Skill-related throwaway intents should resolve their working directory to the
canonical skill dir. Only non-skill-related throwaway intents should resolve to
`/tmp/skill-builder/throwaway/{surface}/{run_id}`.

- [ ] **Step 5: Run focused builder and caller tests**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml agents::skill_creator --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill_session --quiet
```

Expected: PASS with one canonical config builder and no public reliance on raw
integer `step_id` as the caller-facing abstraction.

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/agents/skill_creator.rs app/src-tauri/src/commands/skill_session.rs app/src-tauri/src/commands/workflow/runtime.rs app/src-tauri/src/commands/api_validation.rs app/src-tauri/src/commands/skill/scope_review.rs app/src-tauri/src/commands/eval_workbench/mod.rs
git commit -m "refactor: make skill creator config intent-driven"
```

## Task 4: Route Delete Through Pause and Reset Through Pause-Then-Fork

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Modify: `app/src-tauri/src/agents/skill_creator.rs`
- Modify: `app/src-tauri/src/commands/skill/crud.rs`
- Modify: `app/src-tauri/src/commands/workflow/evaluation.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Test: `app/src-tauri/src/commands/skill/tests.rs`
- Test: `app/src-tauri/src/commands/workflow/evaluation.rs`
- Test: `app/src-tauri/src/agents/openhands_server/mod.rs`

- [ ] **Step 1: Update `delete_skill(...)` to pause with real runtime config**

Change `delete_skill(...)` to take `app: tauri::AppHandle` and build one pause config before looping over conversation IDs:

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

Important: keep delete as best-effort at the call site. Failure to pause must log and continue; it must not block deletion.

- [ ] **Step 2: Add raw and shared fork APIs**

Add the raw runtime wrapper:

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

Add the shared session wrapper:

```rust
pub async fn fork_skill_session(
    app: &tauri::AppHandle,
    config: OpenHandsRuntimeConfig,
    source_conversation_id: &str,
) -> Result<ForkedOpenHandsSession, String> {
    // fork raw conversation
    // bind skill to fork conversation_id
}
```

Fork creates a new `conversation_id`. It does not create a new `agent_id`.

- [ ] **Step 3: Update `reset_workflow_step(...)` to pause, reset, fork, and rebind**

Change reset to this sequence:

1. pause current conversation
2. reset files, artifacts, and DB state to the target step
3. fork the paused conversation
4. bind the skill to the fork ID
5. leave future live execution to the normal workflow send/run path

The old conversation must remain persisted. Remove the conversation-dir deletion
and do not clear conversation state as a destructive reset primitive.

Sketch:

```rust
let pause_config =
    crate::commands::skill_session::build_pause_runtime_config(&app_handle, &db, &skill_name, &plugin_slug)?;

crate::agents::openhands_server::pause_openhands_conversation(
    pause_config.clone(),
    &active_conversation_id,
)
.await?;

// reset files/artifacts/db to target step

let forked = crate::agents::skill_creator::fork_skill_session(
    &app_handle,
    pause_config,
    &active_conversation_id,
)
.await?;
```

- [ ] **Step 4: Keep `agent_id` creation in the next live send/run path**

Do not create a new `agent_id` during fork. The next live execution on the fork
should create the new tracked `agent_id` through the existing product send/run
entrypoint, for example in `run_workflow_step(...)`.

If needed, add a short code comment or helper boundary to make this explicit.

- [ ] **Step 5: Add or update tests around the new boundary**

Cover these cases with the smallest existing suites:

```rust
// commands/skill/tests.rs
// Assert delete still completes when pause config resolution fails or pause returns an error.

// commands/workflow/evaluation.rs tests
// Assert reset does not delete conversation storage.
// Assert reset forks and rebinds the skill conversation.
// Assert the previous conversation remains persisted.
```

If a direct async command test is too expensive, extract smaller helpers for:

- pause-and-log behavior
- reset-state mutation
- fork-and-rebind behavior

- [ ] **Step 6: Run the affected command tests**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml agents::openhands_server --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow --quiet
```

Expected: PASS with no remaining destructive reset of conversation storage and
with reset moving to pause → reset → fork → rebind semantics.

- [ ] **Step 7: Commit**

```bash
git add app/src-tauri/src/agents/openhands_server/mod.rs app/src-tauri/src/agents/skill_creator.rs app/src-tauri/src/commands/skill/crud.rs app/src-tauri/src/commands/workflow/evaluation.rs app/src-tauri/src/commands/workflow/runtime.rs app/src-tauri/src/commands/skill/tests.rs
git commit -m "refactor: fork workflow conversations on reset"
```

## Task 5: Keep Server Shutdown App-Lifecycle Only and Update Docs

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Verify only: `app/src-tauri/src/lib.rs`
- Verify only: `app/src-tauri/src/commands/runtime_lifecycle.rs`

- [ ] **Step 1: Add a raw shutdown wrapper parallel to `ensure_openhands_server(...)`**

Add a raw wrapper in `app/src-tauri/src/agents/openhands_server/mod.rs`:

```rust
pub async fn shutdown_openhands_server() -> Result<(), String> {
    crate::agents::openhands_server::process::shutdown_agent_server().await
}
```

This keeps app-lifecycle callers on the raw OpenHands API surface instead of
reaching into `process.rs` directly.

- [ ] **Step 2: Verify shutdown remains confined to app-exit flows**

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

- [ ] **Step 3: Move app-shutdown callers onto the raw shutdown wrapper**

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

Expected after the refactor:

```bash
rg -n "process::shutdown_agent_server|shutdown_openhands_server\\(" app/src-tauri/src
```

shows product call sites using the raw wrapper, with `process::shutdown_agent_server()`
remaining only inside the raw wrapper module.

- [ ] **Step 4: Run final repo checks for this change**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml agents::openhands_server --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill_session --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill --quiet
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow --quiet
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/agents/openhands_server/mod.rs app/src-tauri/src/lib.rs app/src-tauri/src/commands/runtime_lifecycle.rs
git commit -m "refactor: add raw OpenHands shutdown wrapper"
```

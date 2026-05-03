# Refine OpenHands Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Refine UI surface from Claude Code sidecar streaming to OpenHands Agent Server multi-turn conversation.

**Architecture:** Refine becomes a persistent OpenHands conversation kept alive across user messages. Turn 1 creates the conversation; turn N appends a `MessageEvent` and re-runs. Cancel pauses the running turn but keeps the conversation; close deletes it.

**Tech Stack:** Rust (Tauri commands, OpenHands client), TypeScript/React (frontend refine tab), Tauri IPC events, OpenHands Agent Server REST + WebSocket.

**Design Spec:** `docs/design/refine-openhands-migration/README.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `app/src-tauri/src/agents/openhands_server/client.rs` | Add `send_event` async wrapper for the `/events` endpoint |
| `app/src-tauri/src/agents/openhands_server/mod.rs` | Add `dispatch_openhands_refine_turn`, `close_openhands_refine_session`, `run_refine_conversation_task` |
| `app/src-tauri/src/commands/refine/mod.rs` | `RefineSession` struct + Tauri commands rewritten for OpenHands |
| `app/src-tauri/src/commands/refine/protocol.rs` | Strip Claude Code streaming artifacts; keep prompt builders |
| `app/src-tauri/src/commands/refine/tests.rs` | Remove stale streaming tests; add new struct + prompt tests |
| `app/src-tauri/src/lib.rs` | Remove `answer_refine_question` from command registration |
| `agent-sources/prompts/refine-initial.txt` | Remove ROUTING + AskUserQuestion; add plain-text eval guidance |
| `app/src/lib/tauri-command-types.ts` | Remove `answer_refine_question` command type |
| `app/src/lib/tauri.ts` | Remove `answerStreamingRefineQuestion`; rename to `sendRefineMessage` |
| `app/src/components/workspace/workspace-refine.tsx` | Remove sidecar cleanup, model guard, AskUserQuestion handler |

---

## Task 1: Add `send_event` HTTP wrapper

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/client.rs:38-49`

- [x] **Step 1: Add `send_event` async method**

Edit `app/src-tauri/src/agents/openhands_server/client.rs`. After the existing `delete_conversation` method (line 110-116) insert:

```rust
    pub async fn send_event(
        &self,
        conversation_id: &str,
        event: serde_json::Value,
    ) -> Result<(), reqwest::Error> {
        self.http
            .execute(self.build_send_event_request(conversation_id, event)?)
            .await?
            .error_for_status()?;
        Ok(())
    }
```

Also remove the `#[allow(dead_code)]` attribute above `build_send_event_request` (line 37) since it now has a caller.

- [x] **Step 2: Build to verify**

Run: `cargo build --manifest-path app/src-tauri/Cargo.toml`
Expected: clean build.

- [x] **Step 3: Commit**

```bash
git add app/src-tauri/src/agents/openhands_server/client.rs
git commit -m "VU-1145: add send_event wrapper for OpenHands events endpoint

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Add refine dispatch + close in `openhands_server/mod.rs`

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs` — add three new functions after `dispatch_openhands_one_shot`

- [x] **Step 1: Add `run_refine_conversation_task`**

After the existing `run_conversation_task` function (line 251-277), insert:

```rust
/// Refine variant of `run_conversation_task` — identical except it does NOT
/// delete the conversation when the run finishes. The conversation stays alive
/// for the next turn.
async fn run_refine_conversation_task(
    task: OpenHandsConversationTask,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
) -> Result<(), String> {
    let result = run_conversation_task_inner(&task, &mut cancel_rx).await;
    if result.is_err() {
        let _ = task.client.pause_conversation(&task.conversation_id).await;
    }
    result
}
```

- [x] **Step 2: Add `dispatch_openhands_refine_turn`**

After `run_refine_conversation_task` from Step 1, insert:

```rust
/// Dispatch a refine turn against the OpenHands Agent Server.
///
/// On turn 1 (`conversation_id` is `None`) creates a new conversation seeded
/// with `config.prompt` as the initial message. On turn N (`conversation_id`
/// is `Some`) sends `config.prompt` as a follow-up `SendMessageRequest` event
/// and re-runs the existing conversation. Returns the conversation_id that
/// the caller must persist for subsequent turns.
///
/// The conversation is NOT deleted when the run completes. The caller owns
/// deletion via `close_openhands_refine_session`.
pub async fn dispatch_openhands_refine_turn(
    app: &tauri::AppHandle,
    agent_id: &str,
    config: SidecarConfig,
    conversation_id: Option<String>,
    transcript_log_dir: Option<&str>,
) -> Result<String, String> {
    let _ = create_openhands_persistence_dir(agent_id, &config, transcript_log_dir)?;
    let request = OpenHandsOneShotRequest::try_from_sidecar_config(&config)?;

    let server = ensure_agent_server(Duration::from_secs(60)).await?;
    let client = OpenHandsServerClient::new(
        server
            .base_url()
            .parse()
            .map_err(|e| format!("Invalid OpenHands Agent Server base URL: {e}"))?,
        Some(server.session_api_key.clone()),
    );

    let config_event = redact_openhands_config_for_log(&config, server.port);
    super::events::handle_sidecar_message(app, agent_id, &config_event.to_string());

    let conversation_id = match conversation_id {
        Some(existing) => {
            let event = serde_json::json!({
                "role": "user",
                "content": [{
                    "type": "text",
                    "text": request.prompt,
                }],
                "run": false,
            });
            client
                .send_event(&existing, event)
                .await
                .map_err(|e| format!("Failed to send refine event to OpenHands conversation: {e}"))?;
            existing
        }
        None => {
            let start_request = StartConversationRequest::from_one_shot(&request);
            let conversation = client
                .create_conversation(&start_request)
                .await
                .map_err(|e| format!("Failed to create OpenHands refine conversation: {e}"))?;
            extract_conversation_id(&conversation)?
        }
    };

    let summary_context = OpenHandsRunSummaryContext::new(&request, &conversation_id);
    let websocket_url = server.websocket_url(&conversation_id);

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    register_cancel(agent_id, cancel_tx)?;

    let app_for_task = app.clone();
    let agent_for_task = agent_id.to_string();
    let conversation_id_clone = conversation_id.clone();
    let session_api_key = server.session_api_key.clone();
    tokio::spawn(async move {
        let task = OpenHandsConversationTask {
            app: app_for_task.clone(),
            agent_id: agent_for_task.clone(),
            client,
            conversation_id: conversation_id_clone,
            websocket_url,
            session_api_key,
            summary_context,
        };
        let result = run_refine_conversation_task(task, cancel_rx).await;
        unregister_cancel(&agent_for_task);
        if let Err(error) = result {
            super::events::handle_sidecar_exit_with_detail(
                &app_for_task,
                &agent_for_task,
                false,
                Some(error),
            );
        }
    });

    Ok(conversation_id)
}
```

- [x] **Step 3: Add `close_openhands_refine_session`**

After `dispatch_openhands_refine_turn` from Step 2, insert:

```rust
/// Best-effort delete of an OpenHands refine conversation.
///
/// Errors are logged and swallowed — the server will eventually GC abandoned
/// conversations, so a transient failure here is not fatal.
pub async fn close_openhands_refine_session(conversation_id: &str) -> Result<(), String> {
    let server = ensure_agent_server(Duration::from_secs(60))
        .await
        .map_err(|e| format!("OpenHands Agent Server not available: {e}"))?;
    let client = OpenHandsServerClient::new(
        server
            .base_url()
            .parse()
            .map_err(|e| format!("Invalid OpenHands Agent Server base URL: {e}"))?,
        Some(server.session_api_key.clone()),
    );
    if let Err(e) = client.delete_conversation(conversation_id).await {
        log::warn!(
            "[close_openhands_refine_session] failed to delete conversation {}: {}",
            conversation_id,
            e
        );
    }
    Ok(())
}
```

- [x] **Step 4: Build and run existing openhands_server tests**

Run: `cargo test --manifest-path app/src-tauri/Cargo.toml agents::openhands_server -- --nocapture`
Expected: existing tests still pass; no new test failures.

- [x] **Step 5: Commit**

```bash
git add app/src-tauri/src/agents/openhands_server/mod.rs
git commit -m "VU-1145: add OpenHands refine turn dispatch and session close

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Update `RefineSession` struct

**Files:**
- Modify: `app/src-tauri/src/commands/refine/mod.rs:91-101`

- [x] **Step 1: Replace the struct**

Replace lines 91-101 of `app/src-tauri/src/commands/refine/mod.rs`:

```rust
pub struct RefineSession {
    pub skill_name: String,
    #[allow(dead_code)]
    pub usage_session_id: String,
    /// Whether the sidecar streaming session has been started.
    /// First `send_refine_message` sends `stream_start`, subsequent sends `stream_message`.
    pub stream_started: bool,
    /// HEAD SHA of the skills repo when the session started.
    /// Used by `finalize_refine_run` to detect whether the agent actually committed.
    pub head_sha_at_start: Option<String>,
}
```

with:

```rust
pub struct RefineSession {
    pub skill_name: String,
    #[allow(dead_code)]
    pub usage_session_id: String,
    /// OpenHands conversation id for this session. `None` until the first
    /// `send_refine_message` creates the conversation; reused for every
    /// subsequent turn so the agent retains full edit history.
    pub conversation_id: Option<String>,
    /// agent_id of the currently running turn, if any. Cleared when the turn
    /// terminates. Needed by `close_refine_session` to cancel a turn that is
    /// still in flight when the user navigates away.
    pub current_agent_id: Option<String>,
    /// HEAD SHA of the skills repo when the session started.
    /// Used by `finalize_refine_run` to detect whether the agent actually committed.
    pub head_sha_at_start: Option<String>,
}
```

- [x] **Step 2: Verify the struct compiles in isolation**

Run: `cargo check --manifest-path app/src-tauri/Cargo.toml 2>&1 | head -50`
Expected: many compile errors in `mod.rs` and `tests.rs` referring to `stream_started` — that is fine, they will be fixed in subsequent tasks. The struct itself must compile.

---

## Task 4: Update `refine-initial.txt` template

**Files:**
- Modify: `agent-sources/prompts/refine-initial.txt`

- [x] **Step 1: Replace the template body**

Overwrite the entire file `agent-sources/prompts/refine-initial.txt` with:

```
We are refining the skill {{skill_name}}. The skill directory is: {{skill_dir}}. The context directory is: {{context_dir}}. The workspace directory is: {{workspace_dir}}. The user context file is at: {{workspace_dir}}/user-context.md — read it for purpose, description, and all user context.{{target_files_clause}}

Read SKILL.md and any reference files in the references/ directory to understand the current skill before making any changes.

If the user's message contains eval failure feedback (lines matching "eval `{eval_name}`: {/path/to/grading.json}"), read each grading file, triage failures as genuine skill gaps vs assertion design issues, and summarize your findings in plain text. Do not make changes until the user confirms which gaps to address.

CONSTRAINT: You can only refine or validate the existing skill. Do NOT create new skills.

Current request: {{user_message}}
```

- [x] **Step 2: Confirm `{{command}}` is gone**

Run: `grep -F '{{command}}' agent-sources/prompts/refine-initial.txt`
Expected: no output (the variable was unified into `{{user_message}}`).

---

## Task 5: Strip Claude Code artifacts from `protocol.rs`

**Files:**
- Modify: `app/src-tauri/src/commands/refine/protocol.rs`

- [x] **Step 1: Replace the file contents**

Overwrite `app/src-tauri/src/commands/refine/protocol.rs` with:

```rust
use std::path::Path;

use crate::skill_paths::resolve_skill_dir;
use crate::skill_paths::DEFAULT_PLUGIN_SLUG;

pub(super) fn new_refine_usage_session_id(skill_name: &str) -> String {
    format!("synthetic:refine:{}:{}", skill_name, uuid::Uuid::new_v4())
}

pub(super) fn ensure_skill_workspace_dir(
    workspace_path: &str,
    plugin_slug: &str,
    skill_name: &str,
) {
    // Workspace is plugin-organised: workspace_path/{plugin_slug}/skill_name/
    let skill_workspace_dir =
        crate::skill_paths::workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    if !skill_workspace_dir.exists() {
        if let Err(e) = std::fs::create_dir_all(&skill_workspace_dir) {
            log::warn!(
                "[ensure_skill_workspace_dir] failed to create skill workspace dir '{}': {}",
                skill_workspace_dir.display(),
                e
            );
        } else {
            log::debug!(
                "[ensure_skill_workspace_dir] created skill workspace dir '{}'",
                skill_workspace_dir.display()
            );
        }
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn build_followup_prompt(
    user_message: &str,
    skills_path: &str,
    skill_name: &str,
    target_files: Option<&[String]>,
) -> String {
    build_followup_prompt_for_plugin(
        user_message,
        skills_path,
        DEFAULT_PLUGIN_SLUG,
        skill_name,
        target_files,
    )
}

pub(super) fn build_followup_prompt_for_plugin(
    user_message: &str,
    skills_path: &str,
    plugin_slug: &str,
    skill_name: &str,
    target_files: Option<&[String]>,
) -> String {
    let skill_dir = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
    build_followup_prompt_with_output_dir(user_message, &skill_dir, target_files)
}

const REFINE_PROMPT_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/refine-initial.txt"
));

const REFINE_FOLLOWUP_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/refine-followup.txt"
));

pub(super) fn build_refine_prompt_with_output_dir(
    skill_name: &str,
    workspace_path: &str,
    plugin_slug: &str,
    skill_output_dir: &std::path::Path,
    user_message: &str,
    target_files: Option<&[String]>,
) -> String {
    let workspace_dir =
        crate::skill_paths::workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let skill_output_str = skill_output_dir.to_string_lossy().replace('\\', "/");
    let context_str = format!("{}/context", workspace_str);

    let target_files_clause = match target_files {
        Some(files) if !files.is_empty() => format!(
            "\n\nIMPORTANT: Only edit these files (relative to skill output directory): {}. Do not modify any other files.",
            files.join(", ")
        ),
        _ => String::new(),
    };

    REFINE_PROMPT_TEMPLATE
        .replace("{{skill_name}}", skill_name)
        .replace("{{skill_dir}}", &skill_output_str)
        .replace("{{context_dir}}", &context_str)
        .replace("{{workspace_dir}}", &workspace_str)
        .replace("{{target_files_clause}}", &target_files_clause)
        .replace("{{user_message}}", user_message)
}

pub(super) fn build_followup_prompt_with_output_dir(
    user_message: &str,
    skill_output_dir: &std::path::Path,
    target_files: Option<&[String]>,
) -> String {
    let target_files_clause = match target_files {
        Some(files) if !files.is_empty() => {
            let skill_dir_str = skill_output_dir.to_string_lossy().replace('\\', "/");
            let abs_files: Vec<String> = files
                .iter()
                .map(|f| format!("{}/{}", skill_dir_str, f))
                .collect();
            format!(
                "IMPORTANT: Only edit these files: {}. Do not modify any other files.\n\n",
                abs_files.join(", ")
            )
        }
        _ => String::new(),
    };
    REFINE_FOLLOWUP_TEMPLATE
        .trim_end_matches('\n')
        .replace("{{target_files_clause}}", &target_files_clause)
        .replace("{{user_message}}", user_message)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn build_refine_prompt(
    skill_name: &str,
    workspace_path: &str,
    skills_path: &str,
    user_message: &str,
    target_files: Option<&[String]>,
) -> String {
    build_refine_prompt_for_plugin(
        skill_name,
        workspace_path,
        skills_path,
        DEFAULT_PLUGIN_SLUG,
        user_message,
        target_files,
    )
}

pub(super) fn build_refine_prompt_for_plugin(
    skill_name: &str,
    workspace_path: &str,
    skills_path: &str,
    plugin_slug: &str,
    user_message: &str,
    target_files: Option<&[String]>,
) -> String {
    let skill_output_dir = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
    build_refine_prompt_with_output_dir(
        skill_name,
        workspace_path,
        plugin_slug,
        &skill_output_dir,
        user_message,
        target_files,
    )
}
```

- [x] **Step 2: Verify build**

Run: `cargo check --manifest-path app/src-tauri/Cargo.toml -p skill-builder 2>&1 | grep -E "error\[" | head -20`
Expected: errors only in `commands/refine/mod.rs` and `commands/refine/tests.rs` (referencing the removed Claude Code symbols and `stream_started`). Errors will be cleared by Tasks 6–8.

---

## Task 6: Rewrite `send_refine_message`

**Files:**
- Modify: `app/src-tauri/src/commands/refine/mod.rs:212-281` (the `send_refine_message` function and the `OPENHANDS_REFINE_UNSUPPORTED_MESSAGE` / `openhands_refine_streaming_unsupported` helpers above it)

- [x] **Step 1: Remove the unsupported stub constants**

Delete lines 19-23 of `app/src-tauri/src/commands/refine/mod.rs`:

```rust
const OPENHANDS_REFINE_UNSUPPORTED_MESSAGE: &str = "OpenHands refine streaming is not yet supported. Use workflow mode until the OpenHands AskUserQuestion tool is implemented.";

fn openhands_refine_streaming_unsupported() -> bool {
    true
}
```

- [x] **Step 2: Update imports + add `SKILL_CREATOR_USER_SUFFIX`**

Replace the existing imports at the top of `mod.rs` (lines 7-17):

```rust
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use crate::agents::sidecar_pool::SidecarPool;
use crate::commands::imported_skills::validate_skill_name;
use crate::db::{self, Db};
use crate::skill_paths::{resolve_skill_dir, DEFAULT_PLUGIN_SLUG};
use crate::types::RefineSessionInfo;

use protocol::*;
```

with:

```rust
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use crate::agents::sidecar::{build_openhands_one_shot_config, OpenHandsOneShotConfigParams};
use crate::commands::imported_skills::validate_skill_name;
use crate::db::{self, Db};
use crate::skill_paths::{resolve_skill_dir, DEFAULT_PLUGIN_SLUG};
use crate::types::RefineSessionInfo;

use protocol::*;

const SKILL_CREATOR_USER_SUFFIX: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/skill-creator-user-suffix.txt"
));
```

This duplicates the constant from `commands/workflow/runtime.rs` and `commands/skill/scope_review.rs` — matching the existing convention.

- [x] **Step 3: Replace `send_refine_message`**

Replace lines 212-281 (the whole `send_refine_message` function) with:

```rust
// ─── send_refine_message ─────────────────────────────────────────────────────

/// Send a user message to the refine agent and stream responses back.
///
/// Turn 1 (session has no conversation_id): writes user-context.md, creates a
/// new OpenHands conversation seeded with the full refine prompt, runs it,
/// and stores the conversation_id on the session.
///
/// Turn N (session has a conversation_id): appends the user message as a
/// follow-up event and re-runs the existing conversation.
///
/// Returns the `agent_id` so the frontend can listen for `agent-message` and
/// `agent-exit` events scoped to this turn.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn send_refine_message(
    session_id: String,
    user_message: String,
    plugin_slug: String,
    workspace_path: String,
    target_files: Option<Vec<String>>,
    sessions: tauri::State<'_, RefineSessionManager>,
    db: tauri::State<'_, Db>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let _ = (workspace_path, plugin_slug);

    let (skill_name, conversation_id) = {
        let map = sessions.0.lock().map_err(|e| {
            log::error!("[send_refine_message] failed to acquire session lock: {}", e);
            e.to_string()
        })?;
        let session = map.get(&session_id).ok_or_else(|| {
            let active: Vec<String> = map.values().map(|s| s.skill_name.clone()).collect();
            let msg = format!(
                "No refine session found. Active sessions ({}): [{}]",
                map.len(),
                active.join(", ")
            );
            log::error!("[send_refine_message] {}", msg);
            msg
        })?;
        (session.skill_name.clone(), session.conversation_id.clone())
    };

    log::info!(
        "[send_refine_message] skill={} conversation_present={}",
        skill_name,
        conversation_id.is_some()
    );

    let runtime_ctx = crate::commands::workflow::read_initialized_runtime_context(&db)?;
    let resolved_plugin_slug = resolve_skill_plugin_slug(&db, &skill_name)?;
    let skills_path = resolve_skills_path(&db)?;
    let skill_output_dir =
        resolve_skill_dir(Path::new(&skills_path), &resolved_plugin_slug, &skill_name);

    ensure_skill_workspace_dir(&runtime_ctx.workspace_path, &resolved_plugin_slug, &skill_name);

    if conversation_id.is_none() {
        write_refine_user_context(
            &db,
            &runtime_ctx.workspace_path,
            &resolved_plugin_slug,
            &skill_name,
            &skill_output_dir,
        )?;
    }

    let target_files_slice = target_files.as_deref();
    let prompt = if conversation_id.is_some() {
        build_followup_prompt_with_output_dir(&user_message, &skill_output_dir, target_files_slice)
    } else {
        build_refine_prompt_with_output_dir(
            &skill_name,
            &runtime_ctx.workspace_path,
            &resolved_plugin_slug,
            &skill_output_dir,
            &user_message,
            target_files_slice,
        )
    };

    let workspace_skill_dir_str = crate::skill_paths::workspace_skill_dir(
        Path::new(&runtime_ctx.workspace_path),
        &resolved_plugin_slug,
        &skill_name,
    )
    .to_string_lossy()
    .replace('\\', "/");

    let mut config = build_openhands_one_shot_config(OpenHandsOneShotConfigParams {
        prompt,
        llm: runtime_ctx.llm.clone(),
        workspace_root_dir: runtime_ctx.workspace_path.replace('\\', "/"),
        workspace_run_dir: workspace_skill_dir_str.clone(),
        agent_name: "skill-creator".to_string(),
        task_kind: Some("refine".to_string()),
        user_message_suffix: Some(SKILL_CREATOR_USER_SUFFIX.trim().to_string()),
        allowed_tools: vec!["file_editor".to_string(), "terminal".to_string()],
        max_turns: 500,
        output_format: None,
        skill_name: Some(skill_name.clone()),
        step_id: Some(-10),
        run_source: Some("refine".to_string()),
        plugin_slug: resolved_plugin_slug.clone(),
    });
    config.transcript_log_dir = Some(format!("{workspace_skill_dir_str}/logs"));

    let agent_id = format!(
        "refine-{}-{}",
        skill_name,
        chrono::Utc::now().timestamp_millis()
    );
    let log_dir = format!("{workspace_skill_dir_str}/logs");

    let returned_conversation_id = crate::agents::openhands_server::dispatch_openhands_refine_turn(
        &app,
        &agent_id,
        config,
        conversation_id,
        Some(&log_dir),
    )
    .await?;

    {
        let mut map = sessions.0.lock().map_err(|e| e.to_string())?;
        if let Some(session) = map.get_mut(&session_id) {
            session.conversation_id = Some(returned_conversation_id);
            session.current_agent_id = Some(agent_id.clone());
        }
    }

    Ok(agent_id)
}

/// Reproduce the user-context bundle that `load_refine_runtime_settings`
/// previously assembled. Reads workflow run row, SKILL.md frontmatter, and
/// settings, then writes `{workspace}/{plugin}/{skill}/user-context.md`.
fn write_refine_user_context(
    db: &Db,
    workspace_path: &str,
    plugin_slug: &str,
    skill_name: &str,
    skill_output_dir: &Path,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = db::read_settings(&conn)?;
    let settings_author = settings
        .github_user_email
        .clone()
        .or(settings.github_user_login.clone());
    let run_row = db::get_workflow_run(&conn, skill_name).ok().flatten();
    let intake_json = run_row.as_ref().and_then(|r| r.intake_json.clone());
    let frontmatter = std::fs::read_to_string(skill_output_dir.join("SKILL.md"))
        .ok()
        .map(|content| crate::commands::imported_skills::parse_frontmatter_full(&content))
        .unwrap_or_default();
    let is_imported = run_row.is_none();
    let purpose = if is_imported {
        frontmatter.description.clone()
    } else {
        run_row.as_ref().map(|r| r.purpose.clone())
    };
    let author_for_context = if is_imported {
        frontmatter.author.clone()
    } else {
        frontmatter
            .author
            .or_else(|| run_row.as_ref().and_then(|r| r.author_login.clone()))
            .or(settings_author)
    };

    drop(conn);

    crate::commands::workflow::write_user_context_file(
        workspace_path,
        plugin_slug,
        skill_name,
        &[],
        author_for_context.as_deref(),
        settings.industry.as_deref(),
        settings.function_role.as_deref(),
        intake_json.as_deref(),
        None,
        purpose.as_deref(),
        frontmatter.version.as_deref(),
        None,
        None,
        None,
        None,
        &[],
    );
    Ok(())
}
```

- [x] **Step 4: Verify build**

Run: `cargo check --manifest-path app/src-tauri/Cargo.toml 2>&1 | grep -E "error\[" | head -10`
Expected: remaining errors are in `start_refine_session`, `close_refine_session`, `cancel_refine_turn`, `answer_refine_question`, and `tests.rs` — all fixed by Tasks 7–9.

---

## Task 7: Rewrite `start_refine_session`, `close_refine_session`, `cancel_refine_turn`

**Files:**
- Modify: `app/src-tauri/src/commands/refine/mod.rs`

- [x] **Step 1: Replace `start_refine_session`**

Replace lines 117-210 (the entire `start_refine_session` function plus the `discover_plugin_agents` helper above it AND the `REFINE_ALLOWED_PLUGINS` constant) with:

```rust
// ─── start_refine_session ────────────────────────────────────────────────────

/// Initialize a refine session for a skill.
///
/// No OpenHands conversation is created here — the conversation is created on
/// the first `send_refine_message` and reused for every subsequent turn.
#[tauri::command]
pub async fn start_refine_session(
    skill_name: String,
    plugin_slug: String,
    workspace_path: String,
    sessions: tauri::State<'_, RefineSessionManager>,
    db: tauri::State<'_, Db>,
) -> Result<RefineSessionInfo, String> {
    let _ = workspace_path;
    log::info!(
        "[start_refine_session] skill={} plugin={}",
        skill_name,
        plugin_slug
    );
    validate_skill_name(&skill_name)?;

    let skills_path = resolve_skills_path(&db).map_err(|e| {
        log::error!("[start_refine_session] failed to resolve skills path: {}", e);
        e
    })?;

    let skill_md = resolve_skill_output_dir(&db, &skill_name, &skills_path)?.join("SKILL.md");
    if !skill_md.exists() {
        let msg = format!("SKILL.md not found at {}", skill_md.display());
        log::error!("[start_refine_session] {}", msg);
        return Err(msg);
    }

    let mut map = sessions.0.lock().map_err(|e| {
        log::error!("[start_refine_session] failed to acquire session lock: {}", e);
        e.to_string()
    })?;

    if let Some(stale_id) = map
        .iter()
        .find(|(_, s)| s.skill_name == skill_name)
        .map(|(id, _)| id.clone())
    {
        log::info!(
            "[start_refine_session] removing stale session for skill '{}' before restart",
            skill_name
        );
        map.remove(&stale_id);
    }

    let session_id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    log::debug!(
        "[start_refine_session] creating session [REDACTED] for skill '{}'",
        skill_name
    );

    let head_sha_at_start = git2::Repository::open(Path::new(&skills_path))
        .ok()
        .and_then(|repo| {
            let head = repo.head().ok()?;
            let commit = head.peel_to_commit().ok()?;
            Some(commit.id().to_string())
        });

    map.insert(
        session_id.clone(),
        RefineSession {
            skill_name: skill_name.clone(),
            usage_session_id: new_refine_usage_session_id(&skill_name),
            conversation_id: None,
            current_agent_id: None,
            head_sha_at_start,
        },
    );

    Ok(RefineSessionInfo {
        session_id,
        skill_name,
        created_at,
        available_agents: vec!["skill-creator".to_string()],
    })
}
```

- [x] **Step 2: Replace `close_refine_session`**

Replace the existing `close_refine_session` function (lines 283-331 in the original — find it by searching for `pub async fn close_refine_session`) with:

```rust
// ─── close_refine_session ────────────────────────────────────────────────────

/// Close a refine session: cancel any in-flight turn, then DELETE the
/// OpenHands conversation, then remove the session from the manager.
#[tauri::command]
pub async fn close_refine_session(
    session_id: String,
    sessions: tauri::State<'_, RefineSessionManager>,
) -> Result<(), String> {
    log::info!("[close_refine_session] session=[REDACTED]");

    let removed = {
        let mut map = sessions.0.lock().map_err(|e| {
            log::error!("[close_refine_session] failed to acquire session lock: {}", e);
            e.to_string()
        })?;
        map.remove(&session_id)
    };

    let Some(session) = removed else {
        log::debug!("[close_refine_session] session [REDACTED] not found (already closed)");
        return Ok(());
    };

    if let Some(agent_id) = session.current_agent_id.as_ref() {
        let cancelled = crate::agents::openhands_server::cancel_openhands_one_shot(agent_id);
        log::debug!(
            "[close_refine_session] cancel_openhands_one_shot agent={} result={}",
            agent_id,
            cancelled
        );
    }

    if let Some(conversation_id) = session.conversation_id.as_ref() {
        log::info!(
            "[close_refine_session] deleting conversation_id={}",
            conversation_id
        );
        if let Err(e) =
            crate::agents::openhands_server::close_openhands_refine_session(conversation_id).await
        {
            log::warn!(
                "[close_refine_session] non-fatal: delete conversation failed: {}",
                e
            );
        }
    }

    Ok(())
}
```

- [x] **Step 3: Replace `cancel_refine_turn`**

Replace the existing `cancel_refine_turn` function with:

```rust
// ─── cancel_refine_turn ──────────────────────────────────────────────────────

/// Cancel the in-flight refine turn (if any). The session and conversation
/// stay alive — the next `send_refine_message` resumes on the same conversation.
#[tauri::command]
pub async fn cancel_refine_turn(
    session_id: String,
    sessions: tauri::State<'_, RefineSessionManager>,
) -> Result<(), String> {
    let agent_id = {
        let map = sessions.0.lock().map_err(|e| e.to_string())?;
        let session = map
            .get(&session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;
        session.current_agent_id.clone()
    };

    let Some(agent_id) = agent_id else {
        log::debug!("[cancel_refine_turn] no active turn — noop");
        return Ok(());
    };

    log::info!("[cancel_refine_turn] cancelling agent_id={}", agent_id);
    let cancelled = crate::agents::openhands_server::cancel_openhands_one_shot(&agent_id);
    if !cancelled {
        log::warn!(
            "[cancel_refine_turn] no cancel handle registered for agent_id={}",
            agent_id
        );
    }
    Ok(())
}
```

- [x] **Step 4: Verify build**

Run: `cargo check --manifest-path app/src-tauri/Cargo.toml 2>&1 | grep -E "error\[" | head -10`
Expected: remaining errors are in `answer_refine_question` and `tests.rs`.

---

## Task 8: Remove `answer_refine_question`

**Files:**
- Modify: `app/src-tauri/src/commands/refine/mod.rs` (delete the function)
- Modify: `app/src-tauri/src/lib.rs:395`

- [x] **Step 1: Delete `answer_refine_question`**

Delete the entire `pub async fn answer_refine_question(...)` function (lines 391-442 in the original `mod.rs`).

- [x] **Step 2: Remove from command registration**

Edit `app/src-tauri/src/lib.rs` and delete the line:

```rust
            commands::refine::answer_refine_question,
```

- [x] **Step 3: Verify cargo build**

Run: `cargo check --manifest-path app/src-tauri/Cargo.toml 2>&1 | grep -E "error\[" | head -10`
Expected: only test errors remain.

- [x] **Step 4: Commit progress**

```bash
git add app/src-tauri/src/commands/refine/mod.rs app/src-tauri/src/commands/refine/protocol.rs app/src-tauri/src/lib.rs agent-sources/prompts/refine-initial.txt
git commit -m "VU-1145: rewrite refine commands for OpenHands multi-turn

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Update test suite

**Files:**
- Modify: `app/src-tauri/src/commands/refine/tests.rs`

- [x] **Step 1: Remove stale Claude Code config tests**

Delete the following test functions from `app/src-tauri/src/commands/refine/tests.rs` (search by name):

```
test_refine_streaming_is_explicitly_unsupported_for_openhands_migration
test_refine_config_has_no_agent
test_refine_config_includes_task_tool_for_streaming_edits
test_refine_config_includes_all_file_tools
test_refine_config_cwd_points_to_workspace_root
test_refine_config_no_conversation_history
test_refine_config_agent_id_format
test_refine_config_sets_model_directly
test_refine_config_uses_stream_max_turns
test_refine_config_extended_thinking_sets_budget
test_refine_config_no_thinking_when_disabled
test_refine_config_output_format_is_intentionally_unset_for_chat_flow
test_refine_config_serialization_matches_sidecar_schema
test_refine_config_includes_persistence_identity_for_run_summary
test_refine_config_requires_skill_creator_plugin
test_refine_config_serialization_omits_none_fields
test_session_stream_started_defaults_to_false
test_session_stream_started_can_be_set
test_completed_turn_does_not_close_or_reset_stream_started_session
test_refine_prompt_includes_routing
```

Also delete the helper `base_refine_config(...)` and the `test_workspace_path()` function — they are no longer used.

- [x] **Step 2: Update session struct initializers**

In `tests.rs`, find every `RefineSession {` literal (there are four in the original file) and replace `stream_started: false,` (or `stream_started: true,`) with both:

```rust
            conversation_id: None,
            current_agent_id: None,
```

The four call sites are inside `test_session_create_and_lookup`, `test_session_conflict_detection`, `test_close_session_removes_entry`, and `test_skill_name_validation_rejects_traversal` was unrelated — only update the three with `RefineSession {` literals.

- [x] **Step 3: Update `test_refine_prompt_includes_metadata`**

Find `test_refine_prompt_includes_metadata` and replace the `assert!(system_prompt.contains("We are writing the skill my-skill"));` line with:

```rust
    assert!(system_prompt.contains("We are refining the skill my-skill"));
```

- [x] **Step 4: Add new tests at the bottom of the file**

Append to `app/src-tauri/src/commands/refine/tests.rs`:

```rust
// ===== OpenHands refine tests =====

#[test]
fn test_refine_session_holds_conversation_and_agent_ids() {
    let session = RefineSession {
        skill_name: "my-skill".to_string(),
        usage_session_id: "usage-1".to_string(),
        conversation_id: Some("conv-123".to_string()),
        current_agent_id: Some("agent-456".to_string()),
        head_sha_at_start: None,
    };
    assert_eq!(session.conversation_id.as_deref(), Some("conv-123"));
    assert_eq!(session.current_agent_id.as_deref(), Some("agent-456"));
}

#[test]
fn test_refine_initial_prompt_has_no_claude_code_routing() {
    let prompt = build_refine_prompt("my-skill", "/ws", "/sk", "edit", None);
    assert!(
        !prompt.contains("AskUserQuestion"),
        "OpenHands prompt must not reference AskUserQuestion: {}",
        prompt
    );
    assert!(
        !prompt.contains("rewrite-skill"),
        "OpenHands prompt must not direct to skill-creator:rewrite-skill agent: {}",
        prompt
    );
    assert!(
        !prompt.contains("via the Agent tool"),
        "OpenHands prompt must not reference the Agent tool: {}",
        prompt
    );
}

#[test]
fn test_refine_initial_prompt_includes_eval_feedback_guidance() {
    let prompt = build_refine_prompt("my-skill", "/ws", "/sk", "edit", None);
    assert!(
        prompt.contains("eval failure feedback"),
        "OpenHands prompt should describe how to handle eval feedback: {}",
        prompt
    );
    assert!(
        prompt.contains("plain text"),
        "OpenHands prompt should instruct plain-text response (no tool interrupt): {}",
        prompt
    );
}
```

- [x] **Step 5: Run the test suite**

Run: `cargo test --manifest-path app/src-tauri/Cargo.toml commands::refine -- --nocapture`
Expected: all refine tests pass.

- [x] **Step 6: Run clippy**

Run: `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`
Expected: no warnings.

- [x] **Step 7: Commit**

```bash
git add app/src-tauri/src/commands/refine/tests.rs
git commit -m "VU-1145: replace Claude Code refine tests with OpenHands suite

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Frontend — remove `answerRefineQuestion`, rename `sendStreamingRefineMessage`

**Files:**
- Modify: `app/src/lib/tauri-command-types.ts:358-367`
- Modify: `app/src/lib/tauri.ts:467-510`
- Modify: `app/src/components/workspace/workspace-refine.tsx`

- [x] **Step 1: Remove `answer_refine_question` command type**

In `app/src/lib/tauri-command-types.ts`, delete the entry:

```ts
  answer_refine_question: {
    args: {
      sessionId: string;
      agentId: string;
      toolUseId: string;
      questions: unknown;
      answers: Record<string, unknown>;
    };
    result: void;
  };
```

- [x] **Step 2: Update `tauri.ts`**

In `app/src/lib/tauri.ts`, delete the entire `answerStreamingRefineQuestion` export (the multi-line `export const answerStreamingRefineQuestion = ...`).

Then rename `sendStreamingRefineMessage` to `sendRefineMessage`. The line should change from:

```ts
export const sendStreamingRefineMessage = (
```

to:

```ts
export const sendRefineMessage = (
```

- [x] **Step 3: Update `workspace-refine.tsx` imports**

In `app/src/components/workspace/workspace-refine.tsx`, change the import block:

```ts
import {
  getSkillContentForRefine,
  startRefineSession,
  sendStreamingRefineMessage,
  answerStreamingRefineQuestion,
  cancelRefineTurn,
  closeRefineSession,
  finalizeRefineRun,
  cleanBenchmarkSnapshot,
  cleanupSkillSidecar,
  acquireLock,
  releaseLock,
} from "@/lib/tauri";
```

to:

```ts
import {
  getSkillContentForRefine,
  startRefineSession,
  sendRefineMessage,
  cancelRefineTurn,
  closeRefineSession,
  finalizeRefineRun,
  cleanBenchmarkSnapshot,
  acquireLock,
  releaseLock,
} from "@/lib/tauri";
```

Also remove the `requireSettingsModel` import line:

```ts
import { requireSettingsModel } from "@/lib/models";
```

- [x] **Step 4: Simplify `releaseSkillResources`**

Replace the existing `releaseSkillResources` helper:

```ts
function releaseSkillResources(skillName: string, reason: string): void {
  releaseLock(skillName).catch((e) =>
    console.warn("[workspace-refine] non-fatal: op=releaseLock err=%s", e),
  );
  console.log("[workspace-refine] releaseLock: %s (%s)", skillName, reason);
  cleanupSkillSidecar(skillName).catch((e) =>
    console.warn(
      "[workspace-refine] non-fatal: op=cleanupSkillSidecar err=%s",
      e,
    ),
  );
}
```

with:

```ts
function releaseSkillResources(skillName: string, reason: string): void {
  releaseLock(skillName).catch((e) =>
    console.warn("[workspace-refine] non-fatal: op=releaseLock err=%s", e),
  );
  console.log("[workspace-refine] releaseLock: %s (%s)", skillName, reason);
}
```

- [x] **Step 5: Update `handleSend` to remove the model guard and use `sendRefineMessage`**

Inside `handleSend`, remove this block:

```ts
      let model: string;
      try {
        model = requireSettingsModel(selectedModel);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err), {
          duration: Infinity,
        });
        return;
      }
```

Then change the `useAgentStore.getState().registerRun(agentId, model, ...)` call to use `selectedModel ?? "openhands"` (since the backend now owns model validation):

```ts
        useAgentStore
          .getState()
          .registerRun(
            agentId,
            selectedModel ?? "openhands",
            selectedSkill.name,
            "refine",
            `synthetic:refine:${selectedSkill.name}:${sessionId}`,
          );
```

And rename the call:

```ts
        const agentId = await sendStreamingRefineMessage(
```

to:

```ts
        const agentId = await sendRefineMessage(
```

- [x] **Step 6: Remove `handleQuestionSubmit` and its call site**

Delete the entire `handleQuestionSubmit` callback (the `useCallback` block from `const handleQuestionSubmit = useCallback(...)` through the closing `}, [selectedSkill, workspacePath]);`).

Then in the JSX, remove the `onQuestionSubmit={handleQuestionSubmit}` prop from `<ChatPanel>`.

- [x] **Step 7: Update `ChatPanel` interface**

If `ChatPanel` requires `onQuestionSubmit` as a prop, open `app/src/components/refine/chat-panel.tsx` and make the prop optional or remove it. Inspect the file first:

```bash
grep -n "onQuestionSubmit\|RefineQuestionResponse" app/src/components/refine/chat-panel.tsx
```

If the prop is required, change the interface to drop it. If `RefineQuestionResponse` has no other consumers, leave it for now — type-only references are not runtime-breaking.

- [x] **Step 8: Remove unused `RefineQuestionResponse` and `RefineMessage` imports**

If `workspace-refine.tsx` no longer uses these types, drop them from the import:

```ts
import type { RefineMessage, SkillFile } from "@/stores/refine-store";
```

becomes:

```ts
import type { SkillFile } from "@/stores/refine-store";
```

Also drop:

```ts
import type { RefineQuestionResponse } from "@/stores/refine-store";
```

- [x] **Step 9: Run TypeScript check**

Run: `cd app && npx tsc --noEmit 2>&1 | head -30`
Expected: no errors. If errors mention `RefineQuestionResponse` or `cleanupSkillSidecar` from other files, leave those references in place (they may still be valid for other surfaces).

- [x] **Step 10: Run unit tests**

Run: `cd app && npm run test:unit 2>&1 | tail -30`
Expected: all tests pass.

- [x] **Step 11: Commit**

```bash
git add app/src/lib/tauri-command-types.ts app/src/lib/tauri.ts app/src/components/workspace/workspace-refine.tsx app/src/components/refine/chat-panel.tsx
git commit -m "VU-1145: wire refine UI to OpenHands send_refine_message

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 11: Final validation

**Files:** none (verification only).

- [x] **Step 1: Cargo build**

Run: `cargo build --manifest-path app/src-tauri/Cargo.toml`
Expected: clean build.

- [x] **Step 2: Cargo test (refine + openhands_server)**

Run: `cargo test --manifest-path app/src-tauri/Cargo.toml -- commands::refine agents::openhands_server`
Expected: all pass.

- [x] **Step 3: Cargo clippy**

Run: `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`
Expected: clean.

- [x] **Step 4: TypeScript**

Run: `cd app && npx tsc --noEmit`
Expected: clean.

- [x] **Step 5: Frontend unit tests**

Run: `cd app && npm run test:unit`
Expected: all pass.

- [x] **Step 6: Repo-map audit**

This change does not add or remove files in the directories tracked by `repo-map.json` (the file structure under `commands/refine/` and `agents/openhands_server/` is unchanged — only function-level edits). No `repo-map.json` update needed.

- [x] **Step 7: Manual smoke test — turn 1 (creates conversation)**

Run: `cd app && MOCK_AGENTS=true npm run dev` (or run with a real OpenHands Agent Server if configured).

In the running app:
1. Open an existing skill
2. Switch to the Refine tab
3. Send a message — observe the `agent-message` events flow through the chat
4. Confirm the conversation completes with a `conversation_state` terminal event

- [x] **Step 8: Manual smoke test — turn N (reuses conversation)**

Continuing in the same session:
1. Send a second user message
2. Confirm the agent retains context (e.g. references the previous edit)
3. Inspect logs for `[send_refine_message] ... conversation_present=true`

- [x] **Step 9: Manual smoke test — cancel and close**

1. Send a long-running message
2. Click the cancel button — confirm the chat shows the run as cancelled (status=`cancelled`)
3. Send another message — confirm it succeeds on the same conversation
4. Navigate away from the Refine tab — confirm logs show `[close_refine_session] deleting conversation_id=...`

---

## Self-Review Checklist

Run before claiming completion:

1. **Spec coverage** — every section of `docs/design/refine-openhands-migration/README.md` is addressed:
   - Multi-turn lifecycle → Tasks 2, 6
   - Cancel/close mechanics → Tasks 2, 7
   - `dispatch_openhands_refine_turn` + `close_openhands_refine_session` → Task 2
   - `RefineSession` field changes → Task 3
   - Config Building → Task 6
   - Initial Message Format (refine-initial.txt) → Task 4
   - Turn N Message Format → covered by `build_followup_prompt_with_output_dir` (kept in Task 5)
   - `protocol.rs` cleanup → Task 5
   - Commands Changed → Tasks 6, 7, 8
   - Frontend Changes → Task 10
   - Test Suite Changes → Task 9
   - Bug Fix: Cancel Path → already committed (events.rs + mod.rs PauseEvent + cancel_pending fix)

2. **No placeholders** — every step has exact code or commands.

3. **Type consistency** — `RefineSession` field names (`conversation_id`, `current_agent_id`, `head_sha_at_start`) are identical across Task 3 (struct), Tasks 6/7 (commands), and Task 9 (tests). `dispatch_openhands_refine_turn` signature matches across Tasks 2 and 6.

---

## Task 12: OpenHands → DisplayItem display projection (lossless, product-wide)

**Spec:** `docs/design/openhands-event-display-projection/README.md`

This task is product-wide, not refine-specific. The projection runs for every OpenHands run; every UI surface (Refine, Workflow output, feedback dialog, status header) switches to consume the projected `displayItems`. Refine is the surface where the rendering gap surfaced, but the fix lands across all consumers.

**Core invariant:** No `conversation_event` is dropped. Every event lands in `run.conversationEvents` (raw audit trail) AND every event is projected into one or more `DisplayItem` mutations on `run.displayItems`. The projection only decides **visual weight**, never filters. All UI surfaces (refine chat AND workflow output panel) read `displayItems` exclusively.

**Files:**
- Create: `app/src/lib/openhands-event-projection.ts`
- Create: `app/src/lib/openhands-result-summary.ts`
- Modify: `app/src/stores/agent-store.ts`
- Modify: `app/src/components/refine/agent-turn-inline.tsx`
- Modify: `app/src/components/agent-output-panel.tsx`
- Modify: `app/src/components/agent-status-header.tsx`
- Modify: refine chat header (lifecycle chip placement)
- Test: `app/src/__tests__/lib/openhands-event-projection.test.ts`
- Test: `app/src/__tests__/lib/openhands-result-summary.test.ts`

### Subtasks

- [x] **12.1: Result-summary detectors** in `lib/openhands-result-summary.ts`. Pure tier-1 → tier-5 detector chain producing a one-line summary string from `result_text` / `structured_output`. Tier 1 detects `{status:"research_complete", dimensions_selected, question_count}` → "Research complete: N dimensions, M questions". Tier 2 detects answer-evaluator `{verdict, answered_count, total_count}` → "Answers {verdict}: N/M". Tier 3 detects skill-generation success markers → "Skill generated" / "Skill updated". Tier 4: first non-empty line of `result_text` capped at 80 chars. Tier 5: generic "Run completed". Unit-tested in isolation.

- [x] **12.2: Event projection module** in `lib/openhands-event-projection.ts`. Pure function `projectConversationEvent(event, pendingActions) → { add: DisplayItem[]; update: { id, patch }[]; pendingDelta: ... }`. Implements the lossless per-event-class table from the design spec:
  - `MessageEvent` source=user → collapsed `tool_call` shape with `toolName: "task_sent"`
  - `MessageEvent` source=agent (mid-run) → `output` DisplayItem with markdown / parsed-summary
  - `ActionEvent` (file_editor) → pending `tool_call` keyed on `tool_call_id`, label per cmd: `Read file:` / `Create file:` / `Edit file:` / `Insert into`
  - `ActionEvent` (terminal) → pending `tool_call`, label `Ran command: {first 60}` (uses `event.summary` if present)
  - `ActionEvent` (invoke_skill) → pending `subagent` DisplayItem, label `Using skill: {action.name}`
  - `ActionEvent` (think) → pending `thinking` DisplayItem with stable label "Reasoning step" / "Planning checkpoint"
  - `ObservationEvent` → match pending action by `tool_call_id`, mutate to set `toolResult` + `toolStatus` (error if `is_error` or `exit_code != 0`)
  - `SystemPromptEvent` → collapsed `tool_call` `toolName: "system_prompt"` row
  - `Condensation*` → collapsed `tool_call` `toolName: "condensation"` row
  - `ConversationStateUpdateEvent` → collapsed `tool_call` `toolName: "state_update"` row
  - `AgentErrorEvent` / `ConversationErrorEvent` → `error` DisplayItem
  - Unknown `event_class` → collapsed `tool_call` `toolName: "unknown_event"` row with raw payload in `toolResult.content`
  Reuses existing helpers in `lib/openhands-conversation-events.ts` (getMessageText, getToolName, getToolInput, getCommandText, etc.).

- [x] **12.3: Wire projection into `agent-store.ts`**. `addConversationEvent` now (a) appends to `run.conversationEvents` as today (audit trail preserved) AND (b) invokes the projector with the per-agent `pendingActionsByToolCallId` map and applies the returned DisplayItem add/update mutations to `run.displayItems`. `applyConversationState` on terminal status appends a synthesized `result` (or `error`) DisplayItem using the result-summary detector. Add `pendingActionsByToolCallId: Record<string, string /* displayItem.id */>` to the per-run state. Existing `addDisplayItem` continues to work for any non-OpenHands runtime that emits `display_item` directly.

- [x] **12.4: Revert `agent-turn-inline.tsx`** to read `run.displayItems` and render via `DisplayItemList`. Drop the temporary `ConversationEventList` import added in commit `5e2ed3cf`.

- [x] **12.5: Switch `agent-output-panel.tsx`** to read `run.displayItems` exclusively and render via `DisplayItemList`. Remove the dual-branch (`hasConversationEvents`) logic. Workflow now gets the same beautified projected view as refine.

- [x] **12.6: Update `agent-status-header.tsx`** event count to use `displayItems.length` only.

- [x] **12.7: Lifecycle chip** on the refine chat header bound to `runs[agentId]?.status`. Five states (Starting / Running / Completed / Error / Cancelled) with the colors from the design spec (muted / pacific-pulsing / seafoam / destructive / muted).

- [x] **12.8: Unit tests** for the projector and result-summary modules using the JSONL transcripts captured under `~/Library/Application Support/com.vibedata.skill-builder/workspace/skills/measuring-pipeline-value/logs/` and `.../hr-analytics/logs/` as fixtures. Cover: paired action+observation, dangling action (pending state), dangling observation (standalone), error observation auto-expand, parallel actions sharing `llm_response_id` (verify they survive the existing `groupDisplayItems` activity grouping), each lossless filtered class produces its collapsed row.

- [x] **12.9: Verify** via `cd app && npx tsc --noEmit` → `npm run test:unit`. Confirm 688+ frontend tests pass with the new projection tests added.

- [ ] **12.10: Manual smoke** in `npm run dev` from the VU-1155 worktree. Open Refine on a skill, send a message: confirm chat renders the projected `Read file: ...` cards paired with their observations, lifecycle chip flips Starting → Running → Completed, final reply shows as an `OutputItem` with the structured-result summary line. After Task 14 lands, also confirm the per-run logs dir has the SDK's native per-event JSON tree (`{conversation_id}/base_state.json + events/event-NNNNN-*.json`) and that the event count matches the chat. Open the Workflow tab on a different skill, run a step: confirm `agent-output-panel` shows the same beautified rendering (no longer the dense raw timeline).

---

## Task 13: Post-implementation refinements from manual smoke

Two refinements landed after Task 12 was exercised live. Both already implemented and pushed.

- [x] **13.1: Fall back to `kind` discriminator when extracting `event_class`** (commit `fba0db73`).

  OpenHands SDK emits raw events with `kind: "ActionEvent"` (etc.) as the type discriminator, not `event_class`. The Rust normalizer's fallback chain was `event_class → eventClass → type → "event"` literal — every live WebSocket event hit the literal `"event"` fallback and the projection routed through the unknown-event branch (manual-smoke screenshot showed a 13-card "Tool Activity (13 unknown_event)" group). Fix added `kind` to the fallback chain in both:
  - `app/src-tauri/src/agents/openhands_server/events.rs::normalize_server_event` — primary fix
  - `app/src/lib/openhands-conversation-events.ts::normalizeConversationEventMessage` — defensive fallback so any in-flight events that already shipped with `event_class: "event"` but kept inner `event.kind` still recover client-side

  Rust unit test added asserting `{ kind: "ActionEvent" }` normalizes to `event_class: "ActionEvent"`. JSONL fixtures the existing tests use already had `event_class` set (written by the SDK's persisted-conversation-log format, which differs from the WebSocket wire format), so the fixture tests passed even though live runs were broken.

- [x] **13.2: Hide `ConversationStateUpdateEvent` from chat (audit-only)** (commit `8436d248`).

  These events carry pure internal counter/state churn — token deltas, `execution_status` flips, `agent_state` transitions. Rendering each as a "Lifecycle update" card was noise; the lifecycle chip in the chat header already represents the user-facing transitions semantically. The event still lands in `run.conversationEvents` (audit trail preserved); only the projected `DisplayItem` is suppressed. SystemPromptEvent, Condensation*Event, PauseEvent, and user MessageEvent stay visible as collapsed rows because each carries genuine user-facing meaning.

  Files changed: `app/src/lib/openhands-event-projection.ts::projectStateUpdateEvent` returns `{ add: [], update: [], pendingDelta: {} }`; corresponding test in `openhands-event-projection.test.ts` flipped from "produces a state_update DisplayItem" to "hides the event from chat". Design spec updated to match: `docs/design/openhands-event-display-projection/README.md` Key Decisions, Projection Contract, and the per-event-class table all reflect the narrowed editorial rule (every user-facing event becomes a DisplayItem; ConversationStateUpdateEvent is hidden).

---

## Task 14: Pass persistence_dir to the OpenHands SDK so the per-event JSON audit tree lands on disk

**Spec:** new requirement surfaced during VU-1155 manual smoke.

**Symptom:** `~/Library/Application Support/com.vibedata.skill-builder/workspace/skills/{skill}/logs/{agent_id}-{ts}/` is empty for every run after the OpenHands runtime migration. Concrete examples on disk at the time of writing:

- `workspace/skills/pipeline-analysis/logs/pipeline-analysis-research-1777810046880-2026-05-03T20-07-26/` — empty
- `workspace/skills/analyzing-bookings/logs/analyzing-bookings-research-1777810441398-2026-05-03T20-14-01/` — empty
- `workspace/skills/measuring-pipeline-value/logs/refine-measuring-pipeline-value-1777805777627-2026-05-03T18-56-17/` — empty

The hr-analytics May 2 / measuring-pipeline-value May 3 transcripts that fed the VU-1155 fixture tests exist because earlier code paths wrote them. The audit trail for newer runs lives only in memory (`run.conversationEvents`); restarting the app loses it.

**Root cause:** `agents/openhands_server/mod.rs::create_openhands_persistence_dir` creates the directory and `transcript_log_dir` is threaded through `dispatch_openhands_one_shot` and `dispatch_openhands_refine_turn`, but the path is never passed to the OpenHands Agent Server's `create_conversation` request body, so the SDK's conversation-log writer has nowhere to write. The `SidecarConfig.persistence_dir` field exists but isn't plumbed through `OpenHandsOneShotRequest::try_from_sidecar_config` or `StartConversationRequest::from_one_shot`.

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/types.rs` — add a `persistence_dir: Option<String>` (or whatever the SDK calls it) field to `StartConversationRequest`. Plumb through `OpenHandsOneShotRequest::try_from_sidecar_config` from `SidecarConfig.persistence_dir`.
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs` — set `config.persistence_dir = Some(persistence_path.to_string_lossy().into_owned())` in both `dispatch_openhands_one_shot` (around line 87) and `dispatch_openhands_refine_turn` (around line 310), before calling `OpenHandsOneShotRequest::try_from_sidecar_config`.
- Test: serialization test that `StartConversationRequest` includes the persistence path.

### Subtasks

- [ ] **14.1: Inspect the OpenHands Agent Server `create_conversation` API** for the pinned version. Determine the exact field name (`persistence_dir`, `persist_path`, `conversation_log_dir`, etc.) by reading the SDK source or the OpenAPI spec. Document it in the design spec's Wire-Format note.

- [ ] **14.2: Add the field to `StartConversationRequest`** in `types.rs` with the correct serde rename. Default to `None` so any non-OpenHands callers stay compatible.

- [ ] **14.3: Plumb `SidecarConfig.persistence_dir` through `OpenHandsOneShotRequest::try_from_sidecar_config`** so the request body inherits the persistence dir from the sidecar config.

- [ ] **14.4: Set `config.persistence_dir`** in both dispatch entry points immediately after `create_openhands_persistence_dir` returns. The persistence path returned by that helper becomes the value passed to the SDK.

- [ ] **14.5: Serialization test** in `types.rs` (or `mod.rs`) that constructs a `SidecarConfig` with a persistence_dir, runs through `try_from_sidecar_config` and `from_one_shot`, and asserts the serialized JSON body contains the persistence path under the correct field name.

- [ ] **14.6: Manual smoke** — start `npm run dev` from the VU-1155 worktree (must be a clean restart so Tauri builds the new Rust binary), run a refine turn, verify the per-run logs dir is populated with the SDK's native per-event JSON tree (`{persistence_dir}/{conversation_id}/base_state.json + events/event-NNNNN-{uuid}.json`) and that the event count matches the chat's display count. **Note:** the earlier `.jsonl` fixtures came from an older Skill Builder-side writer path that no longer runs; the SDK natively writes per-event JSON, not JSONL. We accept the SDK's native format.

- [ ] **14.7: No backfill.** Existing empty directories from previous runs are not recoverable; this task only fixes new runs.

This task can ship as part of the VU-1155 PR or as a separate follow-up — recommend separate, since it's an orthogonal bug. The VU-1155 design spec already calls it out under "Known limitations / follow-ups".

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-05-03-refine-openhands-migration.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task with two-stage review.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Pick the approach when you're ready to implement.

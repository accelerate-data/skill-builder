---
functional-specs: []
---

# Refine → OpenHands Multi-Turn Conversation

> **Status:** Draft
> **Runtime update:** Persistent per-skill conversation ownership now lives in
> `docs/design/persistent-skill-conversations/README.md`. This document remains
> useful for refine-specific multi-turn mechanics, but any statements about
> creating a conversation only for refine or deleting it on close are
> superseded by the persistent skill conversation design.

## Overview

The Refine tab is a streaming chat UI where users ask the skill-creator agent to modify their skill files. The current implementation uses the Node.js Claude Code sidecar's streaming protocol (`stream_start` / `stream_message` / `stream_end`) — which is fully stubbed and immediately returns an unsupported error. This design replaces that stub with an OpenHands Agent Server multi-turn conversation. The frontend Tauri event pipeline (`agent-message`, `agent-exit`, `agent-shutdown`) is unchanged; only the Rust backend changes.

## Design Scope

**Covers**

- Multi-turn conversation lifecycle: attach or create on turn 1, append event +
  run on later turns, keep-alive between turns
- Cancel (pause conversation, stay in refine view) vs Close/navigate-away
  (stop any running turn, but keep the persisted skill conversation)
- New `dispatch_openhands_refine_turn` function in `openhands_server/mod.rs` — a no-delete variant of `dispatch_openhands_one_shot`
- `RefineSession` field additions (`conversation_id`, `current_agent_id`) and removal (`stream_started`)
- Removal of Claude Code-only artifacts: `discover_plugin_agents`, `answer_refine_question`, `SidecarPool` params on refine commands
- `protocol.rs` cleanup: retire `RefineRuntimeSettings`, `build_refine_config`, `load_refine_runtime_settings`, `REFINE_STREAM_MAX_TURNS`; replace with `read_initialized_runtime_context` + `build_openhands_one_shot_config`
- `refine-initial.txt` template update: remove `Agent`-tool ROUTING, remove mandatory `AskUserQuestion` eval-feedback flow; replace with a direct task framing the agent can act on immediately
- Frontend cleanup: remove `requireSettingsModel` guard, `handleQuestionSubmit`, `answerStreamingRefineQuestion`, `cleanupSkillSidecar`; rename `sendStreamingRefineMessage` → `sendRefineMessage`
- Test suite update: remove stale Claude Code streaming tests, update session struct tests, keep all `finalize_refine_run` and `get_skill_content` tests unchanged

**Does not cover**

- `AskUserQuestion` custom tool (not needed — user input travels through the standard multi-turn `send_refine_message` path)
- Description optimization migration (separate ticket)
- workspace-evals migration (separate ticket)

## Key Decisions

| Decision | Rationale |
|---|---|
| One persistent conversation per session, kept alive between turns | The agent retains full edit history, file state, and conversation tone across turns without the app reconstructing context each time |
| Cancel = POST /pause then wait for real `PauseEvent` from server, keep conversation alive | User may want to stop a long edit and send a corrected instruction; the conversation stays valid. A synthetic cancel event was previously emitted by the client — that is wrong because the server may not have actually stopped yet. The real `PauseEvent` streamed back via WebSocket is the authoritative stop confirmation. |
| Close/navigate-away keeps the persisted skill conversation. | Refine is now one surface on the skill's long-lived OpenHands thread. Leaving the view must not discard that thread by default. |
| `dispatch_openhands_refine_turn` skips `delete_conversation` | The only structural difference from the one-shot path; cancel registry, WebSocket loop, and event emission are unchanged |
| `current_agent_id` stored in `RefineSession` | Close must be able to cancel a running turn without knowing the agent_id out-of-band |
| `available_agents` is always `["skill-creator"]` | `discover_plugin_agents` scans Claude Code plugin dirs (`.claude/plugins/`); OpenHands uses `.agents/`, and skill-creator is the only refine agent |
| `answer_refine_question` removed entirely | That command implemented Claude Code's `AskUserQuestion` interrupt protocol; OpenHands multi-turn replaces it with a plain `send_refine_message` turn |

## Conversation Lifecycle

### Turn 1 — first `send_refine_message`

```text
app                            OpenHands Agent Server
 │                                     │
 ├── POST /api/conversations ──────────►  initial_message = context + user message
 │◄── { id: conversation_id } ──────────┤
 │                                     │
 ├── WebSocket connect ────────────────►
 ├── auth { session_api_key } ─────────►
 ├── POST /api/conversations/{id}/run ─►
 │◄── stream events ──────────────────-┤  → agent-message Tauri events
 │                                     │
 │   terminal conversation_state received
 │   emit agent-message(conversation_state)
 │   emit agent-shutdown
 │                                     │
 │   conversation STAYS ALIVE          │
 │   store conversation_id in RefineSession
```

### Turn N — subsequent `send_refine_message`

```text
app                            OpenHands Agent Server
 │                                     │
 ├── POST /api/conversations/{id}/events ►  MessageEvent: user text
 ├── POST /api/conversations/{id}/run ──►
 │◄── stream events ──────────────────-┤  → agent-message Tauri events
 │   terminal conversation_state
 │   emit agent-message / agent-shutdown
 │   conversation STAYS ALIVE
```

### Cancel — user clicks stop, stays in refine view

```text
cancel_refine_turn(session_id)
  ├── read current_agent_id from RefineSession
  └── cancel_openhands_one_shot(current_agent_id)
        └── signals oneshot channel → run_conversation_task_inner sets cancel_pending=true:
              ├── POST /api/conversations/{id}/pause
              └── continues reading WebSocket (cancel branch disabled via guard)
                    └── server streams PauseEvent
                          └── normalize_server_event → conversation_state(status="cancelled")
                                ├── emit agent-message(conversation_state)
                                └── emit agent-shutdown

  conversation STAYS ALIVE — next turn reuses conversation_id
```

The cancelled event comes from the real `PauseEvent` the server streams after `POST /pause`. The cancel branch sets `cancel_pending = true` and falls through; the main WebSocket read loop receives the `PauseEvent`, `normalize_server_event` maps it to `conversation_state(status="cancelled")`, and the loop exits normally. This applies to both one-shot and multi-turn runs.

### Close / navigate-away — `close_refine_session`

```text
close_refine_session(session_id)
  ├── remove session from RefineSessionManager
  ├── if session.current_agent_id.is_some() and turn is active:
  │     cancel_openhands_one_shot(current_agent_id)   ← stops streaming, pauses server
  └── keep persisted conversation_id for future resume
```

The refine view owns only the live in-memory UI/session wrapper. The underlying
skill conversation remains durable and is reused when the skill is reopened.

## Bug Fix: Cancel Path in `run_conversation_task_inner`

The existing cancel path in `run_conversation_task_inner` was incorrect for both one-shot and multi-turn runs. It emitted a synthetic `conversation_state(status="cancelled")` event immediately after `POST /pause` and returned, without waiting for the server to confirm the pause. This meant the agent might still be running when the client declared it cancelled.

**Fix applied to `mod.rs`:** The cancel branch now sets `cancel_pending = true` and falls through instead of returning. A `if !cancel_pending` guard prevents the cancel arm from re-firing in subsequent `select!` iterations. The WebSocket read loop continues receiving events normally; the server streams back a `PauseEvent` which `normalize_server_event` maps to `conversation_state(status="cancelled")`, exiting the loop.

**Fix applied to `events.rs`:** `PauseEvent` and `pause_event` are added to the terminal-state type matcher so the SDK's `PauseEvent` is correctly recognized as a cancelled terminal state.

These fixes apply to all callers of `run_conversation_task_inner` — one-shot and future multi-turn refine runs alike.

## New Rust Infrastructure

### `dispatch_openhands_refine_turn`

```rust
pub async fn dispatch_openhands_refine_turn(
    app: &tauri::AppHandle,
    agent_id: &str,
    config: SidecarConfig,
    conversation_id: Option<String>,
    transcript_log_dir: Option<&str>,
) -> Result<String, String>   // returns conversation_id
```

Located in `app/src-tauri/src/agents/openhands_server/mod.rs`.

**Turn 1** (`conversation_id` is `None`): calls `client.create_conversation`, gets `conversation_id`, then proceeds to WebSocket connect + authenticate + run.

**Turn N** (`conversation_id` is `Some`): calls `client.send_event` with a `MessageEvent` (role: `user`, content), then proceeds to WebSocket connect + authenticate + run on the existing conversation.

After terminal state: emits `conversation_state` via `handle_sidecar_message`, emits `handle_agent_shutdown` — and **does not call `delete_conversation`**.

Internally uses a `run_refine_conversation_task` wrapper that calls the existing `run_conversation_task_inner` unchanged, but omits the delete call:

```rust
// existing: always deletes
async fn run_conversation_task(task, cancel_rx) {
    let result = run_conversation_task_inner(&task, &mut cancel_rx).await;
    if result.is_err() { pause_conversation(...) }
    delete_conversation(...)        // ← not present in refine variant
}

// new: never deletes
async fn run_refine_conversation_task(task, cancel_rx) {
    let result = run_conversation_task_inner(&task, &mut cancel_rx).await;
    if result.is_err() { pause_conversation(...) }
    // conversation stays alive
}
```

The cancel registry (`register_cancel`, `cancel_openhands_one_shot`) is used unchanged — registered with `agent_id` for the current turn.

### `close_openhands_refine_session`

```rust
pub async fn close_openhands_refine_session(
    conversation_id: &str,
) -> Result<(), String>
```

Calls `ensure_agent_server`, builds client, calls `client.delete_conversation(conversation_id)`. Delete errors are logged and swallowed (best-effort cleanup — the server will eventually GC abandoned conversations).

## Config Building

`protocol.rs` currently owns all Claude Code streaming session setup. The OpenHands migration removes most of it:

### What is retired

| Symbol | Replacement |
|---|---|
| `REFINE_STREAM_MAX_TURNS: u32 = 400` | `max_turns: 50` per agent run in `build_openhands_one_shot_config`; sessions are unbounded because each turn starts a new conversation run |
| `RefineRuntimeSettings` | Inline values resolved from `read_initialized_runtime_context` and `db` |
| `load_refine_runtime_settings` | Inline logic in `send_refine_message`: call `read_initialized_runtime_context` for LLM config; retain the `write_user_context_file` call with the same workforce-context logic |
| `build_refine_config` | `build_openhands_one_shot_config(OpenHandsOneShotConfigParams { ... })` |

### What remains in `protocol.rs`

| Symbol | Status |
|---|---|
| `new_refine_usage_session_id` | Unchanged |
| `ensure_skill_workspace_dir` | Unchanged |
| `REFINE_FOLLOWUP_TEMPLATE` / `build_followup_prompt_with_output_dir` | Unchanged — used for turn N MessageEvent content |
| `REFINE_PROMPT_TEMPLATE` / `build_refine_prompt_with_output_dir` | Updated — template file `refine-initial.txt` loses Claude Code-specific sections (see Initial Message Format below) |

### `build_openhands_one_shot_config` call

Refine reuses the **same** `skill-creator` agent setup that workflow uses for step 3 (`skill_generation`). The only difference is the conversation lifecycle (multi-turn vs one-shot). Every other knob — agent name, allowed tools, user-message suffix, workspace layout, max_turns — matches `build_workflow_generate_skill_sidecar_config` in `commands/workflow/runtime.rs`.

```rust
let workspace_skill_dir_str = crate::skill_paths::workspace_skill_dir(
    Path::new(&runtime_ctx.workspace_path),
    plugin_slug,
    skill_name,
)
.to_string_lossy()
.replace('\\', "/");

let mut config = build_openhands_one_shot_config(OpenHandsOneShotConfigParams {
    prompt,                             // turn 1 = full initial; turn N = followup
    llm: runtime_ctx.llm.clone(),
    workspace_root_dir: runtime_ctx.workspace_path.replace('\\', "/"),
    workspace_run_dir: workspace_skill_dir_str.clone(),
    agent_name: "skill-creator".to_string(),
    task_kind: Some("refine".to_string()),
    user_message_suffix: Some(SKILL_CREATOR_USER_SUFFIX.trim().to_string()),
    allowed_tools: vec!["file_editor".to_string(), "terminal".to_string()],
    max_turns: 500,
    output_format: None,
    skill_name: Some(skill_name.to_string()),
    step_id: Some(-10),
    run_source: Some("refine".to_string()),
    plugin_slug: plugin_slug.to_string(),
});
config.transcript_log_dir = Some(format!("{workspace_skill_dir_str}/logs"));
```

| Field | Value | Source |
|---|---|---|
| `workspace_root_dir` | `runtime_ctx.workspace_path` (e.g. `~/.vibedata`) | matches workflow |
| `workspace_run_dir` | `workspace_skill_dir(workspace, plugin, skill)` (e.g. `~/.vibedata/skill-creator/{skill}`) | matches workflow |
| `agent_name` | `skill-creator` | matches workflow step 3 |
| `user_message_suffix` | `SKILL_CREATOR_USER_SUFFIX` from `agent-sources/prompts/skill-creator-user-suffix.txt` | matches workflow + scope_review |
| `allowed_tools` | `["file_editor", "terminal"]` | matches `skill_generation_workflow_tools()` |
| `max_turns` | `500` | matches workflow step 3 |
| `task_kind` | `refine` | refine-specific namespace |
| `step_id` | `-10` | refine-specific sentinel |
| `run_source` | `refine` | refine-specific tag |
| `transcript_log_dir` | `{workspace_skill_dir}/logs` | matches workflow |

The agent's CWD is the **workspace** skill dir (`~/.vibedata/{plugin}/{skill}`), not the source skills repo. The prompt template substitutes `{{skill_dir}}` with the absolute skills-repo path so the agent reads/writes SKILL.md and references at their canonical location while still running with workspace context (user-context.md, transcripts) co-located.

`SKILL_CREATOR_USER_SUFFIX` is included at the top of `commands/refine/mod.rs`:

```rust
const SKILL_CREATOR_USER_SUFFIX: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/skill-creator-user-suffix.txt"
));
```

This duplicates the constant already defined in `commands/workflow/runtime.rs` and `commands/skill/scope_review.rs` — matching the existing convention rather than introducing a shared module.

### `write_user_context_file` retention

`load_refine_runtime_settings` currently calls `write_user_context_file` with workforce context derived from the workflow run row, SKILL.md frontmatter, settings, and intake JSON. This call is preserved verbatim in `send_refine_message` (turn 1 only — subsequent turns reuse the same conversation context that was set up on turn 1).

## `RefineSession` State Changes

`RefineSession` is defined in `app/src-tauri/src/commands/refine/mod.rs`.

| Field | Change | Reason |
|---|---|---|
| `conversation_id: Option<String>` | Add | Reused on turn 2+ to avoid creating a new conversation |
| `current_agent_id: Option<String>` | Add | Needed by close path to cancel an active turn before deleting |
| `stream_started: bool` | Remove | Claude Code sidecar concept with no OpenHands equivalent |

`usage_session_id` and `head_sha_at_start` are unchanged.

## Initial Message Format (Turn 1)

### Template change: `refine-initial.txt`

The current template has two Claude Code-specific sections that must be removed:

1. **ROUTING block** — routes to `skill-creator:rewrite-skill` via the `Agent` tool. In OpenHands, `skill-creator` IS the agent; no sub-agent dispatch is needed. The agent acts directly on the skill files.
2. **EVAL FAILURE FEEDBACK block** — requires a MANDATORY `AskUserQuestion` tool call (a Claude Code interrupt mechanism). In OpenHands, the agent instead reads the grading files, summarizes findings in plain text in its response message, and the user replies with a follow-up `send_refine_message` turn specifying which gaps to address.

The template variables that survive: `{{skill_name}}`, `{{skill_dir}}`, `{{context_dir}}`, `{{workspace_dir}}`, `{{target_files_clause}}`, `{{user_message}}`. The `{{command}}` duplicate of `{{user_message}}` can be unified to just `{{user_message}}`.

The updated `refine-initial.txt` sets workspace context and delegates immediately to the user message, with no tool-routing instructions:

```text
We are refining the skill {{skill_name}}. The skill directory is: {{skill_dir}}. The context directory is: {{context_dir}}. The workspace directory is: {{workspace_dir}}. The user context file is at: {{workspace_dir}}/user-context.md — read it for purpose, description, and all user context.{{target_files_clause}}

Read SKILL.md and any reference files in the references/ directory to understand the current skill before making any changes.

If the user's message contains eval failure feedback (lines matching "eval `{eval_name}`: {/path/to/grading.json}"), read each grading file, triage failures as genuine skill gaps vs assertion design issues, and summarize your findings in plain text. Do not make changes until the user confirms which gaps to address.

CONSTRAINT: You can only refine or validate the existing skill. Do NOT create new skills.

Current request: {{user_message}}
```

### `target_files` parameter

Turn 1: the `target_files_clause` substitution in `build_refine_prompt_with_output_dir` injects an `IMPORTANT: Only edit these files:` constraint into the `initial_message` when `target_files` is non-empty.

Turn N: `build_followup_prompt_with_output_dir(user_message, &skill_output_dir, target_files)` produces the MessageEvent content with the same constraint prefix when specified.

## Turn N Message Format

Subsequent `send_refine_message` calls append a `MessageEvent` to the conversation and then `run`. The message content is built by `build_followup_prompt_with_output_dir`:

```text
[IMPORTANT: Only edit these files: {abs_file_paths}. Do not modify any other files.

]{user_message}
```

The file constraint prefix is omitted when `target_files` is `None` or empty. No context reconstruction is needed — the agent's full edit history and the initial skill context from turn 1 are already in the conversation.

## Commands Changed

| Command | Change |
|---|---|
| `start_refine_session` | Remove `SidecarPool` param; remove `discover_plugin_agents`; set `available_agents = vec!["skill-creator"]`; session starts with `conversation_id: None`, `current_agent_id: None` |
| `send_refine_message` | Remove unsupported-error stub; remove `SidecarPool` param; inline `load_refine_runtime_settings` logic (call `read_initialized_runtime_context`, retain `write_user_context_file` on turn 1 only); build prompt via `build_refine_prompt_with_output_dir` (turn 1) or `build_followup_prompt_with_output_dir` (turn N); call `dispatch_openhands_refine_turn`; store returned `conversation_id` and `agent_id` in session |
| `close_refine_session` | Remove `SidecarPool` param; cancel active turn if `current_agent_id` is set; call `close_openhands_refine_session` if `conversation_id` is set |
| `cancel_refine_turn` | Remove `SidecarPool` param; call `cancel_openhands_one_shot(current_agent_id)` if a turn is active |
| `answer_refine_question` | Remove entirely; remove from `lib.rs` command registration |

## Frontend Changes

### `app/src/components/workspace/workspace-refine.tsx`

| Change | Detail |
|---|---|
| Remove `cleanupSkillSidecar` import | Remove from import list and from `releaseSkillResources` — the only remaining call in that function is `releaseLock`. The sidecar teardown is no longer needed; OpenHands conversations are closed via `close_refine_session` |
| Remove `requireSettingsModel` import and guard | The `handleSend` function calls `requireSettingsModel(selectedModel)` and shows a toast if no model is configured. With OpenHands, `send_refine_message` calls `read_initialized_runtime_context` on the backend, which returns a structured error if no model is set. Remove the guard; the error propagates through the existing `catch` block that already toasts |
| Remove `answerStreamingRefineQuestion` import | Remove import |
| Remove `handleQuestionSubmit` callback | The entire 60-line `handleQuestionSubmit` function — which reads `message.toolUseId`, `message.questions`, handles redirect labels (`launch validate`, `launch benchmark`), and calls `answerStreamingRefineQuestion` — is removed entirely. The `AskUserQuestion` interrupt protocol does not exist in OpenHands |
| Remove `onQuestionSubmit` prop from `<ChatPanel>` | Remove the prop call-site; update `ChatPanel` interface if needed |
| Rename `sendStreamingRefineMessage` → `sendRefineMessage` | The Tauri command name `send_refine_message` is unchanged; only the TypeScript wrapper is renamed for clarity |
| `availableAgents` stays wired | The backend now always returns `["skill-creator"]` from `start_refine_session`; no change to how the frontend reads it from the store |
| `agent-message` and `agent-exit` Tauri event listeners | Unchanged — the OpenHands event pipeline emits the same event shapes |

### `app/src/lib/tauri.ts`

| Change | Detail |
|---|---|
| Remove `answerStreamingRefineQuestion` export | Remove the `answerRefineQuestion` wrapper entirely |
| Rename `sendStreamingRefineMessage` → `sendRefineMessage` | Update export name; keep the `send_refine_message` invoke target unchanged |

### `app/src/lib/tauri-command-types.ts`

Remove `answer_refine_question` command type entry.

## Test Suite Changes

### Tests to remove (`app/src-tauri/src/commands/refine/tests.rs`)

| Test | Why |
|---|---|
| `test_refine_streaming_is_explicitly_unsupported_for_openhands_migration` | The stub is gone; OpenHands refine is now implemented |
| `test_refine_config_has_no_agent` | Tests `build_refine_config` which is removed |
| `test_refine_config_includes_task_tool_for_streaming_edits` | Tests `Agent` tool in allowed_tools — removed |
| `test_refine_config_includes_all_file_tools` | Tests Claude Code tool names (Read/Edit/Write/Glob/Grep) — removed |
| `test_refine_config_cwd_points_to_workspace_root` | Tests `build_refine_config` — removed |
| `test_refine_config_no_conversation_history` | Tests `build_refine_config` — removed |
| `test_refine_config_agent_id_format` | Tests `build_refine_config` — removed |
| `test_refine_config_sets_model_directly` | Tests `build_refine_config` — removed |
| `test_refine_config_uses_stream_max_turns` | Tests `REFINE_STREAM_MAX_TURNS` — removed |
| `test_refine_config_extended_thinking_sets_budget` | Tests `build_refine_config` — removed |
| `test_refine_config_no_thinking_when_disabled` | Tests `build_refine_config` — removed |
| `test_refine_config_output_format_is_intentionally_unset_for_chat_flow` | Tests `build_refine_config` — removed |
| `test_refine_config_serialization_matches_sidecar_schema` | Tests `build_refine_config` — removed |
| `test_refine_config_includes_persistence_identity_for_run_summary` | Tests `build_refine_config` — removed |
| `test_refine_config_requires_skill_creator_plugin` | Tests `required_plugins` in `build_refine_config` — removed |
| `test_refine_config_serialization_omits_none_fields` | Tests `build_refine_config` — removed |
| `test_session_stream_started_defaults_to_false` | Tests removed `stream_started` field |
| `test_session_stream_started_can_be_set` | Tests removed `stream_started` field |
| `test_completed_turn_does_not_close_or_reset_stream_started_session` | Tests removed `stream_started` field |
| `test_refine_prompt_includes_routing` | Tests Claude Code ROUTING section — removed from template |

### Tests to update

| Test | Change |
|---|---|
| `test_session_create_and_lookup` | Remove `stream_started: false`; add `conversation_id: None`, `current_agent_id: None` |
| `test_session_conflict_detection` | Same struct field update |
| `test_close_session_removes_entry` | Same struct field update |
| `test_refine_prompt_includes_metadata` | Update assertion — `We are writing the skill` → `We are refining the skill` |

### Tests to add

| Test | What it verifies |
|---|---|
| `test_refine_session_has_no_stream_started_field` | `RefineSession` compiles and initializes without `stream_started` |
| `test_refine_session_holds_conversation_and_agent_ids` | `RefineSession` stores `conversation_id: Option<String>` and `current_agent_id: Option<String>` |
| `test_refine_initial_prompt_has_no_routing_section` | Compiled `REFINE_PROMPT_TEMPLATE` does not contain `AskUserQuestion` or `Agent` tool references |
| `test_refine_initial_prompt_includes_eval_guidance` | Prompt contains the plain-text eval-feedback handling instruction |

## Relationship to Existing Design Specs

| Spec | Relationship |
|---|---|
| `docs/design/openhands-native-migration/README.md` | Umbrella migration doc; notes refine as deferred pending `AskUserQuestion`. This design implements the non-interrupt multi-turn path that makes the deferral unnecessary |
| `docs/design/openhands-agent-server-runtime/README.md` | Defines the REST/WebSocket runtime used by `dispatch_openhands_refine_turn` |
| `docs/design/write-eval-test-refine-loop/README.md` | Covers the broader write/eval/test/refine product loop; refine here is the Refine tab chat surface only |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/commands/refine/mod.rs` | All refine Tauri commands and `RefineSession` struct |
| `app/src-tauri/src/commands/refine/protocol.rs` | Prompt builders and workspace helpers; `build_refine_config`, `load_refine_runtime_settings`, `REFINE_STREAM_MAX_TURNS`, `RefineRuntimeSettings` removed |
| `app/src-tauri/src/commands/refine/tests.rs` | Test suite; stale Claude Code streaming tests removed (see Test Suite Changes) |
| `app/src-tauri/src/agents/openhands_server/mod.rs` | One-shot dispatch; new `dispatch_openhands_refine_turn` and `close_openhands_refine_session` go here |
| `app/src-tauri/src/agents/openhands_server/client.rs` | `build_send_event_request`, `build_run_request`, `build_pause_request`, `build_delete_request` — all already present |
| `app/src-tauri/src/agents/openhands_server/events.rs` | `normalize_server_event`; `PauseEvent` added as terminal cancelled type |
| `app/src-tauri/src/agents/sidecar.rs` | `OpenHandsOneShotConfigParams` and `build_openhands_one_shot_config` — used by `send_refine_message` |
| `agent-sources/prompts/refine-initial.txt` | Turn 1 prompt template; ROUTING + `AskUserQuestion` blocks removed |
| `agent-sources/prompts/refine-followup.txt` | Turn N MessageEvent content; unchanged |
| `app/src-tauri/src/types/refine.rs` | `RefineSessionInfo` (unchanged); `RefineSession` is in `mod.rs` |
| `app/src/components/workspace/workspace-refine.tsx` | Frontend refine tab |
| `app/src/lib/tauri.ts` | Tauri command wrappers |
| `app/src-tauri/src/lib.rs` | Tauri command registration |

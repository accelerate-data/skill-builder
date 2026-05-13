# OpenHands Runtime Contract Implementation Gaps

Current gaps between latest `main` and the target runtime contract in
[README.md](README.md).

## 1. Raw OpenHands Shutdown Wrapper Is Not Exposed Yet

Target model expects a raw `shutdown_openhands_server()` API in
`agents/openhands_server/mod.rs`, parallel to `ensure_openhands_server(...)`.
App-exit callers should use that wrapper rather than calling
`agents/openhands_server/process.rs` directly.

Latest `main` still calls `process::shutdown_agent_server()` directly from:

- `app/src-tauri/src/lib.rs`
- `app/src-tauri/src/commands/runtime_lifecycle.rs`

Relevant files:

- `app/src-tauri/src/agents/openhands_server/mod.rs`
- `app/src-tauri/src/agents/openhands_server/process.rs`
- `app/src-tauri/src/lib.rs`
- `app/src-tauri/src/commands/runtime_lifecycle.rs`

## 2. Cached-Server Pause Helper Still Exists

Target model has one raw pause API:

- `pause_openhands_conversation(config, conversation_id)`

Best-effort behavior belongs at the caller, not in a second raw pause helper.

Latest `main` still carries:

- `pause_conversation_if_server_running(conversation_id)`

Relevant files:

- `app/src-tauri/src/agents/openhands_server/mod.rs`
- `app/src-tauri/src/commands/skill/crud.rs`
- `app/src-tauri/src/commands/workflow/evaluation.rs`

## 3. Tracked Runtime Layer Still Exposes Abort/Terminate Semantics

Target model narrows the tracked layer to:

- `send_tracked_openhands_message(...)`
- `pause_tracked_openhands_conversation(...)`
- `send_tracked_throwaway(...)`

Tracked runs stop through pause semantics. The tracked layer should not expose
separate abort or terminate APIs for normal runtime flows.

Latest `main` still includes:

- `abort_tracked_openhands_run(...)`
- `terminate_tracked_openhands_session(...)`
- `run_tracked_throwaway_openhands_session(...)` instead of the target
  `send_tracked_throwaway(...)` name

Relevant files:

- `app/src-tauri/src/agents/tracked_openhands.rs`
- `app/src-tauri/src/commands/workflow/runtime.rs`
- `app/src-tauri/src/commands/skill/crud.rs`
- `app/src-tauri/src/commands/api_validation.rs`
- `app/src-tauri/src/commands/skill/scope_review.rs`
- `app/src-tauri/src/commands/eval_workbench/mod.rs`

## 4. Specialized Runtime-Config Builders Still Exist

Target model expects `build_skill_creator_config(...)` to be the single
canonical config API, driven by:

- `SkillCreatorRuntimeContext`
- `SkillCreatorIntent`

Callers should not hand-fill policy fields like `task_kind`, `run_source`,
`allowed_tools`, `max_turns`, `step_id`, or `output_format`.

Latest `main` still splits config construction across:

- `build_skill_session_config(...)`
- multiple `build_workflow_*_runtime_config(...)` functions
- ad hoc throwaway config assembly paths

Relevant files:

- `app/src-tauri/src/agents/skill_creator.rs`
- `app/src-tauri/src/commands/skill_session.rs`
- `app/src-tauri/src/commands/workflow/runtime.rs`
- `app/src-tauri/src/commands/api_validation.rs`
- `app/src-tauri/src/commands/skill/scope_review.rs`
- `app/src-tauri/src/commands/eval_workbench/mod.rs`

## 5. `step_id` Is Still Part of the Caller-Facing Builder Surface

Target model treats `step_id` as a derived persistence/reporting field, not the
public abstraction. Runtime policy should be selected by typed
`SkillCreatorIntent`.

Latest `main` still passes explicit `step_id`, `task_kind`, and `run_source`
values into the config builder call sites.

Relevant files:

- `app/src-tauri/src/agents/skill_creator.rs`
- `app/src-tauri/src/commands/skill_session.rs`
- `app/src-tauri/src/commands/workflow/runtime.rs`

## 6. Skill-Related Throwaway Working Directories Do Not Yet Match the Target Model

Target model says:

- skill-related throwaway runs use the canonical skill dir as their working
  directory
- non-skill-related throwaway runs use
  `/tmp/skill-builder/throwaway/{surface}/{run_id}`

Latest `main` still roots some skill-related throwaway paths under throwaway
subdirectories instead of reusing the canonical skill dir.

Relevant files:

- `app/src-tauri/src/skill_paths.rs`
- `app/src-tauri/src/commands/skill/scope_review.rs`
- `app/src-tauri/src/commands/api_validation.rs`

## 7. Structured Shutdown-Event Matching in the Tracked Throwaway Path Is Missing

Target model expects the tracked layer to consume structured app runtime events
without relying on raw payload substring matching.

Latest `main` still matches `agent-shutdown` by checking whether the payload
string contains the target `agent_id`, even though the event is emitted as a
structured payload.

Relevant files:

- `app/src-tauri/src/agents/tracked_openhands.rs`
- `app/src-tauri/src/agents/event_router.rs`
- `app/src-tauri/src/agents/event_types.rs`

## 8. Workflow Reset Still Deletes Conversation State Instead of Forking

Target model for reset/redo is:

1. pause current conversation
2. reset files, artifacts, and DB state to the target step
3. fork the paused conversation into a new `conversation_id`
4. bind the skill to the fork ID
5. continue future work on the fork

The old conversation remains persisted. Reset must never delete conversation
storage.

Latest `main` still:

- deletes the per-conversation directory under app data
- clears the skill's saved conversation binding
- forces the next run onto a fresh conversation instead of a fork

Relevant files:

- `app/src-tauri/src/commands/workflow/evaluation.rs`
- `app/src-tauri/src/db/skills.rs`

## 9. Fork APIs Are Missing at the Raw and Shared Session Layers

Target model expects:

- raw `fork_openhands_conversation(app, config, source_conversation_id)`
- shared `fork_skill_session(app, config, source_conversation_id)`

Fork returns a new `conversation_id` plus restored events for hydration. It does
not create a new `agent_id`.

Latest `main` does not yet expose fork at either layer.

Relevant files:

- `app/src-tauri/src/agents/openhands_server/mod.rs`
- `app/src-tauri/src/agents/skill_creator.rs`

## 10. New `agent_id` Creation Is Not Yet Explicitly Tied to the Next Live Send/Run

Target model says:

- fork creates a new `conversation_id`
- the next live send/run on that fork creates the new tracked `agent_id`

Latest `main` still lacks the fork path entirely, so the agent-id boundary for
post-reset fork continuation is not yet implemented.

Relevant files:

- `app/src-tauri/src/agents/tracked_openhands.rs`
- `app/src-tauri/src/commands/workflow/runtime.rs`
- `app/src-tauri/src/commands/workflow/evaluation.rs`

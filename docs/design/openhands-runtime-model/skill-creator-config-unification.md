# Skill Creator Config Unification

## Problem

The product has two diverged code paths for constructing OpenHands runtime configs and invoking the skill-creator agent — one for the workflow UI and one for the workspace (refine) UI. Neither path is authoritative. Both call the same underlying `build_openhands_runtime_config` primitive but with different wrappers, different module locations, and different naming conventions. A third issue: the workflow path skips the server lifecycle check (`ensure_openhands_server`) that the workspace path performs, creating an implicit correctness gap.

The result is three violations of the intended architecture:

1. No single model for how the product speaks to OpenHands.
2. Call paths don't all go through the same primitives.
3. App-specific logic and OpenHands interaction model are mixed together in the same modules.

## Design Principles

1. **One model** — a single `SkillCreatorConfigParams` struct and `build_skill_creator_config` function is the only way to build an OpenHands config for any skill-creator run in the product.
2. **Same primitives** — all callers go through the same call sequence for server lifecycle and session management.
3. **Clean separation** — the OpenHands interaction model lives in `agents/`; app-specific setup (workspace dirs, DB reads, Tauri commands) lives in `commands/`.

## Architecture

Three layers with strict dependency direction (each layer only imports from layers below it):

```text
commands/           ← Layer 3: app-specific (Tauri commands, DB, workspace setup)
agents/skill_creator.rs  ← Layer 2: skill creator model (config, session sequence)
agents/openhands_server/ ← Layer 1: raw OpenHands API (HTTP, server lifecycle)
```

## Layer 2: `agents/skill_creator.rs` (new)

This is the only file allowed to know about the skill-creator agent's configuration. It has no deps on `commands::` — it imports only from `agents/openhands_server/`, `agents/runtime_config`, and `skill_paths`.

### `SKILL_CREATOR_USER_SUFFIX`

Moves here from `commands/refine/mod.rs`. It belongs with the builder that uses it.

### `SkillCreatorConfigParams`

The unified parameter struct for all skill-creator runs:

```rust
pub struct SkillCreatorConfigParams<'a> {
    pub skill_name: &'a str,
    pub prompt: &'a str,
    pub workspace_path: &'a str,
    pub plugin_slug: &'a str,
    pub llm: WorkflowLlmConfig,
    pub task_kind: &'a str,
    pub run_source: &'a str,
    pub allowed_tools: Vec<String>,
    pub max_turns: u32,
    pub step_id: i32,
    pub output_format: Option<serde_json::Value>,
}
```

`step_id` convention:

| Context | `step_id` |
|---|---|
| Workflow steps | `0`, `1`, `2`, `3` |
| Answer evaluator | `-1` |
| Workspace (refine) | `-10` |

`workflow_session_id` is intentionally absent. Cost and usage queries are grouped by `skill_name + step_id` — a per-invocation session ID provides no additional query value.

### `build_skill_creator_config`

```rust
pub fn build_skill_creator_config(params: SkillCreatorConfigParams<'_>) -> OpenHandsRuntimeConfig
```

Derives `workspace_run_dir` from `workspace_skill_dir(workspace_path, plugin_slug, skill_name)`, sets `agent_name: "skill-creator"`, applies `SKILL_CREATOR_USER_SUFFIX`, and delegates to `build_openhands_runtime_config`. This is the only place in the codebase that constructs a skill-creator config.

### `ensure_skill_session`

```rust
pub async fn ensure_skill_session(
    app: &tauri::AppHandle,
    config: OpenHandsRuntimeConfig,
    saved_conversation_id: Option<String>,
) -> Result<String, String>
```

Wraps `ensure_openhands_server` + `start_openhands_session` in the correct sequence. All callers (workspace and workflow) use this function instead of calling `start_openhands_session` directly. This fixes the gap where `dispatch_persistent_skill_turn` previously bypassed the server lifecycle check.

## Layer 3: App commands (cleanup)

### `commands/skill_session.rs`

Renames (no behavior change):

| Old | New |
|---|---|
| `RefineSession` | `SkillSession` |
| `RefineSessionManager` | `SkillSessionManager` |
| `refine_session_key` | `skill_session_key` |
| `upsert_refine_session` | `upsert_skill_session` |
| `remove_refine_sessions_for_skill` | `remove_skill_sessions` |
| `restore_refine_conversation_state` | `restore_skill_conversation_state` |

`ensure_skill_runtime_ready` (renamed from `ensure_refine_runtime_ready`) stays here because it has app-layer deps: `commands::workflow::read_initialized_runtime_context`, `commands::workflow::ensure_workspace_prompts`, and `commands::refine::protocol::ensure_skill_workspace_dir`.

`build_skill_session_config` replaces `build_refine_openhands_config`. It is a thin wrapper over `skill_creator::build_skill_creator_config` with the workspace-fixed params (`task_kind: "refine"`, `step_id: -10`, `allowed_tools: ["file_editor", "terminal"]`, `max_turns: 500`, `run_source: "refine"`).

`select_skill_openhands_session` calls `skill_creator::ensure_skill_session` instead of the current `ensure_openhands_server` + `start_openhands_session` sequence.

### `commands/workflow/runtime.rs`

`SkillCreatorWorkflowConfigParams` and `build_skill_creator_workflow_runtime_config` are deleted. The four step-specific builders (`build_workflow_research_runtime_config`, `build_workflow_detailed_research_runtime_config`, `build_workflow_confirm_decisions_runtime_config`, `build_workflow_generate_skill_runtime_config`) and `build_answer_evaluator_runtime_config` remain in this file as thin wrappers over `skill_creator::build_skill_creator_config`.

`dispatch_persistent_skill_turn` calls `skill_creator::ensure_skill_session` instead of `start_openhands_session` directly.

### `commands/refine/mod.rs`

Deletes: `ensure_refine_runtime_ready`, `build_refine_openhands_config`, `SKILL_CREATOR_USER_SUFFIX`.

Updates re-exports: `RefineSession` → `SkillSession`, `RefineSessionManager` → `SkillSessionManager`, `refine_session_key` → `skill_session_key`.

Call sites updated to use renamed functions from `commands::skill_session`.

## Callers updated across the codebase

| File | Change |
|---|---|
| `lib.rs` | `RefineSessionManager` → `SkillSessionManager` |
| `commands/skill/crud.rs` | `RefineSessionManager` → `SkillSessionManager` |
| `commands/refine/output.rs` | `RefineSessionManager` → `SkillSessionManager` |
| `commands/refine/tests.rs` | `build_refine_openhands_config` → `build_skill_session_config` |
| `skill_session.rs` unit tests | test function names updated to match renamed helpers |

## What doesn't change

All Tauri command names, IPC contracts, frontend code, agent behavior, and runtime semantics are unchanged. This is a pure structural refactor. The one functional change is that `dispatch_persistent_skill_turn` now calls `ensure_openhands_server` (via `ensure_skill_session`) before starting a session — correcting a pre-existing gap, not changing intended behavior.

## Follow-on work (out of scope)

- Remove `workflow_session_id` from `OpenHandsRuntimeConfig` and the contracts layer (requires codegen).
- PR 2: simplify `leaveCurrentSkill` to remove `stopOpenHandsServer` (server stays alive between skill sessions).

# Skill Creator Config Unification: Implementation Spec

Implementation spec for the PR that creates `agents/skill_creator.rs` (Layer 2)
and cleans up the diverged Layer 3 callers. See
[implementation-gaps.md](implementation-gaps.md) Gaps 1–5 for the gap context.

## Layer 2: `agents/skill_creator.rs` (new file)

This is the only file allowed to know about the skill-creator agent's
configuration. No deps on `commands::` — imports only from
`agents/openhands_server/`, `agents/runtime_config`, and `skill_paths`.

### `SKILL_CREATOR_USER_SUFFIX`

Moves here from `commands/refine/mod.rs`.

### `SkillCreatorConfigParams`

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

`workflow_session_id` is intentionally absent. Cost and usage queries group by
`skill_name + step_id` — a per-invocation session ID adds no query value.

### `build_skill_creator_config`

```rust
pub fn build_skill_creator_config(params: SkillCreatorConfigParams<'_>) -> OpenHandsRuntimeConfig
```

Derives `workspace_run_dir` from `workspace_skill_dir(workspace_path, plugin_slug, skill_name)`,
sets `agent_name: "skill-creator"`, applies `SKILL_CREATOR_USER_SUFFIX`, and
delegates to `build_openhands_runtime_config`. This is the only place in the
codebase that constructs a skill-creator config.

### `ensure_skill_session`

```rust
pub async fn ensure_skill_session(
    app: &tauri::AppHandle,
    config: OpenHandsRuntimeConfig,
    saved_conversation_id: Option<String>,
) -> Result<String, String>
```

Wraps `ensure_openhands_server` + `start_openhands_session` in the correct
sequence. All callers (workspace and workflow) use this instead of calling
`start_openhands_session` directly.

## Layer 3: `commands/skill_session.rs`

Renames (no behavior change):

| Old | New |
|---|---|
| `RefineSession` | `SkillSession` |
| `RefineSessionManager` | `SkillSessionManager` |
| `refine_session_key` | `skill_session_key` |
| `upsert_refine_session` | `upsert_skill_session` |
| `remove_refine_sessions_for_skill` | `remove_skill_sessions` |
| `restore_refine_conversation_state` | `restore_skill_conversation_state` |

`ensure_skill_runtime_ready` (renamed from `ensure_refine_runtime_ready`) stays
here — it has app-layer deps: `commands::workflow::read_initialized_runtime_context`,
`commands::workflow::ensure_workspace_prompts`, and
`commands::refine::protocol::ensure_skill_workspace_dir`.

`build_skill_session_config` replaces `build_refine_openhands_config`. It is a
thin wrapper over `skill_creator::build_skill_creator_config` with
workspace-fixed params: `task_kind: "refine"`, `step_id: -10`,
`allowed_tools: ["file_editor", "terminal"]`, `max_turns: 500`,
`run_source: "refine"`.

`select_skill_openhands_session` calls `skill_creator::ensure_skill_session`
instead of the current `ensure_openhands_server` + `start_openhands_session`
sequence.

## Layer 3: `commands/workflow/runtime.rs`

Delete `SkillCreatorWorkflowConfigParams` and
`build_skill_creator_workflow_runtime_config`.

The five step-specific builders remain as thin wrappers over
`skill_creator::build_skill_creator_config`:

- `build_workflow_research_runtime_config`
- `build_workflow_detailed_research_runtime_config`
- `build_workflow_confirm_decisions_runtime_config`
- `build_workflow_generate_skill_runtime_config`
- `build_answer_evaluator_runtime_config`

`dispatch_persistent_skill_turn` calls `skill_creator::ensure_skill_session`
instead of `start_openhands_session` directly.

## Layer 3: `commands/refine/mod.rs`

Delete: `ensure_refine_runtime_ready`, `build_refine_openhands_config`,
`SKILL_CREATOR_USER_SUFFIX`.

Update re-exports: `RefineSession` → `SkillSession`,
`RefineSessionManager` → `SkillSessionManager`,
`refine_session_key` → `skill_session_key`.

## Callers updated across the codebase

| File | Change |
|---|---|
| `lib.rs` | `RefineSessionManager` → `SkillSessionManager` |
| `commands/skill/crud.rs` | `RefineSessionManager` → `SkillSessionManager` |
| `commands/refine/output.rs` | `RefineSessionManager` → `SkillSessionManager` |
| `commands/refine/tests.rs` | `build_refine_openhands_config` → `build_skill_session_config` |
| `skill_session.rs` unit tests | test function names updated to match renamed helpers |

## What doesn't change

All Tauri command names, IPC contracts, frontend code, agent behavior, and
runtime semantics are unchanged. This is a pure structural refactor. The one
functional change is that `dispatch_persistent_skill_turn` now calls
`ensure_openhands_server` (via `ensure_skill_session`) — correcting a
pre-existing gap, not changing intended behavior.

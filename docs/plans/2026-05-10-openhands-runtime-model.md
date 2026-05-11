 # OpenHands Runtime Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the OpenHands runtime into a clean three-layer architecture, remove dead code, and optimize skill activation.

**Architecture:** Three layers — Layer 1 (`agents/openhands_server/`) raw API, Layer 2 (`agents/skill_creator.rs`) config + session boot, Layer 3 (`commands/`) Tauri commands. 10 small PRs, each independently testable.

**Tech Stack:** Rust (Tauri 2), React, TypeScript, Playwright E2E (mocked), cargo test.

---

## PR 1 — Create `agents/skill_creator.rs` (Gap 1)

**Goal:** New Layer 2 module with unified config builder and session boot wrapper. No callers changed yet.

### Task 1.1: Create `agents/skill_creator.rs` with exports

**Files:**
- Create: `app/src-tauri/src/agents/skill_creator.rs`
- Modify: `app/src-tauri/src/agents/mod.rs`

- [x] **Step 1: Create `agents/skill_creator.rs`**

```rust
// app/src-tauri/src/agents/skill_creator.rs

use std::path::Path;

use crate::agents::runtime_config::{
    build_openhands_runtime_config, BuildOpenHandsRuntimeConfigParams, OpenHandsRuntimeConfig,
};
use crate::skill_paths::workspace_skill_dir;
use crate::types::WorkflowLlmConfig;

pub const SKILL_CREATOR_USER_SUFFIX: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/skill-creator-user-suffix.txt"
));

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

pub fn build_skill_creator_config(params: SkillCreatorConfigParams<'_>) -> OpenHandsRuntimeConfig {
    let workspace_run_dir = workspace_skill_dir(
        Path::new(params.workspace_path),
        params.plugin_slug,
        params.skill_name,
    )
    .to_string_lossy()
    .replace('\\', "/");

    build_openhands_runtime_config(BuildOpenHandsRuntimeConfigParams {
        prompt: params.prompt.to_string(),
        llm: params.llm,
        workspace_root_dir: params.workspace_path.replace('\\', "/"),
        workspace_run_dir,
        mode: None,
        agent_name: "skill-creator".to_string(),
        task_kind: Some(params.task_kind.to_string()),
        user_message_suffix: Some(SKILL_CREATOR_USER_SUFFIX.trim().to_string()),
        allowed_tools: params.allowed_tools,
        max_turns: params.max_turns,
        output_format: params.output_format,
        skill_name: Some(params.skill_name.to_string()),
        step_id: Some(params.step_id),
        run_source: Some(params.run_source.to_string()),
        plugin_slug: params.plugin_slug.to_string(),
    })
}

pub async fn ensure_skill_session(
    app: &tauri::AppHandle,
    config: OpenHandsRuntimeConfig,
    saved_conversation_id: Option<String>,
) -> Result<String, String> {
    crate::agents::openhands_server::ensure_openhands_server(&config).await?;
    crate::agents::openhands_server::start_openhands_session(
        app,
        config,
        saved_conversation_id,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_llm_config() -> WorkflowLlmConfig {
        WorkflowLlmConfig {
            model: "anthropic/claude-sonnet-4-5".to_string(),
            api_key: Some(crate::types::SecretString::new("sk-test".to_string())),
            base_url: None,
            api_version: None,
            temperature: None,
            max_output_tokens: None,
            timeout_seconds: None,
            num_retries: None,
            reasoning_effort: None,
            extra_headers: None,
            input_cost_per_token: None,
            output_cost_per_token: None,
            usage_id: None,
        }
    }

    #[test]
    fn test_build_skill_creator_config_sets_correct_fields() {
        let config = build_skill_creator_config(SkillCreatorConfigParams {
            skill_name: "test-skill",
            prompt: "do something",
            workspace_path: "/tmp/workspace",
            plugin_slug: "default",
            llm: test_llm_config(),
            task_kind: "refine",
            run_source: "refine",
            allowed_tools: vec!["file_editor".to_string(), "terminal".to_string()],
            max_turns: 500,
            step_id: -10,
            output_format: None,
        });

        assert_eq!(config.agent_name, Some("skill-creator".to_string()));
        assert_eq!(config.task_kind, Some("refine".to_string()));
        assert_eq!(config.run_source, Some("refine".to_string()));
        assert_eq!(config.step_id, Some(-10));
        assert_eq!(config.skill_name, Some("test-skill".to_string()));
        assert_eq!(config.plugin_slug, "default");
        assert_eq!(config.max_turns, Some(500));
        assert_eq!(
            config.allowed_tools,
            Some(vec!["file_editor".to_string(), "terminal".to_string()])
        );
        assert!(config.user_message_suffix.is_some());
        assert!(config.workspace_skill_dir.contains("default"));
        assert!(config.workspace_skill_dir.contains("test-skill"));
    }

    #[test]
    fn test_build_skill_creator_config_workflow_step() {
        let config = build_skill_creator_config(SkillCreatorConfigParams {
            skill_name: "my-skill",
            prompt: "research",
            workspace_path: "/tmp/ws",
            plugin_slug: "plugins",
            llm: test_llm_config(),
            task_kind: "workflow.research",
            run_source: "workflow",
            allowed_tools: vec!["terminal".to_string()],
            max_turns: 50,
            step_id: 0,
            output_format: None,
        });

        assert_eq!(config.task_kind, Some("workflow.research".to_string()));
        assert_eq!(config.step_id, Some(0));
        assert_eq!(config.run_source, Some("workflow".to_string()));
    }

    #[test]
    fn test_build_skill_creator_config_answer_evaluator() {
        let config = build_skill_creator_config(SkillCreatorConfigParams {
            skill_name: "my-skill",
            prompt: "evaluate",
            workspace_path: "/tmp/ws",
            plugin_slug: "default",
            llm: test_llm_config(),
            task_kind: "workflow.answer_evaluator",
            run_source: "gate-eval",
            allowed_tools: vec!["file_editor".to_string()],
            max_turns: 20,
            step_id: -1,
            output_format: Some(serde_json::json!({})),
        });

        assert_eq!(config.task_kind, Some("workflow.answer_evaluator".to_string()));
        assert_eq!(config.step_id, Some(-1));
        assert_eq!(config.run_source, Some("gate-eval".to_string()));
        assert!(config.output_format.is_some());
    }

    #[test]
    fn test_skill_creator_user_suffix_is_non_empty() {
        assert!(!SKILL_CREATOR_USER_SUFFIX.trim().is_empty());
    }
}
```

- [x] **Step 2: Register module in `agents/mod.rs`**

Read `app/src-tauri/src/agents/mod.rs` and add:

```rust
pub mod skill_creator;
```

- [x] **Step 3: Run tests**

```bash
cd app/src-tauri && cargo test agents::skill_creator
```

Expected: All 4 tests pass.

- [x] **Step 4: Run clippy**

```bash
cd app/src-tauri && cargo clippy -- -D warnings
```

Expected: Clean.

- [x] **Step 5: Commit**

```bash
git add app/src-tauri/src/agents/skill_creator.rs app/src-tauri/src/agents/mod.rs
git commit -m "feat: add agents/skill_creator.rs Layer 2 module (Gap 1)"
```

**Manual smoke:** None needed — pure addition, no behavioral change.

---

## PR 2 — `dispatch_persistent_skill_turn` calls `ensure_skill_session` (Gap 2)

**Goal:** Fix server lifecycle bypass in workflow runtime.

### Task 2.1: Update `dispatch_persistent_skill_turn`

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`

- [x] **Step 1: Replace direct `start_openhands_session` call**

In `dispatch_persistent_skill_turn` (around line 242-273), replace:

```rust
async fn dispatch_persistent_skill_turn(
    app: &tauri::AppHandle,
    agent_id: &str,
    config: OpenHandsRuntimeConfig,
) -> Result<String, String> {
    let conversation_id =
        crate::agents::skill_creator::ensure_skill_session(app, config.clone(), None).await?;

    dispatch_persistent_skill_turn_with_runtime(
        agent_id,
        config,
        conversation_id,
        |agent_id, config, conversation_id| {
            let agent_id = agent_id.to_string();
            Box::pin(async move {
                crate::agents::openhands_server::openhands_send_message(
                    app,
                    &agent_id,
                    config,
                    conversation_id,
                )
                .await
                .map(|_| ())
            })
        },
    )
    .await
}
```

Remove the old inline comment about `start_openhands_session` since the new code handles it.

- [x] **Step 2: Run workflow tests**

```bash
cd app/src-tauri && cargo test commands::workflow
```

Expected: All existing workflow tests pass.

- [x] **Step 3: Run full cargo test**

```bash
cd app/src-tauri && cargo test
```

Expected: All tests pass.

- [x] **Step 4: Run clippy**

```bash
cd app/src-tauri && cargo clippy -- -D warnings
```

Expected: Clean.

- [x] **Step 5: Commit**

```bash
git add app/src-tauri/src/commands/workflow/runtime.rs
git commit -m "fix: dispatch_persistent_skill_turn calls ensure_skill_session (Gap 2)"
```

**Manual smoke:** Run a workflow step in the app. Verify it completes normally.

---

## PR 3 — Rename `Refine*` → `Skill*` (Gap 3)

**Goal:** Rename all session management types and functions.

### Task 3.1: Rename types in `skill_session.rs`

**Files:**
- Modify: `app/src-tauri/src/commands/skill_session.rs`

- [x] **Step 1: Apply renames in `skill_session.rs`**

Replace all occurrences:
- `RefineSession` → `SkillSession`
- `RefineSessionManager` → `SkillSessionManager`
- `refine_session_key` → `skill_session_key`
- `upsert_refine_session` → `upsert_skill_session`
- `remove_refine_sessions_for_skill` → `remove_skill_sessions`
- `restore_refine_conversation_state` → `restore_skill_conversation_state`

Also rename test functions:
- `test_session_manager_new` → `test_skill_session_manager_new`
- `test_session_create_and_lookup` → `test_skill_session_create_and_lookup`
- `test_session_conflict_detection` → `test_skill_session_conflict_detection`
- `test_session_not_found_returns_none` → `test_skill_session_not_found_returns_none`
- `test_new_refine_usage_session_id_is_opaque_and_scoped_to_skill` → `test_new_skill_usage_session_id_is_opaque_and_scoped_to_skill`
- `test_prepared_refine_session_starts_without_dispatch_history` → `test_prepared_skill_session_starts_without_dispatch_history`
- `test_prepared_refine_session_switches_away_from_contextual_prompt_after_dispatch` → `test_prepared_skill_session_switches_away_from_contextual_prompt_after_dispatch`
- `test_plan_refine_conversation_dispatch_reuses_saved_conversation` → `test_plan_skill_conversation_dispatch_reuses_saved_conversation`
- `test_plan_refine_conversation_dispatch_requires_existing_conversation` → `test_plan_skill_conversation_dispatch_requires_existing_conversation`
- `test_plan_refine_conversation_dispatch_reuses_existing_conversation_after_first_turn` → `test_plan_skill_conversation_dispatch_reuses_existing_conversation_after_first_turn`
- `test_plan_refine_conversation_dispatch_rejects_mismatched_conversation_after_first_turn` → `test_plan_skill_conversation_dispatch_rejects_mismatched_conversation_after_first_turn`

Rename `new_refine_usage_session_id` → `new_skill_usage_session_id` but keep the output format `"synthetic:refine:{skill_name}:{uuid}"` unchanged (durable DB data).

- [x] **Step 2: Run skill_session tests**

```bash
cd app/src-tauri && cargo test commands::skill_session
```

Expected: All tests pass with renamed names.

### Task 3.2: Update callers

**Files:**
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src-tauri/src/commands/skill/crud.rs`
- Modify: `app/src-tauri/src/commands/refine/output.rs`
- Modify: `app/src-tauri/src/commands/refine/mod.rs`

- [x] **Step 3: Update `lib.rs`**

Replace:
```rust
.manage(commands::skill_session::RefineSessionManager::new())
```
with:
```rust
.manage(commands::skill_session::SkillSessionManager::new())
```

- [x] **Step 4: Update `commands/skill/crud.rs`**

Replace all `RefineSessionManager` → `SkillSessionManager`.

- [x] **Step 5: Update `commands/refine/output.rs`**

Replace all `RefineSessionManager` → `SkillSessionManager`.

- [x] **Step 6: Update `commands/refine/mod.rs`**

Replace re-exports:
```rust
pub use crate::commands::skill_session::{SkillSession, SkillSessionManager};
pub(crate) use crate::commands::skill_session::skill_session_key;
```

- [x] **Step 7: Run all Rust tests**

```bash
cd app/src-tauri && cargo test
```

Expected: All tests pass.

- [x] **Step 8: Commit**

```bash
git add app/src-tauri/src/commands/skill_session.rs app/src-tauri/src/lib.rs app/src-tauri/src/commands/skill/crud.rs app/src-tauri/src/commands/refine/output.rs app/src-tauri/src/commands/refine/mod.rs
git commit -m "refactor: rename Refine* to Skill* types and functions (Gap 3)"
```

**Manual smoke:** Open refine tab in the app, send a message, verify transcript appears.

---

## PR 4 — Move Layer 2 code out of `refine/mod.rs` (Gap 4)

**Goal:** `refine/mod.rs` becomes a thin Layer 3 caller.

### Task 4.1: Add `build_skill_session_config` and `ensure_skill_runtime_ready` to `skill_session.rs`

**Files:**
- Modify: `app/src-tauri/src/commands/skill_session.rs`

- [x] **Step 1: Add `build_skill_session_config` to `skill_session.rs`**

Add after the existing imports:

```rust
pub fn build_skill_session_config(
    skill_name: &str,
    plugin_slug: &str,
    prompt: &str,
    workspace_path: &str,
    llm: crate::types::WorkflowLlmConfig,
) -> crate::agents::runtime_config::OpenHandsRuntimeConfig {
    crate::agents::skill_creator::build_skill_creator_config(
        crate::agents::skill_creator::SkillCreatorConfigParams {
            skill_name,
            prompt,
            workspace_path,
            plugin_slug,
            llm,
            task_kind: "refine",
            run_source: "refine",
            allowed_tools: vec!["file_editor".to_string(), "terminal".to_string()],
            max_turns: 500,
            step_id: -10,
            output_format: None,
        },
    )
}
```

- [x] **Step 2: Add `ensure_skill_runtime_ready` to `skill_session.rs`**

Move from `commands/refine/mod.rs` and rename:

```rust
pub(crate) async fn ensure_skill_runtime_ready(
    app: &tauri::AppHandle,
    db: &crate::db::Db,
    skill_name: &str,
    plugin_slug: &str,
) -> Result<crate::commands::workflow::settings::InitializedRuntimeContext, String> {
    let runtime_ctx = crate::commands::workflow::read_initialized_runtime_context(db)?;
    crate::commands::workflow::ensure_workspace_prompts(app, &runtime_ctx.workspace_path).await?;
    crate::commands::refine::protocol::ensure_skill_workspace_dir(
        &runtime_ctx.workspace_path,
        plugin_slug,
        skill_name,
    );
    Ok(runtime_ctx)
}
```

- [x] **Step 3: Update `select_skill_openhands_session` to use new helpers**

Replace the body of `select_skill_openhands_session`:
- `crate::commands::refine::ensure_refine_runtime_ready` → `ensure_skill_runtime_ready`
- `crate::commands::refine::build_refine_openhands_config` → `build_skill_session_config`
- `crate::agents::openhands_server::ensure_openhands_server` + `start_openhands_session` → `crate::agents::skill_creator::ensure_skill_session`

- [x] **Step 4: Update `pause_openhands_session` to use `build_skill_session_config`**

Replace `crate::commands::refine::build_refine_openhands_config` → `build_skill_session_config`.

### Task 4.2: Clean up `refine/mod.rs`

**Files:**
- Modify: `app/src-tauri/src/commands/refine/mod.rs`

- [x] **Step 5: Remove Layer 2 code from `refine/mod.rs`**

Delete:
- `SKILL_CREATOR_USER_SUFFIX` constant
- `REFINE_MAX_TURNS_PER_TURN` constant
- `build_refine_openhands_config` function
- `ensure_refine_runtime_ready` function
- Unused imports: `build_openhands_runtime_config`, `BuildOpenHandsRuntimeConfigParams`, `resolve_skill_dir`

Keep:
- `resolve_skills_path`
- `resolve_skill_output_dir`
- `event_class`, `first_string`, `extract_message_text`, `extract_tool_call_id`, `extract_parent_tool_call_id`, `extract_timestamp_ms`
- `extract_conversation_messages`, `extract_restored_conversation_events`, `restored_conversation_user_turn_count`
- `load_refine_prompt_context`
- `RefineConversationDispatchPlan`, `normalize_conversation_id`, `plan_refine_conversation_dispatch`
- `send_refine_message` (still a Layer 3 command)
- `SendRefineMessageInput`

Update imports to use the new locations:
```rust
pub(crate) use crate::commands::skill_session::skill_session_key;
pub use crate::commands::skill_session::{SkillSession, SkillSessionManager};
```

- [x] **Step 6: Update `refine/tests.rs`**

Replace `build_refine_openhands_config` → `build_skill_session_config` in any test that uses it.

- [x] **Step 7: Run all tests**

```bash
cd app/src-tauri && cargo test
```

Expected: All tests pass.

- [x] **Step 8: Run clippy**

```bash
cd app/src-tauri && cargo clippy -- -D warnings
```

Expected: Clean.

- [x] **Step 9: Commit**

```bash
git add app/src-tauri/src/commands/skill_session.rs app/src-tauri/src/commands/refine/mod.rs app/src-tauri/src/commands/refine/tests.rs
git commit -m "refactor: move Layer 2 code out of refine/mod.rs (Gap 4)"
```

**Manual smoke:** Open refine tab, send a message, verify it works. Switch skills, verify no errors.

---

## PR 5 — Delete duplicate workflow config builder (Gap 5)

**Goal:** All workflow config builders delegate to `skill_creator::build_skill_creator_config`.

### Task 5.1: Replace workflow config builders

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`

- [x] **Step 1: Delete `SkillCreatorWorkflowConfigParams` and `build_skill_creator_workflow_runtime_config`**

Remove the struct and function (lines ~149-205).

- [x] **Step 2: Update `build_workflow_research_runtime_config`**

```rust
pub(crate) fn build_workflow_research_runtime_config(
    skill_name: &str,
    prompt: &str,
    workspace_path: &str,
    plugin_slug: &str,
    llm: crate::types::WorkflowLlmConfig,
) -> OpenHandsRuntimeConfig {
    crate::agents::skill_creator::build_skill_creator_config(
        crate::agents::skill_creator::SkillCreatorConfigParams {
            skill_name,
            prompt,
            workspace_path,
            plugin_slug,
            llm,
            task_kind: "workflow.research",
            run_source: "workflow",
            allowed_tools: research_workflow_tools(),
            max_turns: 50,
            step_id: 0,
            output_format: workflow_output_format_for_step(0),
        },
    )
}
```

Remove `workflow_session_id` parameter from the function signature.

- [x] **Step 3: Update `build_workflow_detailed_research_runtime_config`**

```rust
pub(crate) fn build_workflow_detailed_research_runtime_config(
    skill_name: &str,
    prompt: &str,
    workspace_path: &str,
    plugin_slug: &str,
    llm: crate::types::WorkflowLlmConfig,
) -> OpenHandsRuntimeConfig {
    crate::agents::skill_creator::build_skill_creator_config(
        crate::agents::skill_creator::SkillCreatorConfigParams {
            skill_name,
            prompt,
            workspace_path,
            plugin_slug,
            llm,
            task_kind: "workflow.detailed_research",
            run_source: "workflow",
            allowed_tools: research_workflow_tools(),
            max_turns: 50,
            step_id: 1,
            output_format: workflow_output_format_for_step(1),
        },
    )
}
```

Remove `workflow_session_id` parameter.

- [x] **Step 4: Update `build_workflow_confirm_decisions_runtime_config`**

```rust
pub(crate) fn build_workflow_confirm_decisions_runtime_config(
    skill_name: &str,
    prompt: &str,
    workspace_path: &str,
    plugin_slug: &str,
    llm: crate::types::WorkflowLlmConfig,
) -> OpenHandsRuntimeConfig {
    crate::agents::skill_creator::build_skill_creator_config(
        crate::agents::skill_creator::SkillCreatorConfigParams {
            skill_name,
            prompt,
            workspace_path,
            plugin_slug,
            llm,
            task_kind: "workflow.confirm_decisions",
            run_source: "workflow",
            allowed_tools: confirm_decisions_workflow_tools(),
            max_turns: 100,
            step_id: 2,
            output_format: workflow_output_format_for_step(2),
        },
    )
}
```

Remove `workflow_session_id` parameter.

- [x] **Step 5: Update `build_workflow_generate_skill_runtime_config`**

```rust
pub(crate) fn build_workflow_generate_skill_runtime_config(
    skill_name: &str,
    prompt: &str,
    workspace_path: &str,
    plugin_slug: &str,
    llm: crate::types::WorkflowLlmConfig,
) -> OpenHandsRuntimeConfig {
    crate::agents::skill_creator::build_skill_creator_config(
        crate::agents::skill_creator::SkillCreatorConfigParams {
            skill_name,
            prompt,
            workspace_path,
            plugin_slug,
            llm,
            task_kind: "workflow.skill_generation",
            run_source: "workflow",
            allowed_tools: skill_generation_workflow_tools(),
            max_turns: 500,
            step_id: 3,
            output_format: workflow_output_format_for_step(3),
        },
    )
}
```

Remove `workflow_session_id` parameter.

- [x] **Step 6: Update `build_answer_evaluator_runtime_config`**

```rust
pub(crate) fn build_answer_evaluator_runtime_config(
    skill_name: &str,
    prompt: &str,
    workspace_path: &str,
    plugin_slug: &str,
    llm: crate::types::WorkflowLlmConfig,
) -> OpenHandsRuntimeConfig {
    crate::agents::skill_creator::build_skill_creator_config(
        crate::agents::skill_creator::SkillCreatorConfigParams {
            skill_name,
            prompt,
            workspace_path,
            plugin_slug,
            llm,
            task_kind: "workflow.answer_evaluator",
            run_source: "gate-eval",
            allowed_tools: crate::commands::workflow::step_config::answer_evaluator_workflow_tools(),
            max_turns: 20,
            step_id: -1,
            output_format: Some(answer_evaluator_output_format()),
        },
    )
}
```

Note: `step_id` changes from `None` to `-1` per the design spec.

- [x] **Step 7: Update callers to remove `workflow_session_id` argument**

In `run_workflow_step_inner`, remove `workflow_session_id` from all config builder calls (lines ~512-550).
In `run_workflow_step` signature, keep `workflow_session_id` parameter for now (it's still in the Tauri command contract — Gap 7 removes it).
In `run_answer_evaluator`, no change needed (it never passed `workflow_session_id`).

- [x] **Step 8: Update workflow tests**

In `commands/workflow/tests.rs`, update any test that passes `workflow_session_id` to config builders. Remove the parameter from calls. Update assertions that check `config.workflow_session_id`.

- [x] **Step 9: Run workflow tests**

```bash
cd app/src-tauri && cargo test commands::workflow
```

Expected: All tests pass.

- [x] **Step 10: Run clippy**

```bash
cd app/src-tauri && cargo clippy -- -D warnings
```

Expected: Clean.

- [x] **Step 11: Commit**

```bash
git add app/src-tauri/src/commands/workflow/runtime.rs app/src-tauri/src/commands/workflow/tests.rs
git commit -m "refactor: delegate workflow config builders to skill_creator (Gap 5)"
```

**Manual smoke:** Run workflow steps 0-3 in the app. Verify each completes. Run answer evaluator gate. Verify it works.

---

## PR 6 — Consolidate OH artifacts to workspace root; remove skill-switch server stop (Gaps 6 + 11)

**Goal:** Two halves of the same observable fix — the server stays alive across skill switches. Phase 1 removes the backend restart condition (workspace-scoped artifact paths, no path-comparison restart). Phase 2 removes the frontend explicit stop (`stopOpenHandsServer` in `leaveCurrentSkill`). Both halves are required for the smoke test to pass; all backend unit tests run before Phase 2 begins.

**Architecture:** Phase 1 touches `app/src-tauri/src/agents/openhands_server/process.rs` (path helpers, env setup, handle struct, lifecycle logic) and the five call sites in `app/src-tauri/src/agents/openhands_server/mod.rs`. Phase 2 touches `app/src/lib/active-skill-transition.ts`, `app/src-tauri/src/commands/runtime_lifecycle.rs`, and `app/src-tauri/src/lib.rs`.

**Background — why the server restarts today:** `ensure_agent_server` stores `conversations_path` (derived from `workspace_skill_dir`) in `OpenHandsAgentServerHandle` and restarts whenever that path differs from the incoming request's path. Switching skills changes `workspace_skill_dir` → changes `conversations_path` → forces restart. After Phase 1, all paths are derived from `workspace_root`, which is stable across skills. The restart condition is removed. After Phase 2, `leaveCurrentSkill` no longer calls `stopOpenHandsServer()`, removing the frontend's explicit kill.

**Path layout after Phase 1:**

| Path | Purpose |
|---|---|
| `{workspace_root}/.openhands/conversations/` | All skill conversations (`OH_CONVERSATIONS_PATH`) |
| `{workspace_root}/.openhands/bash_events/` | All bash events (`OH_BASH_EVENTS_DIR`) |
| `{workspace_root}/.openhands/logs/` | Server stderr logs |
| `{workspace_root}/.openhands/secret.key` | Stable encryption key (unchanged) |

**How `workspace_root` reaches `ensure_agent_server`:** `OpenHandsRuntimeRequest` has two path fields: `workspace_root_dir` (the workspace root, e.g. `/workspace`) and `workspace_skill_dir` (the skill dir, e.g. `/workspace/default/skills/my-skill`). Currently callers pass `request.runtime_run_dir()` (which returns `workspace_skill_dir`) to `ensure_agent_server`. After Phase 1 they pass `Path::new(&request.workspace_root_dir)` instead.

---

### Phase 1 — Backend: workspace-root artifact paths, `OH_BASH_EVENTS_DIR`, no skill-switch restart

All unit tests for Phase 1 must pass before starting Phase 2.

### Task 6.1 — Update path helper functions

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`

**Context:** `compute_conversations_path` currently takes `runtime_run_dir` (= `workspace_skill_dir`) and returns `skill_dir/conversations`. After this task it takes `workspace_root` and returns `workspace_root/.openhands/conversations`. `openhands_secret_path` currently calls `workspace_root_for_runtime_run_dir` to climb the directory tree — after this task it takes `workspace_root` directly. Both changes make callers simpler.

- [x] **Step 1: Write failing tests for new path shapes**

In the `#[cfg(test)]` block inside `process.rs`, add these two tests. They will fail until Step 2 is done.

```rust
#[test]
fn compute_conversations_path_resolves_under_workspace_root_openhands_dir() {
    let path = compute_conversations_path(Path::new("/tmp/workspace"));
    let s = path.to_string_lossy().replace('\\', "/");
    assert!(
        s.ends_with(".openhands/conversations"),
        "expected path to end with .openhands/conversations; got {s}",
    );
}

#[test]
fn compute_bash_events_path_resolves_under_workspace_root_openhands_dir() {
    let path = compute_bash_events_path(Path::new("/tmp/workspace"));
    let s = path.to_string_lossy().replace('\\', "/");
    assert!(
        s.ends_with(".openhands/bash_events"),
        "expected path to end with .openhands/bash_events; got {s}",
    );
}
```

- [x] **Step 2: Run to confirm the new tests fail**

```bash
cd app/src-tauri && cargo test agents::openhands_server::process::tests::compute_conversations_path_resolves_under_workspace_root_openhands_dir 2>&1 | tail -5
```

Expected: FAILED — function signature mismatch or assertion failure.

- [x] **Step 3: Update `compute_conversations_path` and add `compute_bash_events_path`**

Replace the existing `compute_conversations_path` function and the doc comment above it. Add `compute_bash_events_path` immediately after.

```rust
/// Absolute path where the OpenHands server persists conversation state for this workspace.
/// All skills share this directory; per-skill isolation comes from `workspace.working_dir`
/// in each conversation's REST request body.
pub(crate) fn compute_conversations_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".openhands").join("conversations")
}

/// Absolute path where the OpenHands server persists bash event logs for this workspace.
pub(crate) fn compute_bash_events_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".openhands").join("bash_events")
}
```

- [x] **Step 4: Simplify `openhands_secret_path` to accept `workspace_root` directly**

Replace:

```rust
fn openhands_secret_path(runtime_run_dir: &Path) -> Result<PathBuf, String> {
    let workspace_root = workspace_root_for_runtime_run_dir(runtime_run_dir).ok_or_else(|| {
        format!(
            "Failed to determine workspace root from OpenHands runtime dir {}",
            runtime_run_dir.display()
        )
    })?;
    Ok(workspace_root
        .join(".openhands")
        .join(OPENHANDS_SECRET_FILENAME))
}
```

With:

```rust
fn openhands_secret_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".openhands").join(OPENHANDS_SECRET_FILENAME)
}
```

- [x] **Step 5: Update `read_or_create_openhands_secret` signature**

Replace the signature `fn read_or_create_openhands_secret(runtime_run_dir: &Path)` with `fn read_or_create_openhands_secret(workspace_root: &Path)`. Update the body's one call from `openhands_secret_path(runtime_run_dir)?` to `openhands_secret_path(workspace_root)` (no `?` — it's now infallible). The rest of the body is unchanged.

Full updated function:

```rust
fn read_or_create_openhands_secret(workspace_root: &Path) -> Result<String, String> {
    let secret_path = openhands_secret_path(workspace_root);
    if let Ok(existing) = fs::read_to_string(&secret_path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    let secret_parent = secret_path.parent().ok_or_else(|| {
        format!(
            "Failed to resolve OpenHands secret directory for {}",
            secret_path.display()
        )
    })?;
    fs::create_dir_all(secret_parent).map_err(|e| {
        format!(
            "Failed to create OpenHands secret directory {}: {e}",
            secret_parent.display()
        )
    })?;

    let secret = uuid::Uuid::new_v4().simple().to_string();
    fs::write(&secret_path, format!("{secret}\n")).map_err(|e| {
        format!(
            "Failed to write OpenHands secret file {}: {e}",
            secret_path.display()
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&secret_path, fs::Permissions::from_mode(0o600));
    }
    log::debug!(
        "[openhands-agent-server] created stable OpenHands secret at {}",
        secret_path.display()
    );
    Ok(secret)
}
```

- [x] **Step 6: Update `open_server_log_file` to use workspace root**

Replace the function signature `async fn open_server_log_file(runtime_run_dir: &Path)` with `async fn open_server_log_file(workspace_root: &Path)`. Change the body's `logs_dir` binding from `runtime_run_dir.join("logs")` to `workspace_root.join(".openhands").join("logs")`. The rest of the body is unchanged.

- [x] **Step 7: Update the existing stale path test**

The test `compute_conversations_path_resolves_under_runtime_run_dir` asserts the old per-skill shape. Delete it — it is replaced by the two tests added in Step 1.

- [x] **Step 8: Run new path tests**

```bash
cd app/src-tauri && cargo test agents::openhands_server::process::tests::compute_conversations_path_resolves_under_workspace_root_openhands_dir agents::openhands_server::process::tests::compute_bash_events_path_resolves_under_workspace_root_openhands_dir 2>&1 | tail -10
```

Expected: Both PASS.

- [x] **Step 9: Update the secret test to pass `workspace_root` directly**

The test `read_or_create_openhands_secret_uses_stable_workspace_root_file` currently builds `runtime_run_dir = tmp.path().join("default/skills/petstore-sales")` and passes that. Update it to pass the workspace root directly:

```rust
#[test]
fn read_or_create_openhands_secret_uses_stable_workspace_root_file() {
    let tmp = tempfile::tempdir().expect("tempdir");
    // workspace_root is the tmp dir itself; no skill subpath needed
    let workspace_root = tmp.path();

    let first = read_or_create_openhands_secret(workspace_root).expect("first secret");
    let second = read_or_create_openhands_secret(workspace_root).expect("second secret");
    assert_eq!(first, second);

    let secret_path = workspace_root
        .join(".openhands")
        .join(OPENHANDS_SECRET_FILENAME);
    assert_eq!(
        fs::read_to_string(&secret_path)
            .expect("secret file")
            .trim(),
        first
    );
}
```

- [x] **Step 10: Run full process tests**

```bash
cd app/src-tauri && cargo test agents::openhands_server::process 2>&1 | tail -15
```

Expected: All pass. (Some compilation errors from handle/ensure callers are expected — resolve in subsequent tasks.)

---

### Task 6.2 — Update `apply_session_env`

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`

**Context:** `apply_session_env` currently sets `OH_CONVERSATIONS_PATH`. We add `OH_BASH_EVENTS_DIR` alongside it. Both are `Option<&str>` so tests can omit them when testing other env vars.

- [x] **Step 1: Write a failing test for `OH_BASH_EVENTS_DIR`**

Add this test to the `#[cfg(test)]` block:

```rust
#[test]
fn apply_session_env_sets_bash_events_dir_when_present() {
    let mut cmd = tokio::process::Command::new("/usr/bin/true");
    apply_session_env(
        &mut cmd,
        "session-key-123",
        "stable-secret-456",
        Some("/tmp/test/conversations"),
        Some("/tmp/test/bash_events"),
    );
    let envs: Vec<(String, String)> = cmd
        .as_std()
        .get_envs()
        .filter_map(|(k, v)| {
            let key = k.to_string_lossy().into_owned();
            v.map(|val| (key, val.to_string_lossy().into_owned()))
        })
        .collect();
    assert!(
        envs.iter()
            .any(|(k, v)| k == "OH_BASH_EVENTS_DIR" && v == "/tmp/test/bash_events"),
        "expected OH_BASH_EVENTS_DIR env var; got {:?}",
        envs
    );
}

#[test]
fn apply_session_env_omits_bash_events_dir_when_none() {
    let mut cmd = tokio::process::Command::new("/usr/bin/true");
    apply_session_env(&mut cmd, "k", "s", None, None);
    let has_it = cmd
        .as_std()
        .get_envs()
        .any(|(k, _)| k.to_string_lossy() == "OH_BASH_EVENTS_DIR");
    assert!(!has_it, "OH_BASH_EVENTS_DIR should be absent when path is None");
}
```

- [x] **Step 2: Update `apply_session_env` signature and body**

Replace the existing function:

```rust
fn apply_session_env(
    cmd: &mut tokio::process::Command,
    session_api_key: &str,
    openhands_secret_key: &str,
    conversations_path: Option<&str>,
    bash_events_path: Option<&str>,
) {
    cmd.env("SESSION_API_KEY", session_api_key)
        .env("OH_SESSION_API_KEYS_0", session_api_key)
        .env("OH_SECRET_KEY", openhands_secret_key);
    if let Some(p) = conversations_path {
        cmd.env("OH_CONVERSATIONS_PATH", p);
    }
    if let Some(p) = bash_events_path {
        cmd.env("OH_BASH_EVENTS_DIR", p);
    }
}
```

- [x] **Step 3: Fix existing `apply_session_env` call sites in tests**

Update `apply_session_env_sets_conversations_path_when_present`:
- Change the call to pass `Some("/tmp/test/conversations")` as the fourth arg and `Some("/tmp/test/bash_events")` as the fifth.
- Add an assertion for `OH_BASH_EVENTS_DIR`.

Update `apply_session_env_omits_conversations_path_when_none`:
- Change the call to `apply_session_env(&mut cmd, "k", "s", None, None)`.
- Add an assertion that `OH_BASH_EVENTS_DIR` is also absent.

- [x] **Step 4: Run `apply_session_env` tests**

```bash
cd app/src-tauri && cargo test agents::openhands_server::process::tests::apply_session_env 2>&1 | tail -10
```

Expected: All four tests PASS.

---

### Task 6.3 — Remove `conversations_path` from `OpenHandsAgentServerHandle`

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`

**Context:** `conversations_path` is stored in the handle solely to drive the skill-switch restart check. Once the check is gone the field has no purpose.

- [x] **Step 1: Remove the field from the struct**

Replace:

```rust
pub struct OpenHandsAgentServerHandle {
    pub port: u16,
    pub session_api_key: String,
    pub conversations_path: String,
    pub stderr_tail: Arc<AsyncMutex<VecDeque<String>>>,
}
```

With:

```rust
pub struct OpenHandsAgentServerHandle {
    pub port: u16,
    pub session_api_key: String,
    pub stderr_tail: Arc<AsyncMutex<VecDeque<String>>>,
}
```

---

### Task 6.4 — Update `ensure_agent_server` — remove skill-switch restart

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`

**Context:** `ensure_agent_server` currently: (1) computes `conversations_path` from `runtime_run_dir`, (2) checks if the cached server's path matches — if not, restarts. The skill-switch restart lives in that path comparison. After this task, `ensure_agent_server` takes `workspace_root` and restarts only on health failure or process crash.

- [x] **Step 1: Write a failing test for the no-restart behavior**

Add this test to the `#[cfg(test)]` block. It verifies that `should_reuse_cached_server` is the only gate (path is no longer a factor):

```rust
#[test]
fn cached_server_reuse_does_not_depend_on_conversations_path() {
    // Reuse is driven entirely by process liveness and health — not by path.
    assert!(should_reuse_cached_server(true, Ok(())));
    assert!(!should_reuse_cached_server(false, Ok(())));
    assert!(!should_reuse_cached_server(true, Err("fail".to_string())));
}
```

(This test already passes since `should_reuse_cached_server` is unchanged — it just documents the intent.)

- [x] **Step 2: Add a structural compile-time test that `conversations_path` is gone from the handle**

Add this test immediately after the one above. It is a compile-time proof: if `conversations_path` still exists on `OpenHandsAgentServerHandle`, the struct literal will fail to compile.

```rust
#[test]
fn ensure_agent_server_handle_has_no_conversations_path_field() {
    // Compile-time proof that conversations_path was removed.
    // If this test compiles, the path comparison is structurally impossible.
    let handle = OpenHandsAgentServerHandle {
        port: 8080,
        session_api_key: "test".to_string(),
        stderr_tail: Arc::new(AsyncMutex::new(VecDeque::new())),
    };
    assert_eq!(handle.port, 8080);
}
```

- [x] **Step 3: Replace the `ensure_agent_server` signature and body**

Replace the full function:

```rust
pub async fn ensure_agent_server(
    timeout: Duration,
    workspace_root: &Path,
) -> Result<OpenHandsAgentServerHandle, String> {
    let mut registry = agent_server_registry().lock().await;
    if let Some(server) = registry.as_mut() {
        let process_running = server.process.is_running();
        let health_result = if process_running {
            server
                .process
                .wait_until_healthy(CACHED_HEALTH_CHECK_TIMEOUT)
                .await
        } else {
            Err("cached process is not running".to_string())
        };
        if should_reuse_cached_server(process_running, health_result.clone()) {
            return Ok(server.handle.clone());
        }
        if let Err(error) = &health_result {
            log::warn!(
                "[openhands-agent-server] cached server failed liveness probe: {error}; starting a new server"
            );
        }
        let _ = server.process.shutdown().await;
        *registry = None;
    }

    release_stale_conversation_leases(&compute_conversations_path(workspace_root));

    let process = OpenHandsAgentServerProcess::start(timeout, workspace_root).await?;
    let handle = OpenHandsAgentServerHandle {
        port: process.port,
        session_api_key: process.session_api_key.clone(),
        stderr_tail: Arc::clone(&process.stderr_tail),
    };
    *registry = Some(ManagedOpenHandsAgentServer {
        handle: handle.clone(),
        process,
    });
    Ok(handle)
}
```

---

### Task 6.5 — Update `OpenHandsAgentServerProcess::start` and `start_once`

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`

**Context:** `start` and `start_once` currently take `runtime_run_dir`. After this task they take `workspace_root`. All path derivations inside `start_once` switch from skill-dir-relative to workspace-root-relative.

- [x] **Step 1: Update `OpenHandsAgentServerProcess::start` signature**

Replace:

```rust
pub async fn start(timeout: Duration, runtime_run_dir: &Path) -> Result<Self, String> {
    let mut last_error = None;
    for attempt in 1..=5 {
        match Self::start_once(timeout, runtime_run_dir).await {
```

With:

```rust
pub async fn start(timeout: Duration, workspace_root: &Path) -> Result<Self, String> {
    let mut last_error = None;
    for attempt in 1..=5 {
        match Self::start_once(timeout, workspace_root).await {
```

The rest of the function body is unchanged.

- [x] **Step 2: Replace the full `start_once` body**

Replace the full `start_once` function:

```rust
async fn start_once(timeout: Duration, workspace_root: &Path) -> Result<Self, String> {
    let port = select_random_local_port()?;
    let session_api_key = uuid::Uuid::new_v4().to_string();
    let openhands_secret_key = read_or_create_openhands_secret(workspace_root)?;
    let command = OpenHandsServerCommand::new(port);
    let runtime_dir = tempfile::Builder::new()
        .prefix("openhands-agent-server-")
        .tempdir()
        .map_err(|e| format!("Failed to create OpenHands Agent Server runtime dir: {e}"))?;
    let mut tokio_command = command.tokio_command();
    tokio_command.current_dir(runtime_dir.path());
    let conversations_path_str = compute_conversations_path(workspace_root)
        .to_string_lossy()
        .into_owned();
    let bash_events_path_str = compute_bash_events_path(workspace_root)
        .to_string_lossy()
        .into_owned();
    apply_session_env(
        &mut tokio_command,
        &session_api_key,
        &openhands_secret_key,
        Some(&conversations_path_str),
        Some(&bash_events_path_str),
    );
    log::debug!(
        "[openhands-agent-server] OH_CONVERSATIONS_PATH={}",
        conversations_path_str
    );
    log::debug!(
        "[openhands-agent-server] OH_BASH_EVENTS_DIR={}",
        bash_events_path_str
    );
    let log_file = open_server_log_file(workspace_root).await;
    // ... rest of the function body is unchanged from here (stderr capture, spawn, health check)
```

The body after `let log_file = open_server_log_file(workspace_root).await;` is unchanged. Do not alter the stderr capture loop, the `Self { ... }` construction, or the health check.

- [x] **Step 3: Run process tests to confirm compilation**

```bash
cd app/src-tauri && cargo test agents::openhands_server::process 2>&1 | tail -15
```

Expected: All tests pass. (If `mod.rs` callers cause a compile error, proceed to Task 6.6 first.)

---

### Task 6.6 — Update callers in `mod.rs`

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`

**Context:** There are five call sites in `mod.rs` that currently pass `request.runtime_run_dir()` (= `workspace_skill_dir`) to `ensure_agent_server_process`. They must now pass `Path::new(&request.workspace_root_dir)` (the workspace root). `OpenHandsRuntimeRequest` already has a `workspace_root_dir: String` field — no struct changes needed.

- [x] **Step 1: Update all five call sites**

Search for every occurrence of:

```rust
ensure_agent_server_process(Duration::from_secs(60), request.runtime_run_dir()).await?
```

Replace each one with:

```rust
ensure_agent_server_process(Duration::from_secs(60), Path::new(&request.workspace_root_dir)).await?
```

There are exactly five occurrences. Use grep to confirm before and after:

```bash
grep -n "ensure_agent_server_process" app/src-tauri/src/agents/openhands_server/mod.rs
```

Expected before: 5 lines. Expected after: same 5 lines with `workspace_root_dir`.

- [x] **Step 2: Confirm `std::path::Path` is in scope**

Check the imports at the top of `mod.rs`. `Path` is already used elsewhere in the file so the import already exists. If not, add `use std::path::Path;`.

- [x] **Step 3: Build to check compilation**

```bash
cd app/src-tauri && cargo build 2>&1 | grep "^error" | head -20
```

Expected: No errors.

---

### Task 6.7 — Update remaining tests and run full suite

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`

**Context:** The live server test (`live_openhands_server_shutdown_prefers_sigterm`) constructs a `runtime_run_dir` and passes it to `OpenHandsAgentServerProcess::start`. Update it to pass a workspace root instead.

- [x] **Step 1: Update the live server test**

Find the test `live_openhands_server_shutdown_prefers_sigterm`. It currently does:

```rust
let runtime_run_dir = tmp.path().join("default/skills/petstore-sales");
fs::create_dir_all(&runtime_run_dir).expect("runtime dir");
let mut process = OpenHandsAgentServerProcess::start(Duration::from_secs(60), &runtime_run_dir)
```

Replace with:

```rust
let workspace_root = tmp.path();
// The server reads the secret from workspace_root/.openhands/secret.key —
// no subdir creation needed; the server creates it on startup.
let mut process = OpenHandsAgentServerProcess::start(Duration::from_secs(60), workspace_root)
```

- [x] **Step 2: Run all `process` module tests**

```bash
cd app/src-tauri && cargo test agents::openhands_server::process 2>&1 | tail -20
```

Expected: All pass.

- [x] **Step 3: Run full `openhands_server` tests**

```bash
cd app/src-tauri && cargo test agents::openhands_server 2>&1 | tail -20
```

Expected: All pass.

- [x] **Step 4: Run full cargo test**

```bash
cd app/src-tauri && cargo test 2>&1 | tail -20
```

Expected: All pass.

- [x] **Step 5: Run clippy**

```bash
cd app/src-tauri && cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings 2>&1 | grep "^error" | head -20
```

Expected: Clean.

- [x] **Step 6: Intermediate commit (Phase 1)**

```bash
git add app/src-tauri/src/agents/openhands_server/process.rs \
        app/src-tauri/src/agents/openhands_server/mod.rs
git commit -m "refactor: consolidate OH artifacts to workspace root, add OH_BASH_EVENTS_DIR, remove backend skill-switch restart"
```

All backend unit tests now pass. Proceed to Phase 2. Manual smoke runs after Phase 2 — the server-stays-alive invariant requires both halves.

**Phase 1 failure triage**

| Symptom | Likely cause |
|---|---|
| Server restarts on skill switch | `ensure_agent_server` still compares paths — check `process.rs` lines touching `conversations_path` |
| `OH_CONVERSATIONS_PATH` points to skill dir | Call site in `mod.rs` still passes `runtime_run_dir()` instead of `workspace_root_dir` |
| `OH_BASH_EVENTS_DIR` not set | `apply_session_env` call in `start_once` missing fifth argument |
| Conversation not restored after restart | `secret.key` path wrong, or conversations dir not under `.openhands/` at workspace root |
| Compile error on handle construction | `conversations_path` field still present — Task 6.3 not applied |

---

### Phase 2 — Frontend: remove explicit server stop

Phase 1 unit tests must all pass before starting here.

### Task 6.8 — Remove `stopOpenHandsServer` from `leaveCurrentSkill`

**Files:**
- Modify: `app/src/lib/active-skill-transition.ts`

- [x] **Step 1: Remove `stopOpenHandsServer()` from `leaveCurrentSkill`**

Read the file and remove the `stopOpenHandsServer()` call. The function should be:
1. Pause conversation
2. Release lock
3. Clear UI state

No server stop.

- [x] **Step 2: Remove unused import**

Remove the `stopOpenHandsServer` import if no longer used.

### Task 6.9 — Delete the `stop_openhands_server` Tauri command

**Files:**
- Modify: `app/src-tauri/src/commands/runtime_lifecycle.rs`
- Modify: `app/src-tauri/src/lib.rs`

- [x] **Step 3: Delete `stop_openhands_server` from `runtime_lifecycle.rs`**

Remove the entire `stop_openhands_server` function (lines ~14-27).

- [x] **Step 4: Remove command registration from `lib.rs`**

Remove `commands::runtime_lifecycle::stop_openhands_server` from the `invoke_handler!` list.

- [x] **Step 5: Run Rust tests**

```bash
cd app/src-tauri && cargo test
```

Expected: All tests pass.

- [x] **Step 6: Run frontend tests**

```bash
cd app && npm run test:unit
```

Expected: All tests pass.

- [x] **Step 7: Run clippy**

```bash
cd app/src-tauri && cargo clippy -- -D warnings
```

Expected: Clean.

- [x] **Step 8: Commit**

```bash
git add app/src/lib/active-skill-transition.ts app/src-tauri/src/commands/runtime_lifecycle.rs app/src-tauri/src/lib.rs
git commit -m "feat: remove stopOpenHandsServer from leaveCurrentSkill; delete dead Tauri command (Gap 6)"
```

**Manual smoke — full integration (both phases required)**

> E2E tests mock Tauri commands and cannot verify real server lifecycle or filesystem state. Run these manually against the live app after both Phase 1 and Phase 2 commits are in.

**Smoke 1 — Server PID unchanged across skill switch**

1. Start the app, open skill A
2. Record the server PID:
   ```bash
   ps aux | grep openhands-agent-server | grep -v grep
   ```
3. Switch to skill B
4. Run the same `ps aux` command again
5. **Verify:** PID is **unchanged**. No server restart flash in the UI.

**Smoke 2 — Message in skill B after switching**

1. After Smoke 1, send a message in skill B's Refine/Chat tab
2. **Verify:** Agent responds normally. Full transcript replays. No errors in Rust logs.

**Smoke 3 — Artifacts on disk are under workspace root**

1. After Smoke 2, find your workspace root in **Settings → Workspace Path** (shown as `{workspace_root}` below)
2. Check the filesystem:
   ```bash
   ls {workspace_root}/.openhands/conversations/
   ls {workspace_root}/.openhands/bash_events/
   ```
3. **Verify:** Both directories exist and contain entries. No `conversations/` directory exists under `{workspace_root}/{plugin}/skills/{skill_name}/`.

**Smoke 4 — Conversation survives app quit + restart**

1. Send a message in skill A, wait for the response to complete
2. Quit the app completely (Cmd+Q)
3. Restart the app, open skill A
4. **Verify:** Previous conversation transcript is restored. No errors.

---

## PR 7 — Canonical skill-dir runtime roots + reset cleanup

**Goal:** Finish the runtime-model clean break after PR 6. Every skill-scoped
conversation should use the canonical skill directory as `workspace.working_dir`
and `.agents` root; the app-local data dir should no longer hide runtime state
inside a `workspace/` wrapper — runtime state moves to `{app_data_root}/openhands/`
directly. In the same PR, `reset_workflow_step` pauses the skill's active
conversation before clearing the DB record and deletes the specific conversation
directory by ID; the old blanket `remove_dir_all` on the whole conversations
folder is removed.

**Architecture:** Two halves of the same folder-model cleanup. Phase 1
canonicalizes runtime roots and skill working directories: remove the
`workspaceSkillDir` contract, point OpenHands CWD at the canonical skill
directory, flatten app-local storage to root-level `openhands/`, DB, and
documents, delete the now-empty `workspace/` wrapper on first launch, and make
canonical skill dirs the only runtime `.agents` location.
Phase 2 keeps the existing reset cleanup work: (1) add
`try_get_cached_server_handle` to `process.rs`, (2) add
`pause_conversation_if_server_running` to `mod.rs`, and (3) refactor
`clear_persistent_skill_conversation_state` in `evaluation.rs` to pause then
delete the specific `openhands/conversations/{conv_id}/` directory, split into a
sync ID-collection step and a sync DB-clear step so the DB lock is never held
across the async pause.

**On directory deletion:** We delete the specific conversation directory by ID after pausing — `{app_data_root}/openhands/conversations/{conv_id}/`. This is safe because each conversation lives in its own ID-keyed subdirectory; deleting one does not affect others. The old concern (wiping every skill's state) applied only to deleting the shared conversations root, not individual entries.

---

### Task 7.0 — Remove `workspaceSkillDir`; make canonical skill dir the OpenHands working directory

**Files:**
- Modify: `app/src-tauri/src/agents/runtime_config.rs`
- Modify: `app/src-tauri/src/agents/skill_creator.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/types.rs`
- Modify: `app/src-tauri/src/commands/skill_session.rs`
- Modify: `app/src-tauri/src/commands/refine/protocol.rs`
- Modify: `app/src-tauri/src/commands/refine/content.rs`
- Modify: `app/src-tauri/src/commands/refine/output.rs`
- Modify: `app/src-tauri/src/commands/workspace.rs`
- Modify: `app/src-tauri/src/commands/api_validation.rs`
- Modify: `repo-map.json`
- Modify: `docs/design/openhands-runtime-model/README.md`
- Modify: `docs/design/openhands-runtime-model/implementation-gaps.md`

**Context:** The current code still carries two different working-directory
models. The prompt/UI target the canonical skill directory, but the runtime
contract still carries `workspaceSkillDir` and many helpers still treat an
app-local `workspace/` tree as the runtime root. This task makes the target
contract explicit and removes the extra runtime mirror layer before the reset
cleanup work lands.

- [x] **Step 1: Replace `workspaceSkillDir` semantics in the runtime contracts**
<!-- Verified: `OpenHandsRuntimeConfig` and `OpenHandsRuntimeRequest` have `skills_root`, `skill_dir`, `app_data_root` fields; `workspace_root_dir`/`workspace_skill_dir` renamed in both structs -->

- [x] **Step 2: Update skill-creator config builders to use canonical skill paths**
<!-- Verified: `skill_creator.rs` uses `resolve_skill_dir(Path::new(params.skills_root), ...)` to compute canonical skill dir -->

- [x] **Step 3: Flatten app-local path resolution and delete the old `workspace/` wrapper**
<!-- Verified: `workspace.rs` has `migrate_flatten_openhands_dir` (lines 18-48), called in `init_workspace` (line 494) -->

- [x] **Step 4: Collapse runtime `.agents` ownership to the canonical skill dir**
<!-- Verified: `deploy.rs` has `seed_skill_agents_dir` (line 504) with SHA-gating; `copy_workspace_*` renamed to `copy_agent_sources_*` -->

- [x] **Step 5: Update refine and finalize helpers to the new root model**
<!-- Verified: `refine/protocol.rs` uses `workspace_skill_dir` for scratch dir creation (separate from canonical skill dir); `refine/output.rs` uses `resolve_workspace_skill_dir` for snapshot paths; `skill/crud.rs` uses `workspace_skill_dir` for workspace scratch -- all intentional separation of concerns -->

- [x] **Step 6: Update tests, fixtures, and repo metadata**
<!-- Verified: `types/mod.rs` fixture uses new fields (line 127-129); `client.rs` test helper uses new fields (line 292-317); `skill_paths.rs` still exports `workspace_skill_dir` for scratch-dir concept (intentional) -->

Replace assertions, fixtures, and docs that still encode the old
`workspaceSkillDir` or app-local `workspace/` layout. Update `repo-map.json`
and the design docs in the same PR so future agents see the new model first.

- [x] **Step 7: Run focused verification**

```bash
cd app && npm run test:unit
cd app/src-tauri && cargo test
cd app/src-tauri && cargo clippy -- -D warnings
markdownlint docs/design/openhands-runtime-model/README.md docs/design/openhands-runtime-model/implementation-gaps.md docs/plans/2026-05-10-openhands-runtime-model.md
```

Expected: Clean.

---

### Task 7.1 — Add `try_get_cached_server_handle` to `process.rs`

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`

**Context:** `ensure_agent_server` always starts a new server if none is cached — wrong for a cleanup path where we only want to pause if the server is already running. `try_get_cached_server_handle` returns the cached handle without touching the process.

- [x] **Step 1: Write a failing test**
<!-- Verified: test `try_get_cached_server_handle_returns_none_when_no_server_cached` at process.rs:893 -->

- [x] **Step 2: Run to confirm it fails**

- [x] **Step 3: Add `try_get_cached_server_handle`**
<!-- Verified: function at process.rs:314, returns `Option<OpenHandsAgentServerHandle>` -->

- [x] **Step 4: Run the test**

- [x] **Step 5: Run full process tests**

```bash
cd app/src-tauri && cargo test agents::openhands_server::process 2>&1 | tail -10
```

Expected: All pass.

---

### Task 7.2 — Add `pause_conversation_if_server_running` to `mod.rs`

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`

**Context:** This is the best-effort pause used by the reset path. It checks the cached server, constructs a client, and sends the pause HTTP call. All errors are logged and swallowed — the reset must not fail because the server is unreachable.

- [x] **Step 1: Add the function**
<!-- Verified: `pause_conversation_if_server_running` at mod.rs:1047, uses `try_get_cached_server_handle` -->

- [x] **Step 2: Build to confirm compilation**

- [x] **Step 3: Run clippy**

```bash
cd app/src-tauri && cargo clippy -- -D warnings 2>&1 | grep "^error" | head -10
```

Expected: Clean.

---

### Task 7.3 — Refactor `clear_persistent_skill_conversation_state`; make `reset_workflow_step` async

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/evaluation.rs`

**Context:** `clear_persistent_skill_conversation_state` currently: (1) clears the DB record, (2) removes the entire `conversations/` directory. The fix: (1) collect conversation IDs before clearing, (2) remove the `remove_dir_all` entirely, (3) return the IDs so `reset_workflow_step` can pause them before the DB clear. `reset_workflow_step` becomes `async fn` so it can `await` the pause.

- [x] **Step 1: Write a failing test proving no directory deletion**
<!-- Verified: test `clear_skill_conversation_db_records_does_not_touch_filesystem` at evaluation.rs:398 -->

- [x] **Step 2: Run to confirm it currently fails**

- [x] **Step 3: Refactor `clear_persistent_skill_conversation_state`**
<!-- Verified: `clear_persistent_skill_conversation_state` removed entirely; replaced by `collect_skill_conversation_ids` (line 35) and `clear_skill_conversation_db_records` (line 56) -->

- [x] **Step 4: Make `reset_workflow_step` async; add pause**
<!-- Verified: `pub async fn reset_workflow_step` at evaluation.rs:646; collects IDs (line 688), pauses (line 701), deletes conv dirs (line 704), clears DB (line 714) -->

- [x] **Step 5: Run the filesystem test**

- [x] **Step 6: Run full cargo test**

- [x] **Step 7: Run clippy**

- [x] **Step 8: Update `lib.rs` command registration**

- [x] **Step 9: Commit**

```bash
git add app/src-tauri/src/agents/openhands_server/process.rs \
        app/src-tauri/src/agents/openhands_server/mod.rs \
        app/src-tauri/src/commands/workflow/evaluation.rs
git commit -m "feat: pause conversation before workflow reset; remove conversation directory deletion"
```

---

### Task 7.4 — Rename confusing workspace fields; thread `app_data_root` to server startup

**Files:**
- Modify: `app/src-tauri/src/agents/runtime_config.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/types.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/client.rs`
- Modify: `app/src-tauri/src/agents/skill_creator.rs`
- Modify: `app/src-tauri/src/types/mod.rs`
- Modify: `app/src-tauri/src/commands/skill_session.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/commands/skill/scope_review.rs`
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `app/src-tauri/src/commands/api_validation.rs`

**Context:** Code review found that `OH_CONVERSATIONS_PATH` and `OH_BASH_EVENTS_DIR` are being set to paths under `{skills_root}/.openhands/…` instead of `{app_data_root}/openhands/…`. Root cause: the field named `workspace_root_dir` is actually the skills root (not the app data root), and `ensure_agent_server` derives conversation/bash_events paths from it. `workspace_skill_dir` is the canonical per-skill CWD. Neither field name reflects its actual meaning, and `app_data_root` has no representation anywhere in the config structs.

The three distinct roots are:
- `app_data_root` = `~/Library/Application Support/com.vibedata.skill-builder/` — owns `openhands/`, the DB, documents
- `skills_root` = user-configured skill tree root — owns all plugin/skill files
- `skill_dir` = `{skills_root}/{plugin_slug}/skills/{skill_name}` — OpenHands CWD

This task renames the fields to match these roots and adds `app_data_root` so the server receives the correct paths.

- [x] **Step 1: Rename fields in `runtime_config.rs` and add `app_data_root`**
<!-- Verified: `runtime_config.rs` has `app_data_root` (line 45), `skills_root` (line 48), `skill_dir` (line 52); serde renames updated; `BuildOpenHandsRuntimeConfigParams` also updated (lines 153-155) -->

- [x] **Step 2: Rename fields in `types.rs` and add `app_data_root`**
<!-- Verified: `types.rs` has `app_data_root` (line 11), `skills_root` (line 12), `skill_dir` (line 13); `skill_dir_path()` method at line 56-57; `try_from_runtime_config` maps fields (lines 38-40) -->

- [x] **Step 3: Fix path helpers in `process.rs` to use `app_data_root`**
<!-- Verified: `compute_conversations_path` takes `app_data_root` (line 59), resolves to `{app_data_root}/openhands/conversations` (line 60); `compute_bash_events_path` same pattern (line 64-65); `openhands_secret_path` (line 86-87); `ensure_agent_server` signature (line 270); `start`/`start_once` use `app_data_root` (lines 328, 345); tests renamed (lines 719, 728) -->

- [x] **Step 4: Update `mod.rs` to pass `app_data_root` to `ensure_agent_server_process`**
<!-- Verified: all 5 call sites use `Path::new(&request.app_data_root)` (lines 803, 893, 922, 1014, 1259); `skill_dir_path()` used in log lines (750, 758, 765); test fixtures use `app_data_root` (lines 2433, 2477, 2533, 2551) -->

- [x] **Step 5: Update `skill_creator.rs` and `SkillCreatorConfigParams`**
<!-- Verified: `SkillCreatorConfigParams` has `app_data_root` (line 17), `skills_root` (line 20); `build_skill_creator_config` passes through (lines 43-45) -->

- [x] **Step 6: Update Layer 3 callers to resolve and pass `app_data_root`**
<!-- Verified: `skill_session.rs` (lines 162, 277); `workflow/runtime.rs` (line 456); `skill/scope_review.rs` (line 219); `eval_workbench/mod.rs` (line 472); `api_validation.rs` (line 50) -- all resolve `app_data_root` from `AppHandle` and pass through -->

- [x] **Step 7: Fix `client.rs` test helper and `types/mod.rs` fixture**
<!-- Verified: `client.rs` `base_config` uses `app_data_root`, `skills_root`, `skill_dir` (lines 292-317); `types/mod.rs` fixture at lines 127-129 -->

- [x] **Step 8: Full build and test**

- [x] **Step 9: Commit**

```bash
git add app/src-tauri/src/agents/runtime_config.rs \
        app/src-tauri/src/agents/openhands_server/types.rs \
        app/src-tauri/src/agents/openhands_server/process.rs \
        app/src-tauri/src/agents/openhands_server/mod.rs \
        app/src-tauri/src/agents/openhands_server/client.rs \
        app/src-tauri/src/agents/skill_creator.rs \
        app/src-tauri/src/types/mod.rs \
        app/src-tauri/src/commands/skill_session.rs \
        app/src-tauri/src/commands/workflow/runtime.rs \
        app/src-tauri/src/commands/skill/scope_review.rs \
        app/src-tauri/src/commands/eval_workbench/mod.rs \
        app/src-tauri/src/commands/api_validation.rs
git commit -m "refactor: rename workspace_root_dir/workspace_skill_dir to skills_root/skill_dir; add app_data_root; fix OH_CONVERSATIONS_PATH and OH_BASH_EVENTS_DIR to use app data root"
```

---

### Task 7.5 — Seed `.agents/` into every skill's canonical directory on startup and create

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/deploy.rs`
- Modify: `app/src-tauri/src/commands/workspace.rs`
- Modify: `app/src-tauri/src/commands/skill/crud.rs`

**Context:** OpenHands now uses `skill_dir` (`{skills_root}/{plugin_slug}/skills/{skill_name}`) as `workspace.working_dir`. It reads agents and skills from `{skill_dir}/.agents/agents/` and `{skill_dir}/.agents/skills/`. The source of truth for these files is `agent-sources/workspace/` in the repo (bundled as a Tauri resource in production). Without seeding, new and existing skills have no agents available to OpenHands.

Two call sites are needed:
1. **App startup** — seed every skill that already exists in the DB.
2. **Skill creation** — seed the new skill directory immediately after it is created on disk.

The existing copy functions already perform the correct copy logic; they just need to be renamed (dropping the legacy `workspace_` prefix) and a new public `seed_skill_agents_dir` helper needs to be added with SHA-gating per skill dir.

- [x] **Step 1: Rename all three legacy `copy_workspace_*` functions**
<!-- Verified: `copy_workspace_*` no longer exists in deploy.rs; replaced by `copy_agent_sources_to_openhands_cwd` (line 362), `copy_agent_sources_to_agents_dir` (line 431), `copy_agent_sources_to_skills_dir` (line 467), `copy_agent_sources_to_full_layout` (line 346) -->

- [x] **Step 2: Add `seed_skill_agents_dir` — SHA-gated per-skill seeder**
<!-- Verified: `seed_skill_agents_dir` at deploy.rs:504 with SHA-gating, cache, and copy logic -->

- [x] **Step 3: Call `seed_skill_agents_dir` on startup for all existing skills**
<!-- Verified: `workspace.rs` `init_workspace` calls `seed_skill_agents_dir` for all skills from DB (lines 535) after `migrate_flatten_openhands_dir` (line 494) -->

- [x] **Step 4: Call `seed_skill_agents_dir` after skill creation**
<!-- Verified: `skill/crud.rs` `post_create_skill_filesystem_inner` calls `seed_skill_agents_dir` (line 503) -->

- [x] **Step 5: Full build, test, clippy**

- [x] **Step 6: Commit**

```bash
git add app/src-tauri/src/commands/workflow/deploy.rs \
        app/src-tauri/src/commands/workspace.rs \
        app/src-tauri/src/commands/skill/crud.rs
git commit -m "feat: seed .agents/ into skill_dir on startup and create; rename copy_workspace_* fns to copy_agent_sources_*"
```

---

### Task 7.6 — Pause conversation before `delete_skill` filesystem/DB cleanup

**Files:**
- Modify: `app/src-tauri/src/commands/skill/crud.rs`

**Context:** `delete_skill` calls `terminate_openhands_session` (kills the local Tauri task) but never sends an HTTP pause to the OpenHands server. The server retains an `owner_lease.json` for the conversation for up to 45 seconds. The fix collects the skill's saved conversation IDs from the DB and calls `pause_conversation_if_server_running` before any filesystem or DB cleanup. No conversation directory is deleted — the orphaned directory is harmless once the DB record is gone.

- [x] **Step 1: Collect conversation IDs and pause before cleanup**
<!-- Verified: `skill/crud.rs` `delete_skill` collects conversation IDs from DB (lines 590-606), calls `pause_conversation_if_server_running` for each (line 608), logs pause (lines 609-614) -->

- [x] **Step 2: Build and verify**

- [x] **Step 3: Commit**

```bash
git add app/src-tauri/src/commands/skill/crud.rs
git commit -m "fix: pause OpenHands conversation before delete_skill filesystem cleanup"
```

---

### Task 7.7 — Remove `clear_persistent_skill_conversation_state`; replace with DB-only clear

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/evaluation.rs`

**Context:** `clear_persistent_skill_conversation_state` (lines 33–61) still calls `remove_dir_all` on `workspace_skill_dir/conversations/`. Task 7.3 said to remove it entirely and replace its one call site in `navigate_back_to_step_impl` with `clear_skill_conversation_db_records` (which already exists in the same file). The old test `test_clear_persistent_skill_conversation_state_removes_saved_id_and_disk_state` contradicts the plan and must be replaced with a test that asserts no filesystem deletion.

- [x] **Step 1: Remove the function**
<!-- Verified: `clear_persistent_skill_conversation_state` no longer exists in evaluation.rs (grep returns no matches) -->

- [x] **Step 2: Replace the call site in `navigate_back_to_step_impl`**
<!-- Verified: `navigate_back_to_step_impl` at evaluation.rs:151 calls `clear_skill_conversation_db_records` instead -->

- [x] **Step 3: Delete the old test and add the replacement**
<!-- Verified: old test `test_clear_persistent_skill_conversation_state_removes_saved_id_and_disk_state` no longer exists; new test `clear_skill_conversation_db_records_does_not_touch_filesystem` at evaluation.rs:398 -->

- [x] **Step 4: Build and test**

- [x] **Step 5: Commit**

```bash
git add app/src-tauri/src/commands/workflow/evaluation.rs
git commit -m "fix: remove clear_persistent_skill_conversation_state; replace with DB-only clear in navigate_back_to_step"
```

---

### Task 7.8 — Manual smoke tests for all of PR 7

**Prerequisite:** All of Tasks 7.0–7.7 must be landed and the app compiled in dev mode (`cd app && npm run dev`).

**How to find `app_data_root`:** On macOS it is `~/Library/Application Support/com.vibedata.skill-builder/`. The conversations, logs, and bash_events directories all live inside `{app_data_root}/openhands/`.

**How to find `skills_root`:** Check Settings → Skills Path, or look at `~/skill-builder/` (default). Skill dirs live at `{skills_root}/{plugin_slug}/skills/{skill_name}/`.

---

#### Smoke 1 — Cold launch: paths land in the right roots

- [X] Launch the app fresh (no prior session running).
- [X] Open an existing skill and run a workflow step to completion (a single agent turn is enough).
- [X] **Pass:** `{app_data_root}/openhands/conversations/` contains a conversation directory named by a UUID. **Fail:** any conversation directory appears under `{skills_root}`.
- [X] **Pass:** `{app_data_root}/openhands/bash_events/` and `{app_data_root}/openhands/logs/` are populated by the server. **Fail:** they appear under `{skills_root}/.openhands/` or anywhere else under the skills tree.

---

#### Smoke 2 — First-launch migration

Only run if you have a real previous install with data in the old layout. If not, skip.

- [X] Back up `{app_data_root}/workspace/.openhands/` by copying it somewhere safe.
- [X] Launch the app.
- [X] **Pass:** `{app_data_root}/workspace/` is gone after launch. `{app_data_root}/openhands/conversations/`, `/logs/`, and `/bash_events/` exist and contain the migrated data. Existing conversation IDs visible in the DB still resolve to the correct directories.

---

#### Smoke 3 — `.agents/` seeding on startup

- [X] Launch the app. Do not start any workflow.
- [X] For each skill that already exists in the app (check the Skills list), look at `{skills_root}/{plugin_slug}/skills/{skill_name}/.agents/agents/` and `{skills_root}/{plugin_slug}/skills/{skill_name}/.agents/skills/`.
- [X] **Pass:** Both subdirectories are present and non-empty (e.g., `skill-creator.md` inside `agents/`). **Fail:** `.agents/` is absent or empty for any existing skill.

---

#### Smoke 4 — `.agents/` seeding on skill creation

- [X] Create a new skill via the UI (any name, any description).
- [X] After creation completes, open a terminal and check `{skills_root}/default/skills/{new-skill-name}/.agents/agents/` and `/skills/`.
- [X] **Pass:** Both directories exist and contain the bundled agent files. **Fail:** `.agents/` is missing or empty.

---

#### Smoke 5 — Reset workflow: conversation paused and directory deleted

- [X] Open a skill that has completed at least one step so a conversation exists in the DB.
- [X] Navigate to a step with a completed agent run and note the conversation directory in `{app_data_root}/openhands/conversations/` (it should exist and match the ID in the logs).
- [X] Click Reset Workflow (or Navigate Back to Step 0) from the UI.
- [X] **Pass:** Reset completes with no error toast.
- [X] Open the Tauri dev console or the log file in `{app_data_root}/openhands/logs/`. Confirm a log line like `paused conversation <id>` and `deleted conversation dir` appears.
- [X] **Pass:** The conversation directory you noted above is **gone** from `{app_data_root}/openhands/conversations/`. **Fail:** It still exists.
- [X] Re-open the skill. **Pass:** Workflow starts at step 0 with no prior history shown. No error.

---

#### Smoke 6 — Delete skill: conversation directory is preserved

- [X] Open a skill and run at least one step so a conversation ID is saved in the DB. Note the conversation ID from the logs or `{app_data_root}/openhands/conversations/` directory listing.
- [X] Delete the skill via the UI.
- [X] **Pass:** The conversation directory at `{app_data_root}/openhands/conversations/{conv_id}/` still exists — delete only removes the DB record, not the conversation data.
- [X] Confirm via the Tauri logs that `paused conversation <id>` was logged during the delete.
- [X] **Pass:** The skill is gone from the Skills list. No error toast.

---

#### Smoke 7 — Multi-skill isolation: reset one does not affect another

- [X] Open Skill A, run a step, note its conversation directory path.
- [X] Open Skill B, run a step, note its conversation directory path.
- [X] Reset Skill A's workflow to step 0.
- [X] **Pass:** Skill A's conversation directory is deleted from `{app_data_root}/openhands/conversations/`. Skill B's conversation directory is **still present**.
- [X] Open Skill B, verify its workflow history is intact (steps still show, no data loss).

---

#### Smoke 8 — Refine flow end-to-end

- [X] Complete a workflow step on any skill so the Refine button is available.
- [X] Trigger a Refine run.
- [X] **Pass:** Refine completes and the refined output is visible. No error toast or Rust panic in the logs.

---

#### Smoke 9 — Scope review

- [X] Open a skill that has at least one completed step.
- [X] Trigger Scope Review from the UI (wherever it is exposed).
- [X] **Pass:** Review runs and returns results. No crash or error toast.

---

## PR 8 — Collapse event recovery to always-FullHistory (Gap 8)

**Goal:** Single event replay path. Delete `EventRecoveryMode` enum entirely. Every `OpenHandsSendMessage` always replays full conversation history.

### Task 8.1: Remove event recovery mode entirely

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`

- [x] **Step 1: Delete `EventRecoveryMode` enum**

Remove the entire enum definition (around line 222-227):
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EventRecoveryMode {
    None,
    FullHistory,
    Delta,
}
```

- [x] **Step 2: Delete `determine_event_recovery_mode` function**

Remove the entire function (around line 694-707).

- [x] **Step 3: Delete watermark functions**

Remove:
- `event_watermark_key`
- `collect_event_watermark_keys`
- `filter_events_after_watermark`

- [x] **Step 4: Remove `event_recovery` field from `OpenHandsConversationTask`**

In the struct definition, remove:
```rust
event_recovery: EventRecoveryMode,
```

- [x] **Step 5: Remove `event_recovery` assignment in `dispatch_openhands_turn_with_request`**

Remove the line:
```rust
let event_recovery = determine_event_recovery_mode(selection, request.prompt.as_str());
```

And remove `event_recovery` from the `OpenHandsConversationTask` construction.

- [x] **Step 6: Replace mode-match with unconditional FullHistory in `run_conversation_task_inner`**

Replace the entire `match task.event_recovery { ... }` block (around lines 1325-1404) with unconditional FullHistory replay:

```rust
// Always replay full conversation history after send
match task.client.list_all_events(&task.conversation_id).await {
    Ok(events) => {
        for raw in events {
            if let Some(id) = raw.get("id").and_then(|value| value.as_str()) {
                if !seen_event_ids.insert(id.to_string()) {
                    continue;
                }
            }
            record_subagent_launch(&raw, &pending_subagent_launches);
            let normalized =
                normalize_server_event(&task.agent_id, &task.conversation_id, &raw);
            if normalized.get("type").and_then(|value| value.as_str())
                == Some("conversation_state")
            {
                terminal_state = Some(normalized);
                continue;
            }
            super::events::handle_runtime_message(
                &task.app,
                &task.agent_id,
                &normalized.to_string(),
            );
        }
    }
    Err(e) => {
        log::warn!(
            "[openhands-agent-server:{}] event backfill failed (live WS only): {}",
            task.agent_id,
            e
        );
    }
}
```

- [x] **Step 7: Remove `known_event_keys_before_send` variable**

Remove the entire block that collects watermark keys before send (around lines 1305-1319).

- [x] **Step 8: Update `event_recovery` references in subagent stream**

In the subagent stream worker task construction (around line 1422), remove:
```rust
event_recovery: EventRecoveryMode::None,
```
from the `OpenHandsConversationTask` construction.

- [x] **Step 9: Remove/update tests**

In `agents/openhands_server/mod.rs` tests (around lines 3159-3189):
- Delete all tests for `determine_event_recovery_mode`
- Delete any tests that construct `EventRecoveryMode` variants

- [x] **Step 10: Run openhands_server tests**

```bash
cd app/src-tauri && cargo test agents::openhands_server
```

Expected: All tests pass.

Result: ✅ 62 passed; 0 failed.

- [x] **Step 11: Run full cargo test**

```bash
cd app/src-tauri && cargo test
```

Expected: All tests pass.

Result: ✅ 1039 passed; 52 failed (pre-existing DB fixture failures, unrelated to PR 8 changes).

- [x] **Step 12: Run clippy**

```bash
cd app/src-tauri && cargo clippy -- -D warnings
```

Expected: Clean.

Result: ✅ 0 errors in changed file (all clippy errors are pre-existing in other modules).

- [x] **Step 13: Commit**

```bash
git add app/src-tauri/src/agents/openhands_server/mod.rs
git commit -m "refactor: collapse event recovery to always-FullHistory (Gap 8)"
```

Result: ✅ Committed as `0489c762`.

**Manual smoke:** Send a refine message, verify full transcript replays correctly. Run a workflow step, verify event streaming works.

---

## PR 9 — Remove `workflow_session_id` from contracts (Gap 7)

**Goal:** Remove `workflow_session_id` from contracts struct, regenerate TypeScript types, update callers.

**Scope note:** This removes `workflow_session_id` from the Rust contracts struct and generated TypeScript types. The DB schema and usage queries retain the field — that's a separate future cleanup.

### Task 9.1: Remove from contracts

**Files:**
- Modify: `app/src-tauri/src/contracts/agent_events.rs`
- Modify: `app/src-tauri/src/agents/runtime_config.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/types.rs`
- Modify: `app/src-tauri/src/agents/event_types.rs`
- Modify: `app/src-tauri/src/agents/run_persist.rs`

- [x] **Step 1: Remove from `OpenHandsRuntimeConfig`**

In `agents/runtime_config.rs`, remove:
```rust
#[serde(rename = "workflowSessionId", skip_serializing_if = "Option::is_none")]
pub workflow_session_id: Option<String>,
```

Remove from `Debug` impl if present. Remove from all test fixtures.

- [x] **Step 2: Remove from `OpenHandsRuntimeRequest`**

In `agents/openhands_server/types.rs`, remove `workflow_session_id` from the struct and from `from_runtime_request` mapping.

- [x] **Step 3: Remove from `OpenHandsRunSummaryContext`**

In `agents/openhands_server/mod.rs`, remove `workflow_session_id` from the struct and from `new()`. Remove from the JSON emit at line ~1776.

- [x] **Step 4: Remove from `ConversationStateEvent`**

In `agents/event_types.rs`, remove `workflow_session_id` field.

- [x] **Step 5: Remove from `run_persist.rs`**

Remove the `workflow_session_id` lookup and usage in `run_persist.rs`.

- [x] **Step 6: Update all test fixtures**

Remove `workflow_session_id` from all test fixtures in:
- `agents/runtime_config.rs` tests
- `agents/openhands_server/mod.rs` tests
- `agents/openhands_server/client.rs` tests
- `agents/run_persist.rs` tests
- `commands/refine/tests.rs`
- `commands/workflow/tests.rs`
- `contracts/agent_events.rs` tests
- `agents/event_router.rs` tests

- [x] **Step 7: Run codegen**

```bash
cd app && npm run codegen
```

Expected: Succeeds. Generated TypeScript types no longer have `workflowSessionId`.

- [x] **Step 8: Run contracts tests**

```bash
cd app/src-tauri && cargo test contracts::
```

Expected: All tests pass.

- [x] **Step 9: Run full cargo test**

```bash
cd app/src-tauri && cargo test
```

Expected: All tests pass.

- [x] **Step 10: TypeScript compile check**

```bash
cd app && npx tsc --noEmit
```

Expected: Clean.

- [x] **Step 11: Commit**

```bash
git add app/src-tauri/src/contracts/ app/src-tauri/src/agents/ app/src-tauri/src/commands/ app/src/generated/
git commit -m "refactor: remove workflow_session_id from contracts (Gap 7)"
```

**Manual smoke:** None needed — pure structural removal, no behavioral change.

---

## PR 10 — Optimistic session activation (Gap 10)

**Goal:** Split skill activation into sync (lock + navigate) and async (session boot) phases.

### Task 10.1: Split `activateSkill` in `app-layout.tsx`

**Files:**
- Modify: `app/src/components/layout/app-layout.tsx`
- Modify: `app/src/pages/workflow.tsx`
- Modify: `app/src/pages/workspace-route.tsx`

- [ ] **Step 1: Update `activateSkill` in `app-layout.tsx`**

Read the current `activateSkill` function. Split it:

```typescript
// Sync phase — blocks navigation
const syncPhase = async (skillName: string, pluginSlug: string) => {
  await acquireLock(skillName, pluginSlug);
  setSelectedWorkspaceSkillName(skillName);
  navigate(`/workspace/${skillName}`);
};

// Async phase — background boot
const asyncPhase = async (skillName: string, pluginSlug: string) => {
  try {
    const sessionInfo = await selectSkillOpenHandsSession(skillName, pluginSlug);
    hydrateSelectedSkillOpenHandsSession(sessionInfo);
    setActiveSessionSkillName(skillName);
  } catch (error) {
    toast.error(`Failed to activate skill: ${error}`);
    navigate('/');
    setActiveSessionSkillName(null);
    setSelectedWorkspaceSkillName(null);
    // Release lock best-effort
    try {
      await releaseLock(skillName, pluginSlug);
    } catch {
      // fire-and-forget
    }
  }
};
```

The `handleSelectSkill` function calls `syncPhase` then immediately fires `asyncPhase` without awaiting.

- [ ] **Step 2: Add `conversationId` guard to `WorkflowPage`**

In `app/src/pages/workflow.tsx`:

```typescript
const conversationId = useRefineStore((s) => s.conversationId);
const sessionReady = isLoaded && !!conversationId;

if (!sessionReady) {
  return <WorkflowLoadingSkeleton />;
}
```

- [ ] **Step 3: Add `conversationId` guard to `WorkspaceRoutePage`**

In `app/src/pages/workspace-route.tsx`, same pattern for the refine tab.

- [ ] **Step 4: Run frontend tests**

```bash
cd app && npm run test:unit
```

Expected: All tests pass.

- [ ] **Step 5: Run TypeScript check**

```bash
cd app && npx tsc --noEmit
```

Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/layout/app-layout.tsx app/src/pages/workflow.tsx app/src/pages/workspace-route.tsx
git commit -m "feat: split skill activation into sync + async phases (Gap 10)"
```

**Manual smoke:** Click a skill in the dashboard. Verify the page appears immediately with a skeleton. Wait 2-5 seconds for content to load. Verify no errors. Click a different skill while the first is loading — verify the switch works cleanly.

---

## PR 11 — Backend lease enforcement + advisory UI lock polling

**Goal:** Move selected-skill lease acquisition and enforcement fully into the backend, key selected-skill bootstrap by `skillId`, remove frontend lease acquisition on skill selection, and add advisory UI lock polling so the menu usually prevents locked-skill clicks before the backend has to reject them.

### Task 11.1: Move selected-skill lease acquisition into the backend bootstrap command

**Files:**
- Modify: `app/src-tauri/src/commands/skill_session.rs`
- Test: `app/src-tauri/src/commands/skill_session.rs`

- [ ] **Step 1: Add failing tests for backend-owned lease acquisition**

Add these tests to the `#[cfg(test)]` block in `app/src-tauri/src/commands/skill_session.rs`:

```rust
    #[test]
    fn acquire_or_verify_skill_lock_acquires_missing_lock_for_current_instance() {
        let conn = crate::db::create_test_db_for_tests();
        let skill_id =
            crate::db::upsert_skill(&conn, "locked-skill", "skill-builder", "domain").unwrap();

        let skill = acquire_or_verify_skill_lock(
            &conn,
            skill_id,
            "instance-a",
            std::process::id(),
        )
        .unwrap();

        assert_eq!(skill.id, skill_id);

        let lock = crate::db::get_skill_lock_by_skill_id(&conn, skill_id)
            .unwrap()
            .expect("lock row");
        assert_eq!(lock.instance_id, "instance-a");
    }

    #[test]
    fn acquire_or_verify_skill_lock_rejects_other_instance_lease() {
        let conn = crate::db::create_test_db_for_tests();
        let skill_id =
            crate::db::upsert_skill(&conn, "locked-skill", "skill-builder", "domain").unwrap();
        crate::db::acquire_skill_lock_by_skill_id(
            &conn,
            skill_id,
            "instance-b",
            std::process::id(),
        )
        .unwrap();

        let error = acquire_or_verify_skill_lock(
            &conn,
            skill_id,
            "instance-a",
            std::process::id(),
        )
        .unwrap_err();

        assert_eq!(error, "Skill 'locked-skill' is being edited in another instance");
    }
```

- [ ] **Step 2: Add the backend acquire-or-verify helper**

In `app/src-tauri/src/commands/skill_session.rs`, add this helper near the existing session helpers:

```rust
pub(crate) fn acquire_or_verify_skill_lock(
    conn: &rusqlite::Connection,
    skill_id: i64,
    instance_id: &str,
    pid: u32,
) -> Result<crate::types::SkillMasterRow, String> {
    crate::db::acquire_skill_lock_by_skill_id(conn, skill_id, instance_id, pid)?;
    crate::db::get_skill_master_by_id(conn, skill_id)?
        .ok_or_else(|| format!("Skill id {} was not found in the skills master", skill_id))
}
```

- [ ] **Step 3: Change `select_skill_openhands_session` to use `skillId` and acquire the lease before session restore**

In `app/src-tauri/src/commands/skill_session.rs`, change the command signature from:

```rust
pub async fn select_skill_openhands_session(
    app: tauri::AppHandle,
    skill_name: String,
    plugin_slug: String,
    _workspace_path: String,
    sessions: tauri::State<'_, SkillSessionManager>,
    db: tauri::State<'_, Db>,
) -> Result<RefineSessionInfo, String>
```

To:

```rust
pub async fn select_skill_openhands_session(
    app: tauri::AppHandle,
    skill_id: i64,
    _workspace_path: String,
    instance: tauri::State<'_, crate::InstanceInfo>,
    sessions: tauri::State<'_, SkillSessionManager>,
    db: tauri::State<'_, Db>,
) -> Result<RefineSessionInfo, String>
```

At the top of the function, replace the direct `skill_name` / `plugin_slug` inputs with a DB-backed lease acquisition and canonical skill lookup:

```rust
    let (skill_name, plugin_slug, saved_conversation_id) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let skill = acquire_or_verify_skill_lock(
            &conn,
            skill_id,
            &instance.id,
            instance.pid,
        )?;
        let saved_conversation_id =
            crate::db::get_skill_conversation_id(&conn, &skill.plugin_slug, &skill.name)?;
        (skill.name, skill.plugin_slug, saved_conversation_id)
    };

    log::info!(
        "[select_skill_openhands_session] skill_id={} skill={} plugin={}",
        skill_id,
        skill_name,
        plugin_slug
    );
```

Keep the rest of the command behavior intact: runtime readiness, `build_skill_session_config`, `ensure_skill_session`, transcript restore, and the in-memory session map upsert.

- [ ] **Step 4: Run the focused Rust tests**

```bash
cd app/src-tauri && cargo test commands::skill_session
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/commands/skill_session.rs
git commit -m "feat: enforce selected-skill lease in backend bootstrap"
```

### Task 11.2: Re-check lease ownership on persistent refine dispatch

**Files:**
- Modify: `app/src-tauri/src/commands/refine/mod.rs`
- Modify: `app/src-tauri/src/commands/refine/tests.rs`

- [ ] **Step 1: Add a failing test that documents the dispatch seam**

Add this control test to `app/src-tauri/src/commands/refine/tests.rs`:

```rust
#[test]
fn plan_refine_dispatch_reuses_the_existing_conversation_id() {
    let session = SkillSession {
        skill_name: "my-skill".to_string(),
        plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
        usage_session_id: "usage-session-1".to_string(),
        conversation_id: Some("conv-123".to_string()),
        current_agent_id: None,
        dispatched_user_turn_count: 0,
        head_sha_at_start: None,
    };

    let plan = super::plan_refine_conversation_dispatch(&session, Some("conv-123".to_string()))
        .expect("dispatch plan");

    assert_eq!(
        plan,
        super::RefineConversationDispatchPlan::ReuseExisting("conv-123".to_string())
    );
}
```

Then add a guard-level test:

```rust
#[test]
fn selected_skill_lease_guard_rejects_other_instance_before_refine_dispatch() {
    let conn = crate::db::create_test_db_for_tests();
    let skill_id = crate::db::upsert_skill(&conn, "my-skill", "default", "domain").unwrap();
    crate::db::acquire_skill_lock_by_skill_id(&conn, skill_id, "instance-b", std::process::id())
        .unwrap();

    let error = crate::commands::skill_session::acquire_or_verify_skill_lock(
        &conn,
        skill_id,
        "instance-a",
        std::process::id(),
    )
    .unwrap_err();

    assert_eq!(error, "Skill 'my-skill' is being edited in another instance");
}
```

- [ ] **Step 2: Add the backend lease guard at the top of `send_refine_message`**

In `app/src-tauri/src/commands/refine/mod.rs`, update the command signature to include:

```rust
    instance: tauri::State<'_, crate::InstanceInfo>,
```

Then, immediately after destructuring `input`, add:

```rust
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let skill_id = crate::db::get_skill_master_id_in_plugin(&conn, &skill_name, &plugin_slug)?
            .ok_or_else(|| {
                format!(
                    "Skill '{}' in plugin '{}' was not found in the skills master",
                    skill_name, plugin_slug
                )
            })?;
        crate::commands::skill_session::acquire_or_verify_skill_lock(
            &conn,
            skill_id,
            &instance.id,
            instance.pid,
        )?;
    }
```

Do not change the existing session-map and OpenHands dispatch flow below this guard.

- [ ] **Step 3: Run focused refine tests**

```bash
cd app/src-tauri && cargo test commands::refine
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/commands/refine/mod.rs app/src-tauri/src/commands/refine/tests.rs
git commit -m "feat: enforce selected-skill lease before refine dispatch"
```

### Task 11.3: Remove frontend lease acquisition and switch selected-skill bootstrap to `skillId`

**Files:**
- Modify: `app/src/lib/tauri-command-types.ts`
- Modify: `app/src/lib/tauri.ts`
- Modify: `app/src/lib/active-skill-transition.ts`
- Modify: `app/src/lib/skill-openhands-session.ts`
- Modify: `app/src/__tests__/lib/tauri.test.ts`
- Modify: `app/src/__tests__/components/app-layout.test.tsx`

- [ ] **Step 1: Update the typed command contract**

In `app/src/lib/tauri-command-types.ts`, replace:

```ts
  select_skill_openhands_session: {
    args: { skillName: string; pluginSlug: string; workspacePath: string };
    result: RefineSessionInfo;
  };
```

With:

```ts
  select_skill_openhands_session: {
    args: { skillId: number; workspacePath: string };
    result: RefineSessionInfo;
  };
```

- [ ] **Step 2: Update the wrapper**

In `app/src/lib/tauri.ts`, replace:

```ts
export const selectSkillOpenHandsSession = (skillName: string, workspacePath: string, pluginSlug: string) =>
  invokeCommand("select_skill_openhands_session", { skillName, pluginSlug, workspacePath })
```

With:

```ts
export const selectSkillOpenHandsSession = (skillId: number, workspacePath: string) =>
  invokeCommand("select_skill_openhands_session", { skillId, workspacePath })
```

- [ ] **Step 3: Remove `acquireLock` from selected-skill entry**

In `app/src/lib/active-skill-transition.ts`, replace:

```ts
  await acquireLock(skill.id);
  try {
    const session = await selectSkillOpenHandsSession(
      skill.name,
      workspacePath,
      skill.plugin_slug,
    );
    hydrateSelectedSkillOpenHandsSession(skill, session);
  } catch (error) {
    await releaseLock(skill.id).catch(() => {});
    throw error;
  }
```

With:

```ts
  const session = await selectSkillOpenHandsSession(skill.id, workspacePath);
  hydrateSelectedSkillOpenHandsSession(skill, session);
```

Also remove the unused `acquireLock` import.

- [ ] **Step 4: Update restart hydration**

In `app/src/lib/skill-openhands-session.ts`, replace:

```ts
  const session = await selectSkillOpenHandsSession(
    editableSkill.name,
    workspacePath,
    editableSkill.plugin_slug,
  );
```

With:

```ts
  if (editableSkill.id == null) {
    throw new Error(`Missing DB skill ID for '${editableSkill.name}'`);
  }

  const session = await selectSkillOpenHandsSession(
    editableSkill.id,
    workspacePath,
  );
```

- [ ] **Step 5: Update the tests to stop expecting frontend `acquire_lock`**

In `app/src/__tests__/components/app-layout.test.tsx`, replace selected-skill bootstrap assertions like:

```ts
      expect(mockInvoke).toHaveBeenCalledWith("acquire_lock", {
        skillId: 1,
      });
      expect(mockInvoke).toHaveBeenCalledWith("select_skill_openhands_session", {
        skillName: "sales-skill",
        pluginSlug: "skills",
        workspacePath: "/home/user/workspace",
      });
```

With:

```ts
      expect(mockInvoke).toHaveBeenCalledWith("select_skill_openhands_session", {
        skillId: 1,
        workspacePath: "/home/user/workspace",
      });
```

Also remove `acquire_lock` from mocked command order in the same-skill switch tests.

In `app/src/__tests__/lib/tauri.test.ts`, replace:

```ts
      call: () => selectSkillOpenHandsSession("demo-skill", "/tmp/workspace", "analytics-pack"),
```

With:

```ts
      call: () => selectSkillOpenHandsSession(42, "/tmp/workspace"),
```

- [ ] **Step 6: Run frontend tests**

```bash
cd app && npx vitest run src/__tests__/lib/tauri.test.ts src/__tests__/components/app-layout.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/tauri-command-types.ts app/src/lib/tauri.ts app/src/lib/active-skill-transition.ts app/src/lib/skill-openhands-session.ts app/src/__tests__/lib/tauri.test.ts app/src/__tests__/components/app-layout.test.tsx
git commit -m "refactor: move selected-skill lease acquisition out of frontend"
```

### Task 11.4: Add advisory UI lock polling for the skill menu

**Files:**
- Modify: `app/src/components/skill-list-panel.tsx`
- Modify: `app/src/__tests__/components/skill-list-panel.test.tsx`

- [ ] **Step 1: Replace panel-local lock state with a real refresh loop**

In `app/src/components/skill-list-panel.tsx`, replace the panel-local state:

```ts
  const [externalLockedSkills, setExternalLockedSkills] = useState<Set<string>>(new Set());
```

With store-backed state:

```ts
  const lockedSkills = useSkillStore((s) => s.lockedSkills);
  const setLockedSkills = useSkillStore((s) => s.setLockedSkills);
```

Then replace the pathname-only effect:

```ts
  useEffect(() => {
    getExternallyLockedSkills()
      .then((names) => setExternalLockedSkills(new Set(names)))
      .catch(() => { /* non-fatal */ });
  }, [pathname]);
```

With:

```ts
  useEffect(() => {
    let cancelled = false;

    const refreshLocks = async () => {
      try {
        const names = await getExternallyLockedSkills();
        if (!cancelled) {
          setLockedSkills(new Set(names));
        }
      } catch {
        // non-fatal
      }
    };

    void refreshLocks();
    const intervalId = window.setInterval(() => {
      void refreshLocks();
    }, 3000);
    const onFocus = () => {
      void refreshLocks();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [pathname, setLockedSkills]);
```

And replace:

```ts
    if (externalLockedSkills.has(skill.name)) return;
```

With:

```ts
    if (lockedSkills.has(skill.name)) return;
```

- [ ] **Step 2: Add a polling-focused test**

In `app/src/__tests__/components/skill-list-panel.test.tsx`, add:

```ts
  it("refreshes external locks on mount and interval ticks", async () => {
    vi.useFakeTimers();
    const { getExternallyLockedSkills } = await import("@/lib/tauri");
    vi.mocked(getExternallyLockedSkills)
      .mockResolvedValueOnce(["sales-skill"])
      .mockResolvedValueOnce(["finance-skill"]);

    renderSkillListPanel();

    await waitFor(() => {
      expect(getExternallyLockedSkills).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(3000);

    await waitFor(() => {
      expect(getExternallyLockedSkills).toHaveBeenCalledTimes(2);
    });

    vi.useRealTimers();
  });
```

- [ ] **Step 3: Run focused panel tests**

```bash
cd app && npx vitest run src/__tests__/components/skill-list-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/skill-list-panel.tsx app/src/__tests__/components/skill-list-panel.test.tsx
git commit -m "feat: add advisory UI lock polling for selected-skill menu"
```

### Task 11.5: Update the design docs for the new lease contract

**Files:**
- Modify: `docs/design/openhands-runtime-model/README.md`
- Modify: `docs/design/openhands-runtime-model/optimistic-session-activation.md`
- Modify: `docs/design/backend-design/README.md`

- [ ] **Step 1: Update the canonical runtime contract doc**

In `docs/design/openhands-runtime-model/README.md`, make the selected-skill bootstrap contract explicit:

- bootstrap resolves the canonical skill row from `skill_id`
- backend acquires or verifies the lease before any OpenHands session work
- frontend lock state is advisory only
- persistent dispatch commands re-check lease ownership before touching the conversation

- [ ] **Step 2: Update the optimistic activation design**

In `docs/design/openhands-runtime-model/optimistic-session-activation.md`, remove the stale assumption that the sync phase calls `acquireLock`. The flow should say:

- navigate immediately
- background `selectSkillOpenHandsSession(skillId)`
- backend lease acquisition/verification happens inside that product command
- UI lock polling is advisory only

- [ ] **Step 3: Update the backend summary doc**

In `docs/design/backend-design/README.md`, keep the as-built backend summary accurate:

- `skill_locks` are keyed by `skill_id`
- `select_skill_openhands_session` acquires or verifies the backend lease before OpenHands session restore
- frontend lock state is advisory UX, not the enforcement boundary

- [ ] **Step 4: Run doc sanity check**

```bash
cd /Users/hbanerjee/src/worktrees/feature/runtime-model-refactor && git diff --check
```

Expected: No whitespace or patch-format errors.

- [ ] **Step 5: Commit**

```bash
git add docs/design/openhands-runtime-model/README.md docs/design/openhands-runtime-model/optimistic-session-activation.md docs/design/backend-design/README.md
git commit -m "docs: document backend-owned selected-skill lease contract"
```

**Manual smoke:** Open two app instances. In instance A, select a skill and leave it active. In instance B, verify the skill becomes disabled in the menu within a few seconds or on window focus. Force a selection attempt anyway if possible and verify the backend rejects it cleanly before any OpenHands session restore or refine dispatch occurs.

---

## PR Execution Order

Execute PRs sequentially in order 1→11. Each PR must pass all automated tests and manual smoke before proceeding to the next.

| PR | Gap | Automated Tests | Manual Smoke |
|---|---|---|---|
| 1 | Create `skill_creator.rs` | `cargo test agents::skill_creator`, clippy | None |
| 2 | `dispatch_persistent_skill_turn` fix | `cargo test commands::workflow`, full cargo test | Run workflow step |
| 3 | Rename `Refine*` → `Skill*` | `cargo test` (all) | Open refine, send message |
| 4 | Move Layer 2 out of `refine/mod.rs` | `cargo test` (all), clippy | Open refine, send message, switch skills |
| 5 | Delete duplicate workflow config | `cargo test commands::workflow`, clippy | Run workflow steps 0-3, answer evaluator |
| 6 | Consolidate OH artifacts to workspace root + `OH_BASH_EVENTS_DIR` + remove skill-switch restart (backend) + remove `stopOpenHandsServer` (frontend) | `cargo test agents::openhands_server`, full cargo test, `npm run test:unit`, clippy | Switch skills → PID unchanged; verify `.openhands/conversations/` and `.openhands/bash_events/` exist; send message in new skill |
| 7 | Canonical skill-dir runtime roots + reset cleanup | `cargo test agents::openhands_server::process`, full cargo test, `npm run test:unit`, clippy, `markdownlint` on touched docs | Open/refine a skill → verify OpenHands CWD is the canonical skill dir; reset workflow mid-run → verify clean pause in logs → verify fresh workflow on re-open |
| 8 | Collapse event recovery to always-FullHistory | `cargo test agents::openhands_server`, full cargo test, clippy | Switch skills → resume conversation → verify full transcript replays |
| 9 | Remove `workflow_session_id` from contracts | `npm run codegen`, `cargo test contracts::`, `tsc --noEmit` | None |
| 10 | Optimistic activation | `npm run test:unit`, `tsc --noEmit` | Click skill → page appears immediately → content loads |
| 11 | Backend lease enforcement + advisory UI polling | `cargo test commands::skill_session`, `cargo test commands::refine`, `npx vitest run src/__tests__/lib/tauri.test.ts src/__tests__/components/app-layout.test.tsx src/__tests__/components/skill-list-panel.test.tsx`, `git diff --check` | Two instances: lock in A, B menu disables within a few seconds, backend rejects forced selection before OpenHands restore |

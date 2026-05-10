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

## PR 5b — Consolidate server artifacts to workspace root; add `OH_BASH_EVENTS_DIR`; remove skill-switch restart

**Goal:** All persistent OpenHands server artifacts (`conversations/`, `bash_events/`, `logs/`) land under `{workspace_root}/.openhands/` rather than being split across per-skill directories. The server's env vars (`OH_CONVERSATIONS_PATH`, `OH_BASH_EVENTS_DIR`) are derived from the workspace root, not from the skill directory. Because the artifact root no longer changes between skill switches, the skill-switch server restart is eliminated.

**Architecture:** All changes are in `app/src-tauri/src/agents/openhands_server/process.rs` (path helpers, env setup, handle struct, lifecycle logic) and the five call sites in `app/src-tauri/src/agents/openhands_server/mod.rs` (pass `workspace_root_dir` instead of `workspace_skill_dir`). No frontend changes.

**Background — why the server restarts today:** `ensure_agent_server` stores `conversations_path` (derived from `workspace_skill_dir`) in `OpenHandsAgentServerHandle` and restarts whenever that path differs from the incoming request's path. Switching skills changes `workspace_skill_dir` → changes `conversations_path` → forces restart. After this PR, all paths are derived from `workspace_root`, which is stable across skills. The restart condition is removed.

**Path layout after this PR:**

| Path | Purpose |
|---|---|
| `{workspace_root}/.openhands/conversations/` | All skill conversations (`OH_CONVERSATIONS_PATH`) |
| `{workspace_root}/.openhands/bash_events/` | All bash events (`OH_BASH_EVENTS_DIR`) |
| `{workspace_root}/.openhands/logs/` | Server stderr logs |
| `{workspace_root}/.openhands/secret.key` | Stable encryption key (unchanged) |

**How `workspace_root` reaches `ensure_agent_server`:** `OpenHandsRuntimeRequest` has two path fields: `workspace_root_dir` (the workspace root, e.g. `/workspace`) and `workspace_skill_dir` (the skill dir, e.g. `/workspace/default/skills/my-skill`). Currently callers pass `request.runtime_run_dir()` (which returns `workspace_skill_dir`) to `ensure_agent_server`. After this PR they pass `Path::new(&request.workspace_root_dir)` instead.

---

### Task 5b.1 — Update path helper functions

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`

**Context:** `compute_conversations_path` currently takes `runtime_run_dir` (= `workspace_skill_dir`) and returns `skill_dir/conversations`. After this task it takes `workspace_root` and returns `workspace_root/.openhands/conversations`. `openhands_secret_path` currently calls `workspace_root_for_runtime_run_dir` to climb the directory tree — after this task it takes `workspace_root` directly. Both changes make callers simpler.

- [ ] **Step 1: Write failing tests for new path shapes**

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

- [ ] **Step 2: Run to confirm the new tests fail**

```bash
cd app/src-tauri && cargo test agents::openhands_server::process::tests::compute_conversations_path_resolves_under_workspace_root_openhands_dir 2>&1 | tail -5
```

Expected: FAILED — function signature mismatch or assertion failure.

- [ ] **Step 3: Update `compute_conversations_path` and add `compute_bash_events_path`**

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

- [ ] **Step 4: Simplify `openhands_secret_path` to accept `workspace_root` directly**

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

- [ ] **Step 5: Update `read_or_create_openhands_secret` signature**

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

- [ ] **Step 6: Update `open_server_log_file` to use workspace root**

Replace the function signature `async fn open_server_log_file(runtime_run_dir: &Path)` with `async fn open_server_log_file(workspace_root: &Path)`. Change the body's `logs_dir` binding from `runtime_run_dir.join("logs")` to `workspace_root.join(".openhands").join("logs")`. The rest of the body is unchanged.

- [ ] **Step 7: Update the existing stale path test**

The test `compute_conversations_path_resolves_under_runtime_run_dir` asserts the old per-skill shape. Delete it — it is replaced by the two tests added in Step 1.

- [ ] **Step 8: Run new path tests**

```bash
cd app/src-tauri && cargo test agents::openhands_server::process::tests::compute_conversations_path_resolves_under_workspace_root_openhands_dir agents::openhands_server::process::tests::compute_bash_events_path_resolves_under_workspace_root_openhands_dir 2>&1 | tail -10
```

Expected: Both PASS.

- [ ] **Step 9: Update the secret test to pass `workspace_root` directly**

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

- [ ] **Step 10: Run full process tests**

```bash
cd app/src-tauri && cargo test agents::openhands_server::process 2>&1 | tail -15
```

Expected: All pass. (Some compilation errors from handle/ensure callers are expected — resolve in subsequent tasks.)

---

### Task 5b.2 — Update `apply_session_env`

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`

**Context:** `apply_session_env` currently sets `OH_CONVERSATIONS_PATH`. We add `OH_BASH_EVENTS_DIR` alongside it. Both are `Option<&str>` so tests can omit them when testing other env vars.

- [ ] **Step 1: Write a failing test for `OH_BASH_EVENTS_DIR`**

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

- [ ] **Step 2: Update `apply_session_env` signature and body**

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

- [ ] **Step 3: Fix existing `apply_session_env` call sites in tests**

Update `apply_session_env_sets_conversations_path_when_present`:
- Change the call to pass `Some("/tmp/test/conversations")` as the fourth arg and `Some("/tmp/test/bash_events")` as the fifth.
- Add an assertion for `OH_BASH_EVENTS_DIR`.

Update `apply_session_env_omits_conversations_path_when_none`:
- Change the call to `apply_session_env(&mut cmd, "k", "s", None, None)`.
- Add an assertion that `OH_BASH_EVENTS_DIR` is also absent.

- [ ] **Step 4: Run `apply_session_env` tests**

```bash
cd app/src-tauri && cargo test agents::openhands_server::process::tests::apply_session_env 2>&1 | tail -10
```

Expected: All four tests PASS.

---

### Task 5b.3 — Remove `conversations_path` from `OpenHandsAgentServerHandle`

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`

**Context:** `conversations_path` is stored in the handle solely to drive the skill-switch restart check. Once the check is gone the field has no purpose.

- [ ] **Step 1: Remove the field from the struct**

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

### Task 5b.4 — Update `ensure_agent_server` — remove skill-switch restart

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`

**Context:** `ensure_agent_server` currently: (1) computes `conversations_path` from `runtime_run_dir`, (2) checks if the cached server's path matches — if not, restarts. The skill-switch restart lives in that path comparison. After this task, `ensure_agent_server` takes `workspace_root` and restarts only on health failure or process crash.

- [ ] **Step 1: Write a failing test for the no-restart behavior**

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

- [ ] **Step 2: Add a structural compile-time test that `conversations_path` is gone from the handle**

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

- [ ] **Step 3: Replace the `ensure_agent_server` signature and body**

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

### Task 5b.5 — Update `OpenHandsAgentServerProcess::start` and `start_once`

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`

**Context:** `start` and `start_once` currently take `runtime_run_dir`. After this task they take `workspace_root`. All path derivations inside `start_once` switch from skill-dir-relative to workspace-root-relative.

- [ ] **Step 1: Update `OpenHandsAgentServerProcess::start` signature**

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

- [ ] **Step 2: Replace the full `start_once` body**

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

- [ ] **Step 3: Run process tests to confirm compilation**

```bash
cd app/src-tauri && cargo test agents::openhands_server::process 2>&1 | tail -15
```

Expected: All tests pass. (If `mod.rs` callers cause a compile error, proceed to Task 5b.6 first.)

---

### Task 5b.6 — Update callers in `mod.rs`

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`

**Context:** There are five call sites in `mod.rs` that currently pass `request.runtime_run_dir()` (= `workspace_skill_dir`) to `ensure_agent_server_process`. They must now pass `Path::new(&request.workspace_root_dir)` (the workspace root). `OpenHandsRuntimeRequest` already has a `workspace_root_dir: String` field — no struct changes needed.

- [ ] **Step 1: Update all five call sites**

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

- [ ] **Step 2: Confirm `std::path::Path` is in scope**

Check the imports at the top of `mod.rs`. `Path` is already used elsewhere in the file so the import already exists. If not, add `use std::path::Path;`.

- [ ] **Step 3: Build to check compilation**

```bash
cd app/src-tauri && cargo build 2>&1 | grep "^error" | head -20
```

Expected: No errors.

---

### Task 5b.7 — Update remaining tests and run full suite

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`

**Context:** The live server test (`live_openhands_server_shutdown_prefers_sigterm`) constructs a `runtime_run_dir` and passes it to `OpenHandsAgentServerProcess::start`. Update it to pass a workspace root instead.

- [ ] **Step 1: Update the live server test**

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

- [ ] **Step 2: Run all `process` module tests**

```bash
cd app/src-tauri && cargo test agents::openhands_server::process 2>&1 | tail -20
```

Expected: All pass.

- [ ] **Step 3: Run full `openhands_server` tests**

```bash
cd app/src-tauri && cargo test agents::openhands_server 2>&1 | tail -20
```

Expected: All pass.

- [ ] **Step 4: Run full cargo test**

```bash
cd app/src-tauri && cargo test 2>&1 | tail -20
```

Expected: All pass.

- [ ] **Step 5: Run clippy**

```bash
cd app/src-tauri && cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings 2>&1 | grep "^error" | head -20
```

Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/agents/openhands_server/process.rs \
        app/src-tauri/src/agents/openhands_server/mod.rs
git commit -m "refactor: consolidate OH artifacts to workspace root, add OH_BASH_EVENTS_DIR, remove skill-switch restart"
```

**Manual smoke:**

> E2E tests mock Tauri commands and cannot verify real server lifecycle or filesystem state. Run these manually against the live app.

**Smoke 1 — Server PID unchanged across skill switch (core PR5b invariant)**

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

1. After Smoke 2, find your workspace root (default: `~/.vibedata/`)
2. Check the filesystem:
   ```bash
   ls ~/.vibedata/.openhands/conversations/
   ls ~/.vibedata/.openhands/bash_events/
   ```
3. **Verify:** Both directories exist and contain entries. No `conversations/` directory exists under `~/.vibedata/{plugin}/skills/{skill_name}/`.

**Smoke 4 — Conversation survives app quit + restart**

1. Send a message in skill A, wait for the response to complete
2. Quit the app completely (Cmd+Q)
3. Restart the app, open skill A
4. **Verify:** Previous conversation transcript is restored. No errors.

**Failure triage**

| Symptom | Likely cause |
|---|---|
| Server restarts on skill switch | `ensure_agent_server` still compares paths — check `process.rs` lines touching `conversations_path` |
| `OH_CONVERSATIONS_PATH` points to skill dir | Call site in `mod.rs` still passes `runtime_run_dir()` instead of `workspace_root_dir` |
| `OH_BASH_EVENTS_DIR` not set | `apply_session_env` call in `start_once` missing fifth argument |
| Conversation not restored after restart | `secret.key` path wrong, or conversations dir not under `.openhands/` at workspace root |
| Compile error on handle construction | `conversations_path` field still present — Task 5b.3 not applied |

---

## PR 6 — Remove `stopOpenHandsServer` from `leaveCurrentSkill` (Gap 6)

**Goal:** Server stays alive between skill switches.

### Task 6.1: Frontend — remove `stopOpenHandsServer` call

**Files:**
- Modify: `app/src/lib/active-skill-transition.ts`

- [ ] **Step 1: Remove `stopOpenHandsServer()` from `leaveCurrentSkill`**

Read the file and remove the `stopOpenHandsServer()` call. The function should be:
1. Pause conversation
2. Release lock
3. Clear UI state

No server stop.

- [ ] **Step 2: Remove unused import**

Remove the `stopOpenHandsServer` import if no longer used.

### Task 6.2: Backend — delete `stop_openhands_server` Tauri command

**Files:**
- Modify: `app/src-tauri/src/commands/runtime_lifecycle.rs`
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 3: Delete `stop_openhands_server` from `runtime_lifecycle.rs`**

Remove the entire `stop_openhands_server` function (lines ~14-27).

- [ ] **Step 4: Remove command registration from `lib.rs`**

Remove `commands::runtime_lifecycle::stop_openhands_server` from the `invoke_handler!` list.

- [ ] **Step 5: Run Rust tests**

```bash
cd app/src-tauri && cargo test
```

Expected: All tests pass.

- [ ] **Step 6: Run frontend tests**

```bash
cd app && npm run test:unit
```

Expected: All tests pass.

- [ ] **Step 7: Run clippy**

```bash
cd app/src-tauri && cargo clippy -- -D warnings
```

Expected: Clean.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/active-skill-transition.ts app/src-tauri/src/commands/runtime_lifecycle.rs app/src-tauri/src/lib.rs
git commit -m "feat: remove stopOpenHandsServer from leaveCurrentSkill (Gap 6)"
```

**Manual smoke:** Open a skill, then switch to a different skill. Verify the switch is fast (no server restart flash). Send a message in the new skill, verify it works.

---

## PR 7 — Remove `workflow_session_id` from contracts (Gap 7)

**Goal:** Remove `workflow_session_id` from contracts struct, regenerate TypeScript types, update callers.

**Scope note:** This removes `workflow_session_id` from the Rust contracts struct and generated TypeScript types. The DB schema and usage queries retain the field — that's a separate future cleanup.

### Task 7.1: Remove from contracts

**Files:**
- Modify: `app/src-tauri/src/contracts/agent_events.rs`
- Modify: `app/src-tauri/src/agents/runtime_config.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/types.rs`
- Modify: `app/src-tauri/src/agents/event_types.rs`
- Modify: `app/src-tauri/src/agents/run_persist.rs`

- [ ] **Step 1: Remove from `OpenHandsRuntimeConfig`**

In `agents/runtime_config.rs`, remove:
```rust
#[serde(rename = "workflowSessionId", skip_serializing_if = "Option::is_none")]
pub workflow_session_id: Option<String>,
```

Remove from `Debug` impl if present. Remove from all test fixtures.

- [ ] **Step 2: Remove from `OpenHandsRuntimeRequest`**

In `agents/openhands_server/types.rs`, remove `workflow_session_id` from the struct and from `from_runtime_request` mapping.

- [ ] **Step 3: Remove from `OpenHandsRunSummaryContext`**

In `agents/openhands_server/mod.rs`, remove `workflow_session_id` from the struct and from `new()`. Remove from the JSON emit at line ~1776.

- [ ] **Step 4: Remove from `ConversationStateEvent`**

In `agents/event_types.rs`, remove `workflow_session_id` field.

- [ ] **Step 5: Remove from `run_persist.rs`**

Remove the `workflow_session_id` lookup and usage in `run_persist.rs`.

- [ ] **Step 6: Update all test fixtures**

Remove `workflow_session_id` from all test fixtures in:
- `agents/runtime_config.rs` tests
- `agents/openhands_server/mod.rs` tests
- `agents/openhands_server/client.rs` tests
- `agents/run_persist.rs` tests
- `commands/refine/tests.rs`
- `commands/workflow/tests.rs`
- `contracts/agent_events.rs` tests
- `agents/event_router.rs` tests

- [ ] **Step 7: Run codegen**

```bash
cd app && npm run codegen
```

Expected: Succeeds. Generated TypeScript types no longer have `workflowSessionId`.

- [ ] **Step 8: Run contracts tests**

```bash
cd app/src-tauri && cargo test contracts::
```

Expected: All tests pass.

- [ ] **Step 9: Run full cargo test**

```bash
cd app/src-tauri && cargo test
```

Expected: All tests pass.

- [ ] **Step 10: TypeScript compile check**

```bash
cd app && npx tsc --noEmit
```

Expected: Clean.

- [ ] **Step 11: Commit**

```bash
git add app/src-tauri/src/contracts/ app/src-tauri/src/agents/ app/src-tauri/src/commands/ app/src/generated/
git commit -m "refactor: remove workflow_session_id from contracts (Gap 7)"
```

**Manual smoke:** None needed — pure structural removal, no behavioral change.

---

## PR 8 — Collapse event recovery to always-FullHistory (Gap 8)

**Goal:** Single event replay path. Delete `EventRecoveryMode` enum entirely. Every `OpenHandsSendMessage` always replays full conversation history.

### Task 8.1: Remove event recovery mode entirely

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`

- [ ] **Step 1: Delete `EventRecoveryMode` enum**

Remove the entire enum definition (around line 222-227):
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EventRecoveryMode {
    None,
    FullHistory,
    Delta,
}
```

- [ ] **Step 2: Delete `determine_event_recovery_mode` function**

Remove the entire function (around line 694-707).

- [ ] **Step 3: Delete watermark functions**

Remove:
- `event_watermark_key`
- `collect_event_watermark_keys`
- `filter_events_after_watermark`

- [ ] **Step 4: Remove `event_recovery` field from `OpenHandsConversationTask`**

In the struct definition, remove:
```rust
event_recovery: EventRecoveryMode,
```

- [ ] **Step 5: Remove `event_recovery` assignment in `dispatch_openhands_turn_with_request`**

Remove the line:
```rust
let event_recovery = determine_event_recovery_mode(selection, request.prompt.as_str());
```

And remove `event_recovery` from the `OpenHandsConversationTask` construction.

- [ ] **Step 6: Replace mode-match with unconditional FullHistory in `run_conversation_task_inner`**

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

- [ ] **Step 7: Remove `known_event_keys_before_send` variable**

Remove the entire block that collects watermark keys before send (around lines 1305-1319).

- [ ] **Step 8: Update `event_recovery` references in subagent stream**

In the subagent stream worker task construction (around line 1422), remove:
```rust
event_recovery: EventRecoveryMode::None,
```
from the `OpenHandsConversationTask` construction.

- [ ] **Step 9: Remove/update tests**

In `agents/openhands_server/mod.rs` tests (around lines 3159-3189):
- Delete all tests for `determine_event_recovery_mode`
- Delete any tests that construct `EventRecoveryMode` variants

- [ ] **Step 10: Run openhands_server tests**

```bash
cd app/src-tauri && cargo test agents::openhands_server
```

Expected: All tests pass.

- [ ] **Step 11: Run full cargo test**

```bash
cd app/src-tauri && cargo test
```

Expected: All tests pass.

- [ ] **Step 12: Run clippy**

```bash
cd app/src-tauri && cargo clippy -- -D warnings
```

Expected: Clean.

- [ ] **Step 13: Commit**

```bash
git add app/src-tauri/src/agents/openhands_server/mod.rs
git commit -m "refactor: collapse event recovery to always-FullHistory (Gap 8)"
```

**Manual smoke:** Send a refine message, verify full transcript replays correctly. Run a workflow step, verify event streaming works.

---

## PR 9 — Optimistic session activation (Gap 10)

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

## PR Execution Order

Execute PRs sequentially in order 1→9. Each PR must pass all automated tests and manual smoke before proceeding to the next.

| PR | Gap | Automated Tests | Manual Smoke |
|---|---|---|---|
| 1 | Create `skill_creator.rs` | `cargo test agents::skill_creator`, clippy | None |
| 2 | `dispatch_persistent_skill_turn` fix | `cargo test commands::workflow`, full cargo test | Run workflow step |
| 3 | Rename `Refine*` → `Skill*` | `cargo test` (all) | Open refine, send message |
| 4 | Move Layer 2 out of `refine/mod.rs` | `cargo test` (all), clippy | Open refine, send message, switch skills |
| 5 | Delete duplicate workflow config | `cargo test commands::workflow`, clippy | Run workflow steps 0-3, answer evaluator |
| 5b | Consolidate artifacts to workspace root + `OH_BASH_EVENTS_DIR` + remove skill-switch restart | `cargo test agents::openhands_server`, full cargo test, clippy | Switch skills → PID unchanged; verify `.openhands/conversations/` and `.openhands/bash_events/` exist |
| 6 | Remove `stopOpenHandsServer` | `cargo test`, `npm run test:unit` | Switch skills, verify fast |
| 8 | Collapse event recovery to always-FullHistory | `cargo test agents::openhands_server`, full cargo test, clippy | Switch skills → resume conversation → verify full transcript replays |
| 7 | Remove `workflow_session_id` from contracts | `npm run codegen`, `cargo test contracts::`, `tsc --noEmit` | None |
| 9 | Optimistic activation | `npm run test:unit`, `tsc --noEmit` | Click skill → page appears immediately → content loads |

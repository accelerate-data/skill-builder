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

## PR 5b — Set `OH_BASH_EVENTS_DIR` explicitly (process env hygiene)

**Goal:** Bash events land in the skill-scoped workspace alongside conversations, not in the temp CWD. The OpenHands server default for `bash_events_dir` is `workspace/bash_events` relative to its CWD. Because the CWD is a throwaway temp dir, bash events currently go there and are lost. Explicitly setting `OH_BASH_EVENTS_DIR` to `{workspace_skill_dir}/bash_events` keeps all persistent OpenHands artifacts in the skill-scoped directory alongside `conversations/`.

### Task 5b.1: Add `OH_BASH_EVENTS_DIR` to `apply_session_env`

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`

- [ ] **Step 1: Add `compute_bash_events_path`**

After `compute_conversations_path`, add:

```rust
pub(crate) fn compute_bash_events_path(runtime_run_dir: &Path) -> PathBuf {
    runtime_run_dir.join("bash_events")
}
```

- [ ] **Step 2: Update `apply_session_env` signature and body**

Add `bash_events_path: Option<&str>` parameter and set `OH_BASH_EVENTS_DIR`:

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

- [ ] **Step 3: Update `start_once` to compute and pass the bash events path**

After the `conversations_path_str` binding, add:

```rust
let bash_events_path_str = compute_bash_events_path(runtime_run_dir)
    .to_string_lossy()
    .into_owned();
```

Pass it to `apply_session_env`:

```rust
apply_session_env(
    &mut tokio_command,
    &session_api_key,
    &openhands_secret_key,
    Some(&conversations_path_str),
    Some(&bash_events_path_str),
);
```

- [ ] **Step 4: Update tests**

Update `apply_session_env_sets_conversations_path_when_present` to pass `None` as the new fifth argument and add a parallel assertion for `OH_BASH_EVENTS_DIR`.

Update `apply_session_env_omits_conversations_path_when_none` to pass `None` as the fifth argument and add an assertion that `OH_BASH_EVENTS_DIR` is also absent.

Add a new test `compute_bash_events_path_resolves_under_runtime_run_dir` mirroring the conversations path test.

- [ ] **Step 5: Run process tests**

```bash
cd app/src-tauri && cargo test agents::openhands_server::process
```

Expected: All tests pass.

- [ ] **Step 6: Run clippy**

```bash
cd app/src-tauri && cargo clippy -- -D warnings
```

Expected: Clean.

- [ ] **Step 7: Commit**

```bash
git add app/src-tauri/src/agents/openhands_server/process.rs
git commit -m "fix: set OH_BASH_EVENTS_DIR explicitly to skill-scoped workspace dir"
```

**Manual smoke:** Run a workflow step that uses terminal commands. Verify `bash_events/` appears inside the skill workspace directory, not in a temp dir.

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
| 6 | Remove `stopOpenHandsServer` | `cargo test`, `npm run test:unit` | Switch skills, verify fast |
| 7 | Remove `workflow_session_id` from contracts | `npm run codegen`, `cargo test contracts::`, `tsc --noEmit` | None |
| 8 | Collapse event recovery to always-FullHistory | `cargo test agents::openhands_server`, full cargo test, clippy | Send refine message, run workflow step |
| 9 | Optimistic activation | `npm run test:unit`, `tsc --noEmit` | Click skill → page appears immediately → content loads |

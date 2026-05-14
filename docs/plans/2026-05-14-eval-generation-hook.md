# Eval Generation Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically generate eval scenarios after a skill is written and verified, using OpenHands Agent Server hooks to trigger a tracked throwaway eval-generation session.

**Architecture:** PostToolUse hook detects verifier completion → writes marker file → Rust notify watcher launches eval agent → agent returns JSON scenarios → Rust materializes to DB → Stop hook unblocks.

**Tech Stack:** Rust (Tauri), OpenHands Agent Server hooks (bash scripts), SQLite, serde_json

---

### Task 1: HookConfig types and StartConversationRequest extension

**Files:**
- Create: `app/src-tauri/src/agents/hooks/mod.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/types.rs`
- Modify: `app/src-tauri/src/agents/mod.rs`
- Test: `app/src-tauri/src/agents/hooks/mod.rs` (inline tests)

- [ ] **Step 1: Create HookConfig types**

```rust
// app/src-tauri/src/agents/hooks/mod.rs
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct HookConfig {
    #[serde(rename = "pre_tool_use", skip_serializing_if = "Vec::is_empty")]
    pub pre_tool_use: Vec<HookMatcher>,
    #[serde(rename = "post_tool_use", skip_serializing_if = "Vec::is_empty")]
    pub post_tool_use: Vec<HookMatcher>,
    #[serde(rename = "user_prompt_submit", skip_serializing_if = "Vec::is_empty")]
    pub user_prompt_submit: Vec<HookMatcher>,
    #[serde(rename = "session_start", skip_serializing_if = "Vec::is_empty")]
    pub session_start: Vec<HookMatcher>,
    #[serde(rename = "session_end", skip_serializing_if = "Vec::is_empty")]
    pub session_end: Vec<HookMatcher>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub stop: Vec<HookMatcher>,
}

impl HookConfig {
    pub fn new() -> Self {
        Self {
            pre_tool_use: Vec::new(),
            post_tool_use: Vec::new(),
            user_prompt_submit: Vec::new(),
            session_start: Vec::new(),
            session_end: Vec::new(),
            stop: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct HookMatcher {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matcher: Option<String>,
    pub hooks: Vec<HookDefinition>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HookDefinition {
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout: Option<u32>,
}
```

- [ ] **Step 2: Add `hooks` module to agents/mod.rs**

```rust
// app/src-tauri/src/agents/mod.rs — add this line:
pub mod hooks;
```

- [ ] **Step 3: Add hook_config field to StartConversationRequest**

```rust
// app/src-tauri/src/agents/openhands_server/types.rs
// Add import at top:
use crate::agents::hooks::HookConfig;

// Add field to StartConversationRequest struct (after `agent` field):
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartConversationRequest {
    pub workspace: LocalWorkspace,
    // ... existing fields ...
    pub agent: OpenHandsAgent,
    #[serde(rename = "hook_config", skip_serializing_if = "Option::is_none")]
    pub hook_config: Option<HookConfig>,
}
```

- [ ] **Step 4: Update from_runtime_request to include hook_config (None by default)**

```rust
// app/src-tauri/src/agents/openhands_server/types.rs
// In the impl StartConversationRequest::from_runtime_request, add at the end of the struct literal:
            hook_config: None,
```

- [ ] **Step 5: Write tests for HookConfig serialization**

```rust
// app/src-tauri/src/agents/hooks/mod.rs — add at bottom:
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hook_config_serializes_with_snake_case_keys() {
        let config = HookConfig {
            post_tool_use: vec![HookMatcher {
                matcher: Some("task".to_string()),
                hooks: vec![HookDefinition {
                    command: "echo test".to_string(),
                    timeout: Some(10),
                }],
            }],
            stop: vec![HookMatcher {
                matcher: None,
                hooks: vec![HookDefinition {
                    command: "echo stop".to_string(),
                    timeout: None,
                }],
            }],
            pre_tool_use: Vec::new(),
            user_prompt_submit: Vec::new(),
            session_start: Vec::new(),
            session_end: Vec::new(),
        };

        let json = serde_json::to_value(&config).unwrap();
        assert!(json.get("post_tool_use").is_some());
        assert!(json.get("stop").is_some());
        assert!(json.get("pre_tool_use").is_none(), "empty vecs should be skipped");
    }

    #[test]
    fn hook_config_serializes_into_start_conversation_request() {
        use crate::agents::openhands_server::types::{
            ConversationMetadata, LocalWorkspace, NeverConfirmPolicy, OpenHandsAgent,
            OpenHandsAgentContext, OpenHandsTool, SendMessageRequest, StartConversationRequest,
            TextContent,
        };

        let hook_config = HookConfig {
            stop: vec![HookMatcher {
                matcher: None,
                hooks: vec![HookDefinition {
                    command: "echo stop".to_string(),
                    timeout: None,
                }],
            }],
            ..HookConfig::new()
        };

        let request = StartConversationRequest {
            workspace: LocalWorkspace::new("/tmp/workspace"),
            initial_message: Some(SendMessageRequest {
                role: "user".to_string(),
                content: vec![TextContent {
                    content_type: "text".to_string(),
                    text: "hello".to_string(),
                }],
                run: true,
            }),
            max_iterations: 50,
            stuck_detection: true,
            confirmation_policy: NeverConfirmPolicy::default(),
            tags: ConversationMetadata::default(),
            agent: OpenHandsAgent {
                kind: "Agent".to_string(),
                llm: serde_json::json!({"model": "test"}),
                tools: vec![OpenHandsTool {
                    name: "terminal".to_string(),
                    params: serde_json::json!({}),
                }],
                include_default_tools: vec!["FinishTool".to_string()],
                agent_context: OpenHandsAgentContext::default(),
            },
            hook_config: Some(hook_config),
        };

        let json = serde_json::to_value(&request).unwrap();
        assert!(json.get("hook_config").is_some());
        assert!(json["hook_config"].get("stop").is_some());
    }
}
```

- [ ] **Step 6: Run tests and commit**

```bash
cd app/src-tauri && cargo test agents::hooks:: -- --nocapture
cd app/src-tauri && cargo test agents::openhands_server::types:: -- --nocapture
cd app/src-tauri && cargo clippy -- -D warnings
```

```bash
git add app/src-tauri/src/agents/hooks/mod.rs app/src-tauri/src/agents/mod.rs app/src-tauri/src/agents/openhands_server/types.rs
git commit -m "feat: add HookConfig types and StartConversationRequest hook_config field"
```

---

### Task 2: Hook scripts and deployment

**Files:**
- Create: `agent-sources/workspace/hooks/post-tool-use-verify.sh`
- Create: `agent-sources/workspace/hooks/stop-hook.sh`
- Modify: `app/src-tauri/src/commands/workflow/deploy.rs`
- Test: `app/src-tauri/src/commands/workflow/deploy.rs` (inline tests)

- [ ] **Step 1: Create post-tool-use-verify.sh**

```bash
#!/bin/bash
# PostToolUse hook: Detects skill-verifier subagent completion and requests eval generation.
#
# Environment: SKILL_DIR (injected by Rust backend)
# Reads stdin JSON from OpenHands hook protocol.

input=$(cat)
tool_name="${OPENHANDS_TOOL_NAME:-}"

# Only react to task_tool_set (subagent delegation)
if [ "$tool_name" != "task" ] && [ "$tool_name" != "task_tool_set" ]; then
    exit 0
fi

# Check if this was the skill-verifier subagent by inspecting the prompt
if echo "$input" | jq -r '.tool_input.prompt // ""' 2>/dev/null | grep -qi "skill-verifier"; then
    # Check if the subagent returned a pass result
    result=$(echo "$input" | jq -r '.tool_output // ""' 2>/dev/null)
    if echo "$result" | grep -qi '"status"[[:space:]]*:[[:space:]]*"pass"'; then
        mkdir -p "$SKILL_DIR/.vibedata"
        date -u +%s > "$SKILL_DIR/.vibedata/.eval-generation-request"
    fi
fi

exit 0
```

- [ ] **Step 2: Create stop-hook.sh**

```bash
#!/bin/bash
# Stop hook: Blocks agent from finishing while eval generation is in progress.
#
# Environment: SKILL_DIR (injected by Rust backend)
# TTL: 5 minutes (300 seconds)

if [ -f "$SKILL_DIR/.vibedata/.eval-generation-complete" ]; then
    exit 0
fi

if [ ! -f "$SKILL_DIR/.vibedata/.eval-generation-request" ]; then
    exit 0
fi

REQUEST_TIME=$(cat "$SKILL_DIR/.vibedata/.eval-generation-request")
NOW=$(date -u +%s)
ELAPSED=$((NOW - REQUEST_TIME))

if [ "$ELAPSED" -lt 300 ]; then
    echo '{"additionalContext": "Eval scenario generation is in progress. Please wait — this will complete shortly."}'
    exit 2
fi

# Past TTL — allow through even if incomplete
exit 0
```

- [ ] **Step 3: Add hook deployment to deploy.rs**

```rust
// app/src-tauri/src/commands/workflow/deploy.rs
// Add new function after copy_agent_sources_to_skills_dir:

fn resolve_workspace_hooks_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;

    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    let dev_path = repo_root
        .as_ref()
        .map(|r| r.join("agent-sources").join("workspace").join("hooks"));

    match dev_path {
        Some(ref p) if p.is_dir() => p.clone(),
        _ => app_handle
            .path()
            .resource_dir()
            .map(|r| r.join("workspace").join("hooks"))
            .unwrap_or_default(),
    }
}

/// Copy bundled hook scripts into the workspace .openhands/hooks/ directory.
fn copy_hooks_to_workspace(hooks_src: &Path, target_dir: &Path) -> Result<(), String> {
    let hooks_dir = target_dir.join(".openhands").join("hooks");
    if hooks_dir.is_dir() {
        std::fs::remove_dir_all(&hooks_dir)
            .map_err(|e| format!("Failed to clear .openhands/hooks dir: {}", e))?;
    }
    std::fs::create_dir_all(&hooks_dir)
        .map_err(|e| format!("Failed to create .openhands/hooks dir: {}", e))?;

    if !hooks_src.is_dir() {
        return Ok(());
    }

    for hook_entry in std::fs::read_dir(hooks_src)
        .map_err(|e| format!("Failed to read hooks source dir: {}", e))?
    {
        let hook_entry =
            hook_entry.map_err(|e| format!("Failed to read hook entry: {}", e))?;
        let hook_path = hook_entry.path();
        if !hook_path.is_file() {
            continue;
        }
        let dest = hooks_dir.join(hook_entry.file_name());
        std::fs::copy(&hook_path, &dest).map_err(|e| {
            format!(
                "Failed to copy {} to .openhands/hooks: {}",
                hook_path.display(),
                e
            )
        })?;
        // Make executable on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&dest)
                .map_err(|e| format!("Failed to read metadata for {}: {}", dest.display(), e))?
                .permissions();
            perms.set_mode(perms.mode() | 0o755);
            std::fs::set_permissions(&dest, perms)
                .map_err(|e| format!("Failed to set permissions for {}: {}", dest.display(), e))?;
        }
    }
    Ok(())
}
```

- [ ] **Step 4: Integrate hook deployment into ensure_workspace_prompts_inner**

```rust
// app/src-tauri/src/commands/workflow/deploy.rs
// Modify ensure_workspace_prompts_inner to also copy hooks:

pub(crate) fn ensure_workspace_prompts_inner(
    agents_src: &Path,
    skills_src: &Path,
    hooks_src: &Path,
    workspace_path: &str,
) -> Result<(), String> {
    let current_source_sha = compute_dir_sha(&[agents_src, skills_src, hooks_src])?;
    let workspace_key = workspace_path.to_string();
    let workspace_root = Path::new(workspace_path);

    let tier_1_changed = {
        let mut cache_lock = deploy_cache().lock().unwrap_or_else(|e| e.into_inner());
        let entry = cache_lock.entry(workspace_key.clone()).or_default();
        let layout_ok = workspace_root.join(".agents").join("agents").is_dir()
            && workspace_root.join(".agents").join("skills").is_dir()
            && workspace_root.join(".openhands").join("hooks").is_dir();
        let changed =
            entry.source_sha.as_deref() != Some(current_source_sha.as_str()) || !layout_ok;
        if changed {
            entry.source_sha = Some(current_source_sha.clone());
        }
        changed
    };

    if tier_1_changed && (agents_src.is_dir() || skills_src.is_dir() || hooks_src.is_dir()) {
        copy_agent_sources_to_openhands_cwd(agents_src, skills_src, workspace_root)?;
        copy_hooks_to_workspace(hooks_src, workspace_root)?;
    }

    Ok(())
}
```

- [ ] **Step 5: Update all callers of ensure_workspace_prompts_inner**

```rust
// app/src-tauri/src/commands/workflow/deploy.rs — ensure_workspace_prompts:
// Before the spawn_blocking call, resolve hooks dir:
    let hooks_dir = resolve_workspace_hooks_dir(app_handle);

// Update the spawn_blocking closure:
    let hooks = hooks_dir.clone();
    let result = tokio::task::spawn_blocking(move || {
        ensure_workspace_prompts_inner(&agents, &skills, &hooks, &workspace)
    })
```

```rust
// app/src-tauri/src/commands/workflow/deploy.rs — ensure_workspace_prompts_sync:
    let hooks_dir = resolve_workspace_hooks_dir(app_handle);
    ensure_workspace_prompts_inner(&agents_dir, &skills_dir, &hooks_dir, workspace_path)
```

- [ ] **Step 6: Update copy_agent_sources_to_openhands_cwd signature to include hooks**

```rust
// app/src-tauri/src/commands/workflow/deploy.rs
fn copy_agent_sources_to_openhands_cwd(
    agents_src: &Path,
    skills_src: &Path,
    hooks_src: &Path,
    target_dir: &Path,
) -> Result<(), String> {
    copy_agent_sources_to_agents_dir(agents_src, target_dir)?;
    copy_agent_sources_to_skills_dir(skills_src, target_dir)?;
    copy_hooks_to_workspace(hooks_src, target_dir)?;
    Ok(())
}
```

- [ ] **Step 7: Update seed_skill_agents_dir to also copy hooks**

```rust
// app/src-tauri/src/commands/workflow/deploy.rs — seed_skill_agents_dir:
// After resolving agents_src and skills_src, also resolve hooks:
    let hooks_src = resolve_workspace_hooks_dir(app_handle);

    if !agents_src.is_dir() && !skills_src.is_dir() && !hooks_src.is_dir() {
        return Ok(());
    }

    let current_sha = compute_dir_sha(&[&agents_src, &skills_src, &hooks_src])?;
```

```rust
    // In the needs_copy block:
        copy_agent_sources_to_openhands_cwd(&agents_src, &skills_src, &hooks_src, skill_dir)
```

- [ ] **Step 8: Update tests in deploy.rs**

```rust
// app/src-tauri/src/commands/workflow/deploy.rs — tests
// Update bundled_workspace_agents_fixture to also return hooks dir:
fn bundled_workspace_hooks_fixture(root: &Path) -> PathBuf {
    let hooks = root.join("sources").join("workspace").join("hooks");
    std::fs::create_dir_all(&hooks).unwrap();
    hooks
}

// Update copy_agent_sources_populates_openhands_layout test:
    let hooks = bundled_workspace_hooks_fixture(tmp.path());
    copy_agent_sources_to_full_layout(&agents, &skills, &hooks, &workspace).unwrap();
    assert!(workspace.join(".openhands/hooks").is_dir());
```

- [ ] **Step 9: Run tests and commit**

```bash
cd app/src-tauri && cargo test commands::workflow::deploy:: -- --nocapture
cd app/src-tauri && cargo clippy -- -D warnings
```

```bash
git add agent-sources/workspace/hooks/post-tool-use-verify.sh agent-sources/workspace/hooks/stop-hook.sh app/src-tauri/src/commands/workflow/deploy.rs
git commit -m "feat: add hook scripts and deploy hooks to workspace .openhands/hooks/"
```

---

### Task 3: DB schema migration for scenarios/assertions

**Files:**
- Modify: `app/src-tauri/src/db/migrations.rs`
- Modify: `app/src-tauri/src/db/mod.rs`

- [ ] **Step 1: Add migration 58 function**

```rust
// app/src-tauri/src/db/migrations.rs — add after run_canonical_skill_identity_migration:

pub(super) fn run_eval_scenarios_skill_fk_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "DROP TABLE IF EXISTS assertions;
        DROP TABLE IF EXISTS scenarios;

        CREATE TABLE scenarios (
            id TEXT PRIMARY KEY,
            plugin_slug TEXT NOT NULL,
            skill_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            mode TEXT NOT NULL CHECK (mode IN ('performance')),
            prompt TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
        );

        CREATE TABLE assertions (
            id TEXT PRIMARY KEY,
            scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
            assertion TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_scenarios_skill ON scenarios(skill_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_scenarios_plugin ON scenarios(plugin_slug, sort_order);
        CREATE INDEX IF NOT EXISTS idx_assertions_scenario ON assertions(scenario_id, sort_order);",
    )?;
    log::info!("migration 58: rebuilt scenarios/assertions tables with skill_id FK");
    Ok(())
}
```

- [ ] **Step 2: Register migration 58**

```rust
// app/src-tauri/src/db/migrations.rs — NUMBERED_MIGRATIONS array:
    (57, run_settings_table_normalization_migration),
    (58, run_eval_scenarios_skill_fk_migration),
];
```

- [ ] **Step 3: Run migration tests**

```bash
cd app/src-tauri && cargo test db:: -- --nocapture
cd app/src-tauri && cargo clippy -- -D warnings
```

```bash
git add app/src-tauri/src/db/migrations.rs app/src-tauri/src/db/mod.rs
git commit -m "feat: add migration 58 — rebuild scenarios/assertions with skill_id FK"
```

---

### Task 4: DB eval_workbench module — skill_id based operations

**Files:**
- Modify: `app/src-tauri/src/db/eval_workbench.rs`

- [ ] **Step 1: Update Scenario struct to use skill_id**

```rust
// app/src-tauri/src/db/eval_workbench.rs
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub id: String,
    pub plugin_slug: String,
    pub skill_id: i64,
    pub name: String,
    pub description: String,
    pub mode: EvalWorkbenchMode,
    pub prompt: String,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
    pub assertions: Vec<String>,
}
```

- [ ] **Step 2: Update SaveScenario struct**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveScenario {
    pub id: Option<String>,
    pub plugin_slug: String,
    pub skill_id: i64,
    pub name: String,
    pub description: String,
    pub mode: EvalWorkbenchMode,
    pub prompt: String,
    pub assertions: Vec<String>,
}
```

- [ ] **Step 3: Update save_scenario SQL**

```rust
pub fn save_scenario(conn: &mut Connection, input: SaveScenario) -> Result<Scenario, String> {
    let scenario_id = input.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let timestamp = now();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO scenarios (
            id, plugin_slug, skill_id, name, description, mode, prompt, sort_order, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?8)
        ON CONFLICT(id) DO UPDATE SET
            plugin_slug = excluded.plugin_slug,
            skill_id = excluded.skill_id,
            name = excluded.name,
            description = excluded.description,
            mode = excluded.mode,
            prompt = excluded.prompt,
            sort_order = excluded.sort_order,
            updated_at = excluded.updated_at",
        params![
            scenario_id,
            input.plugin_slug,
            input.skill_id,
            input.name,
            input.description,
            input.mode.as_str(),
            input.prompt,
            0i64,
            timestamp,
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM assertions WHERE scenario_id = ?1",
        params![scenario_id],
    )
    .map_err(|e| e.to_string())?;

    for (index, assertion) in input.assertions.iter().enumerate() {
        let assertion_id = format!("assert-{}", uuid::Uuid::new_v4());
        tx.execute(
            "INSERT INTO assertions (id, scenario_id, assertion, sort_order)
             VALUES (?1, ?2, ?3, ?4)",
            params![assertion_id, scenario_id, assertion, index as i64],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    read_scenario(conn, &input.plugin_slug, input.skill_id, &input.name)?
        .ok_or_else(|| "Scenario not found".to_string())
}
```

- [ ] **Step 4: Update list_scenarios to query by skill_id**

```rust
pub fn list_scenarios_by_skill(
    conn: &Connection,
    skill_id: i64,
) -> Result<Vec<Scenario>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, plugin_slug, skill_id, name, description, mode, prompt, sort_order, created_at, updated_at
             FROM scenarios
             WHERE skill_id = ?1
             ORDER BY sort_order ASC, name ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![skill_id], |row| {
            let mode_str: String = row.get(5)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                mode_str,
                row.get::<_, String>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    drop(stmt);

    let mut scenarios = Vec::with_capacity(rows.len());
    for (id, pslug, sid, name, description, mode_str, prompt, sort_order, created_at, updated_at) in rows {
        let assertions = read_assertions(conn, &id)?;
        scenarios.push(Scenario {
            id,
            plugin_slug: pslug,
            skill_id: sid,
            name,
            description,
            mode: EvalWorkbenchMode::parse(&mode_str)?,
            prompt,
            sort_order,
            created_at,
            updated_at,
            assertions,
        });
    }

    Ok(scenarios)
}
```

- [ ] **Step 5: Update read_scenario**

```rust
pub fn read_scenario(
    conn: &Connection,
    plugin_slug: &str,
    skill_id: i64,
    name: &str,
) -> Result<Option<Scenario>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, plugin_slug, skill_id, name, description, mode, prompt, sort_order, created_at, updated_at
             FROM scenarios
             WHERE plugin_slug = ?1 AND skill_id = ?2 AND name = ?3",
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt
        .query(params![plugin_slug, skill_id, name])
        .map_err(|e| e.to_string())?;
    let Some(row) = rows.next().map_err(|e| e.to_string())? else {
        return Ok(None);
    };

    let mode_str: String = row.get(5).map_err(|e| e.to_string())?;
    let id: String = row.get(0).map_err(|e| e.to_string())?;
    let assertions = read_assertions(conn, &id)?;

    Ok(Some(Scenario {
        id,
        plugin_slug: row.get(1).map_err(|e| e.to_string())?,
        skill_id: row.get(2).map_err(|e| e.to_string())?,
        name: row.get(3).map_err(|e| e.to_string())?,
        description: row.get(4).map_err(|e| e.to_string())?,
        mode: EvalWorkbenchMode::parse(&mode_str)?,
        prompt: row.get(6).map_err(|e| e.to_string())?,
        sort_order: row.get(7).map_err(|e| e.to_string())?,
        created_at: row.get(8).map_err(|e| e.to_string())?,
        updated_at: row.get(9).map_err(|e| e.to_string())?,
        assertions,
    }))
}
```

- [ ] **Step 6: Update delete_scenario**

```rust
pub fn delete_scenario(
    conn: &mut Connection,
    plugin_slug: &str,
    skill_id: i64,
    name: &str,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM scenarios WHERE plugin_slug = ?1 AND skill_id = ?2 AND name = ?3",
        params![plugin_slug, skill_id, name],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 7: Add materialize_eval_scenarios function**

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct GeneratedScenario {
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub assertions: Vec<String>,
}

pub fn materialize_eval_scenarios(
    conn: &mut Connection,
    plugin_slug: &str,
    skill_id: i64,
    scenarios_json: &str,
) -> Result<Vec<String>, String> {
    let generated: Vec<GeneratedScenario> =
        serde_json::from_str(scenarios_json).map_err(|e| format!("Failed to parse scenarios JSON: {}", e))?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut created_ids = Vec::new();

    for scenario in &generated {
        let scenario_id = format!("case-{}", uuid::Uuid::new_v4().simple());
        let timestamp = now();

        tx.execute(
            "INSERT INTO scenarios (
                id, plugin_slug, skill_id, name, description, mode, prompt, sort_order, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'performance', ?6, ?7, ?8, ?8)",
            params![
                scenario_id,
                plugin_slug,
                skill_id,
                scenario.name,
                scenario.description,
                scenario.prompt,
                created_ids.len() as i64,
                timestamp,
            ],
        )
        .map_err(|e| e.to_string())?;

        for (index, assertion) in scenario.assertions.iter().enumerate() {
            let assertion_id = format!("assert-{}", uuid::Uuid::new_v4());
            tx.execute(
                "INSERT INTO assertions (id, scenario_id, assertion, sort_order)
                 VALUES (?1, ?2, ?3, ?4)",
                params![assertion_id, scenario_id, assertion, index as i64],
            )
            .map_err(|e| e.to_string())?;
        }

        created_ids.push(scenario_id);
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(created_ids)
}
```

- [ ] **Step 8: Update tests**

```rust
// app/src-tauri/src/db/eval_workbench.rs — tests
// Update test helpers to use skill_id:
    fn save_scenario_input(
        plugin_slug: &str,
        skill_id: i64,
        name: &str,
        mode: EvalWorkbenchMode,
        prompt: &str,
        assertions: Vec<&str>,
    ) -> SaveScenario {
        SaveScenario {
            id: None,
            plugin_slug: plugin_slug.to_string(),
            skill_id,
            name: name.to_string(),
            description: "Test scenario".to_string(),
            mode,
            prompt: prompt.to_string(),
            assertions: assertions.into_iter().map(String::from).collect(),
        }
    }

// Update saves_and_reads test:
        let saved = save_scenario(&mut conn, save_scenario_input("skills", 1, "Smoke", ...)).unwrap();
        let read = read_scenario(&conn, "skills", 1, "Smoke").unwrap().unwrap();

// Update lists_scenarios_for_skill test:
        let list = list_scenarios_by_skill(&conn, 1).unwrap();

// Update deletes_scenario test:
        delete_scenario(&mut conn, "skills", 1, "Delete me").unwrap();
```

- [ ] **Step 9: Run tests and commit**

```bash
cd app/src-tauri && cargo test db::eval_workbench:: -- --nocapture
cd app/src-tauri && cargo clippy -- -D warnings
```

```bash
git add app/src-tauri/src/db/eval_workbench.rs
git commit -m "feat: update eval_workbench DB module for skill_id-based operations and materialize_eval_scenarios"
```

---

### Task 5: Eval agent config builder

**Files:**
- Create: `app/src-tauri/src/agents/eval_generator.rs`
- Create: `agent-sources/prompts/eval-generation.txt`
- Modify: `app/src-tauri/src/agents/mod.rs`

- [ ] **Step 1: Create eval-generation.txt prompt**

```
# Eval Scenario Generator

You are an eval scenario generator. Analyze the provided skill and generate comprehensive test scenarios.

## Input Context

You will receive:
- The generated SKILL.md content
- Workflow clarifications from the user
- Workflow decisions made during skill creation

## Task

1. Analyze the SKILL.md to understand the skill's purpose, capabilities, and expected behavior
2. Identify key user flows, edge cases, and failure modes
3. Generate 5-8 eval scenarios covering:
   - Happy path: typical successful usage
   - Edge cases: unusual inputs, boundary conditions
   - Error handling: how the skill handles invalid or missing data
   - Performance: scenarios that test response quality and completeness

## Output Format

Return a JSON object with a `scenarios` array. Each scenario must have:

```json
{
  "scenarios": [
    {
      "name": "Short descriptive name",
      "description": "One-sentence description of what this scenario tests",
      "prompt": "The user input that would trigger this scenario",
      "assertions": [
        "Expected behavior or output characteristic 1",
        "Expected behavior or output characteristic 2"
      ]
    }
  ]
}
```

## Guidelines

- Names should be concise but descriptive
- Descriptions should clearly state what aspect is being tested
- Prompts should be realistic user inputs
- Assertions should be specific and verifiable
- Cover diverse scenarios — don't generate 5 variations of the same test
```

- [ ] **Step 2: Create eval_generator.rs**

```rust
// app/src-tauri/src/agents/eval_generator.rs
use std::path::Path;

use crate::agents::runtime_config::{
    build_openhands_runtime_config, BuildOpenHandsRuntimeConfigParams, OpenHandsRuntimeMode,
    OpenHandsRuntimeConfig,
};
use crate::types::WorkflowLlmConfig;

pub const EVAL_GENERATION_PROMPT_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/eval-generation.txt"
));

pub struct EvalGeneratorConfigParams<'a> {
    pub app_data_root: &'a str,
    pub plugin_slug: &'a str,
    pub skill_name: &'a str,
    pub skill_id: i64,
    pub skills_root: &'a str,
    pub skill_dir: &'a str,
    pub llm: WorkflowLlmConfig,
    pub user_message: &'a str,
}

pub fn build_eval_generator_config(params: EvalGeneratorConfigParams<'_>) -> OpenHandsRuntimeConfig {
    let prompt = format!(
        "{template}\n\n## Skill Context\n\n{user_message}",
        template = EVAL_GENERATION_PROMPT_TEMPLATE.trim(),
        user_message = params.user_message,
    );

    build_openhands_runtime_config(BuildOpenHandsRuntimeConfigParams {
        prompt,
        llm: params.llm,
        app_data_root: params.app_data_root.to_string(),
        skills_root: params.skills_root.replace('\\', "/"),
        skill_dir: params.skill_dir.replace('\\', "/"),
        mode: Some(OpenHandsRuntimeMode::Throwaway),
        agent_name: "skill-creator".to_string(),
        task_kind: Some("eval-generation".to_string()),
        user_message_suffix: None,
        allowed_tools: vec!["file_editor".to_string(), "terminal".to_string()],
        max_turns: 50,
        output_format: Some(eval_generation_output_format()),
        skill_name: Some(params.skill_name.to_string()),
        step_id: Some(-20),
        run_source: Some("eval-generation".to_string()),
        plugin_slug: params.plugin_slug.to_string(),
    })
}

fn eval_generation_output_format() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "scenarios": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "description": { "type": "string" },
                        "prompt": { "type": "string" },
                        "assertions": {
                            "type": "array",
                            "items": { "type": "string" }
                        }
                    },
                    "required": ["name", "description", "prompt", "assertions"]
                }
            }
        },
        "required": ["scenarios"]
    })
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
    fn test_build_eval_generator_config_sets_correct_fields() {
        let config = build_eval_generator_config(EvalGeneratorConfigParams {
            app_data_root: "/tmp/app-data",
            plugin_slug: "default",
            skill_name: "test-skill",
            skill_id: 1,
            skills_root: "/tmp/skills",
            skill_dir: "/tmp/skills/default/skills/test-skill",
            llm: test_llm_config(),
            user_message: "Test skill content",
        });

        assert_eq!(config.agent_name, Some("skill-creator".to_string()));
        assert_eq!(config.task_kind, Some("eval-generation".to_string()));
        assert_eq!(config.run_source, Some("eval-generation".to_string()));
        assert_eq!(config.max_turns, Some(50));
        assert_eq!(config.skill_name, Some("test-skill".to_string()));
        assert!(config.skill_dir.contains("test-skill"));
        assert!(config.output_format.is_some());
    }

    #[test]
    fn eval_generation_prompt_template_is_non_empty() {
        assert!(!EVAL_GENERATION_PROMPT_TEMPLATE.trim().is_empty());
    }
}
```

- [ ] **Step 3: Add eval_generator module to agents/mod.rs**

```rust
// app/src-tauri/src/agents/mod.rs — add:
pub mod eval_generator;
```

- [ ] **Step 4: Run tests and commit**

```bash
cd app/src-tauri && cargo test agents::eval_generator:: -- --nocapture
cd app/src-tauri && cargo clippy -- -D warnings
```

```bash
git add agent-sources/prompts/eval-generation.txt app/src-tauri/src/agents/eval_generator.rs app/src-tauri/src/agents/mod.rs
git commit -m "feat: add eval generator agent config builder and prompt"
```

---

### Task 6: HookConfig builder for skill-creator conversations

**Files:**
- Modify: `app/src-tauri/src/agents/skill_creator.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/types.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`

- [ ] **Step 1: Add hook_config field to OpenHandsRuntimeRequest**

```rust
// app/src-tauri/src/agents/openhands_server/types.rs
// Add import at top of file:
use crate::agents::hooks::HookConfig;

// Add field to OpenHandsRuntimeRequest struct:
pub struct OpenHandsRuntimeRequest {
    // ... existing fields ...
    pub hook_config: Option<HookConfig>,
}
```

- [ ] **Step 2: Update try_from_runtime_config to propagate hook_config**

```rust
// app/src-tauri/src/agents/openhands_server/types.rs
// In OpenHandsRuntimeRequest::try_from_runtime_config:
        Ok(Self {
            // ... existing fields ...
            hook_config: config.hook_config.clone(),
        })
```

- [ ] **Step 3: Add hook_config field to OpenHandsRuntimeConfig**

```rust
// app/src-tauri/src/agents/runtime_config.rs
// Add import:
use crate::agents::hooks::HookConfig;

// Add field to OpenHandsRuntimeConfig struct:
    #[serde(rename = "hookConfig", skip_serializing_if = "Option::is_none")]
    pub hook_config: Option<HookConfig>,
```

- [ ] **Step 4: Update build_openhands_runtime_config to accept hook_config**

```rust
// app/src-tauri/src/agents/runtime_config.rs
// Add to BuildOpenHandsRuntimeConfigParams:
    pub hook_config: Option<HookConfig>,

// In build_openhands_runtime_config body:
        hook_config: params.hook_config,
```

- [ ] **Step 5: Update StartConversationRequest::from_runtime_request to use hook_config**

```rust
// app/src-tauri/src/agents/openhands_server/types.rs
// In from_runtime_request:
            hook_config: request.hook_config.clone(),
```

- [ ] **Step 6: Build hook config in skill_creator.rs**

```rust
// app/src-tauri/src/agents/skill_creator.rs
// Add import:
use crate::agents::hooks::{HookConfig, HookDefinition, HookMatcher};

// Add function:
pub fn build_skill_creator_hook_config(skill_dir: &str) -> HookConfig {
    let hooks_dir = format!("{}/.openhands/hooks", skill_dir);
    HookConfig {
        post_tool_use: vec![HookMatcher {
            matcher: Some("*".to_string()),
            hooks: vec![HookDefinition {
                command: format!("SKILL_DIR=\"{}\" bash \"{}/post-tool-use-verify.sh\"", skill_dir, hooks_dir),
                timeout: Some(10),
            }],
        }],
        stop: vec![HookMatcher {
            matcher: None,
            hooks: vec![HookDefinition {
                command: format!("SKILL_DIR=\"{}\" bash \"{}/stop-hook.sh\"", skill_dir, hooks_dir),
                timeout: Some(10),
            }],
        }],
        ..HookConfig::new()
    }
}
```

- [ ] **Step 7: Pass hook_config when building skill-creator config**

```rust
// app/src-tauri/src/agents/skill_creator.rs
// In build_skill_creator_config, add to the build_openhands_runtime_config call:
        hook_config: Some(build_skill_creator_hook_config(&skill_dir)),
```

- [ ] **Step 8: Update all other callers of build_openhands_runtime_config to pass None**

Search for all `build_openhands_runtime_config` calls and add `hook_config: None` to their params.

- [ ] **Step 9: Update Debug impl for OpenHandsRuntimeConfig**

```rust
// app/src-tauri/src/agents/runtime_config.rs
// In the Debug impl, add:
            .field("hook_config", &self.hook_config.as_ref().map(|_| "[configured]"))
```

- [ ] **Step 10: Run tests and commit**

```bash
cd app/src-tauri && cargo test agents::skill_creator:: -- --nocapture
cd app/src-tauri && cargo test agents::runtime_config:: -- --nocapture
cd app/src-tauri && cargo clippy -- -D warnings
```

```bash
git add app/src-tauri/src/agents/skill_creator.rs app/src-tauri/src/agents/openhands_server/types.rs app/src-tauri/src/agents/openhands_server/mod.rs app/src-tauri/src/agents/runtime_config.rs
git commit -m "feat: thread HookConfig through OpenHandsRuntimeConfig to StartConversationRequest"
```

---

### Task 7: Eval watcher for generation requests

**Files:**
- Create: `app/src-tauri/src/agents/eval_watcher.rs`
- Modify: `app/src-tauri/src/agents/mod.rs`

- [ ] **Step 1: Create eval_watcher.rs**

```rust
// app/src-tauri/src/agents/eval_watcher.rs
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;

use crate::agents::eval_generator::{build_eval_generator_config, EvalGeneratorConfigParams};
use crate::agents::tracked_openhands::{run_tracked_throwaway_openhands_session, OpenHandsThrowawayRunParams};
use crate::commands::workflow::read_initialized_runtime_context;

const VIBEDATA_DIR: &str = ".vibedata";
const REQUEST_FILE: &str = ".eval-generation-request";
const COMPLETE_FILE: &str = ".eval-generation-complete";

pub struct EvalWatcherHandle {
    stop_flag: Arc<AtomicBool>,
}

impl EvalWatcherHandle {
    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::SeqCst);
    }
}

/// Start polling a skill directory for eval generation requests.
/// Returns a handle that can stop the watcher.
pub fn start_eval_watcher(
    app: tauri::AppHandle,
    skill_dir: PathBuf,
    plugin_slug: String,
    skill_name: String,
    skill_id: i64,
) -> EvalWatcherHandle {
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_clone = stop_flag.clone();

    tokio::spawn(async move {
        run_eval_watcher_loop(
            app,
            skill_dir,
            plugin_slug,
            skill_name,
            skill_id,
            stop_flag_clone,
        )
        .await;
    });

    EvalWatcherHandle { stop_flag }
}

async fn run_eval_watcher_loop(
    app: tauri::AppHandle,
    skill_dir: PathBuf,
    plugin_slug: String,
    skill_name: String,
    skill_id: i64,
    stop_flag: Arc<AtomicBool>,
) {
    let vibedata_dir = skill_dir.join(VIBEDATA_DIR);
    let request_path = vibedata_dir.join(REQUEST_FILE);

    if let Err(e) = std::fs::create_dir_all(&vibedata_dir) {
        log::warn!("[eval-watcher] failed to create .vibedata dir: {}", e);
        return;
    }

    log::info!(
        "[eval-watcher] polling {} for eval generation requests",
        vibedata_dir.display()
    );

    loop {
        if stop_flag.load(Ordering::SeqCst) {
            log::debug!("[eval-watcher] stop flag set, exiting");
            break;
        }

        if request_path.exists() {
            log::info!("[eval-watcher] eval generation request detected for {}", skill_name);
            handle_eval_generation_request(
                &app,
                &skill_dir,
                &plugin_slug,
                &skill_name,
                skill_id,
            ).await;
            break;
        }

        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

async fn handle_eval_generation_request(
    app: &tauri::AppHandle,
    skill_dir: &std::path::Path,
    plugin_slug: &str,
    skill_name: &str,
    skill_id: i64,
) {
    // Read skill content for context
    let skill_md_path = skill_dir.join("SKILL.md");
    let skill_content = match std::fs::read_to_string(&skill_md_path) {
        Ok(content) => content,
        Err(e) => {
            log::warn!("[eval-watcher] failed to read SKILL.md: {}", e);
            return;
        }
    };

    // Read clarifications and decisions from DB
    let (clarifications, decisions) = {
        let db_state = app.state::<crate::db::Db>();
        let conn = match db_state.0.lock() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("[eval-watcher] failed to lock DB: {}", e);
                return;
            }
        };
        let skill_id_str = skill_id.to_string();
        let clarifications = crate::db::workflow_artifacts::read_clarifications(&conn, &skill_id_str)
            .ok()
            .flatten()
            .map(|r| serde_json::to_string(&r).unwrap_or_default())
            .unwrap_or_default();
        let decisions = crate::db::workflow_artifacts::read_decisions(&conn, &skill_id_str)
            .ok()
            .flatten()
            .map(|r| serde_json::to_string(&r).unwrap_or_default())
            .unwrap_or_default();
        (clarifications, decisions)
    };

    let user_message = format!(
        "Generate eval scenarios for this skill:\n\n## SKILL.md\n\n{}\n\n## Clarifications\n\n{}\n\n## Decisions\n\n{}",
        skill_content, clarifications, decisions
    );

    // Get runtime context (LLM config + skills_root)
    let db_state = app.state::<crate::db::Db>();
    let runtime_ctx = match read_initialized_runtime_context(&db_state) {
        Ok(ctx) => ctx,
        Err(e) => {
            log::warn!("[eval-watcher] failed to read runtime context: {}", e);
            return;
        }
    };

    let app_data_root = match app.path().app_data_dir() {
        Ok(p) => p.to_string_lossy().replace('\\', "/"),
        Err(e) => {
            log::warn!("[eval-watcher] failed to resolve app data dir: {}", e);
            return;
        }
    };

    let skill_dir_str = skill_dir.to_string_lossy().replace('\\', "/");

    let config = build_eval_generator_config(EvalGeneratorConfigParams {
        app_data_root: &app_data_root,
        plugin_slug,
        skill_name,
        skill_id,
        skills_root: &runtime_ctx.skills_root,
        skill_dir: &skill_dir_str,
        llm: runtime_ctx.llm,
        user_message: &user_message,
    });

    let agent_id = format!("{}-eval-gen-{}", skill_name, uuid::Uuid::new_v4());

    // Deploy runtime dir
    if let Err(e) = crate::commands::workflow::deploy::ensure_openhands_runtime_dir(app, skill_dir).await {
        log::warn!("[eval-watcher] failed to deploy runtime dir: {}", e);
        return;
    }

    // Run the throwaway session
    let run_result = run_tracked_throwaway_openhands_session(
        app,
        OpenHandsThrowawayRunParams {
            agent_id: agent_id.clone(),
            config,
            timeout: Duration::from_secs(300),
        },
    )
    .await;

    match run_result {
        Ok(run) => {
            // Parse the agent's JSON output and materialize to DB
            if let Some(result_text) = run.conversation_state.get("result_text").and_then(|v| v.as_str()) {
                let cleaned = clean_openhands_structured_result_text(result_text);
                let parsed: serde_json::Value = match serde_json::from_str(cleaned) {
                    Ok(v) => v,
                    Err(e) => {
                        log::warn!("[eval-watcher] failed to parse eval output: {}", e);
                        write_complete_marker(skill_dir);
                        return;
                    }
                };

                if let Some(scenarios_arr) = parsed.get("scenarios").and_then(|v| v.as_array()) {
                    let scenarios_json = serde_json::to_string(scenarios_arr).unwrap_or_default();
                    let db_state = app.state::<crate::db::Db>();
                    if let Ok(mut conn) = db_state.0.lock() {
                        match crate::db::eval_workbench::materialize_eval_scenarios(&mut conn, plugin_slug, skill_id, &scenarios_json) {
                            Ok(ids) => {
                                log::info!("[eval-watcher] materialized {} eval scenarios for {}", ids.len(), skill_name);
                            }
                            Err(e) => {
                                log::warn!("[eval-watcher] failed to materialize scenarios: {}", e);
                            }
                        }
                    }
                }
            }

            write_complete_marker(skill_dir);
        }
        Err(e) => {
            log::warn!("[eval-watcher] eval generation session failed: {}", e);
            write_complete_marker(skill_dir);
        }
    }
}

fn write_complete_marker(skill_dir: &std::path::Path) {
    let vibedata_dir = skill_dir.join(VIBEDATA_DIR);
    let _ = std::fs::create_dir_all(&vibedata_dir);
    let complete_path = vibedata_dir.join(COMPLETE_FILE);
    if let Err(e) = std::fs::write(&complete_path, format!("{}", chrono::Utc::now().to_rfc3339())) {
        log::warn!("[eval-watcher] failed to write complete marker: {}", e);
    }
}

fn clean_openhands_structured_result_text(text: &str) -> &str {
    text.trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
}
```

- [ ] **Step 2: Add eval_watcher module to agents/mod.rs**

```rust
// app/src-tauri/src/agents/mod.rs — add:
pub mod eval_watcher;
```

- [ ] **Step 3: Run tests and commit**

```bash
cd app/src-tauri && cargo check
cd app/src-tauri && cargo clippy -- -D warnings
```

```bash
git add app/src-tauri/src/agents/eval_watcher.rs app/src-tauri/src/agents/mod.rs
git commit -m "feat: add eval watcher — polls for eval generation requests"
```

---

### Task 8: Integrate eval watcher into skill-creator workflow

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs` (or wherever skill-creator session is started)

- [ ] **Step 1: Start eval watcher when skill-creator conversation starts**

Find where the skill-creator session is started (likely in the workflow step dispatch) and add:

```rust
// After starting the skill-creator conversation:
let watcher_handle = crate::agents::eval_watcher::start_eval_watcher(
    app.clone(),
    std::path::PathBuf::from(&config.skill_dir),
    config.plugin_slug.clone(),
    config.skill_name.clone().unwrap_or_default(),
    skill_id, // from DB
);
```

- [ ] **Step 2: Store watcher handle for cleanup**

The watcher handle should be stored alongside the conversation tracking so it can be stopped when the conversation ends. This integrates with the existing tracked conversation infrastructure.

- [ ] **Step 3: Stop watcher on conversation end**

When the skill-creator conversation completes or is cancelled, call `watcher_handle.stop()`.

- [ ] **Step 4: Run tests and commit**

```bash
cd app/src-tauri && cargo check
cd app/src-tauri && cargo clippy -- -D warnings
```

```bash
git add app/src-tauri/src/commands/workflow/runtime.rs
git commit -m "feat: integrate eval watcher into skill-creator workflow lifecycle"
```

---

### Task 9: Update eval workbench Tauri commands for DB-backed operations

**Files:**
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `app/src-tauri/src/commands/eval_workbench/types.rs`
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Update list_scenarios to use skill_id**

```rust
// app/src-tauri/src/commands/eval_workbench/mod.rs
#[tauri::command]
pub fn list_scenarios(
    skill_id: i64,
    db: tauri::State<'_, Db>,
) -> Result<Vec<ScenarioSummaryDto>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::eval_workbench::list_scenarios_by_skill(&conn, skill_id)
        .map(|items| items.into_iter().map(scenario_summary_to_dto).collect())
}
```

- [ ] **Step 2: Update load_scenario**

```rust
#[tauri::command]
pub fn load_scenario(
    skill_id: i64,
    scenario_name: String,
    db: tauri::State<'_, Db>,
) -> Result<Option<ScenarioDto>, String> {
    scenarios::validate_scenario_name(&scenario_name)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let plugin_slug = resolve_plugin_slug_for_skill(&conn, skill_id)?;
    crate::db::eval_workbench::read_scenario(&conn, &plugin_slug, skill_id, &scenario_name)
        .map(|scenario| scenario.map(scenario_to_dto))
}
```

- [ ] **Step 3: Update create_scenario**

```rust
#[tauri::command]
pub fn create_scenario(
    skill_id: i64,
    db: tauri::State<'_, Db>,
) -> Result<ScenarioDto, String> {
    let plugin_slug = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        resolve_plugin_slug_for_skill(&conn, skill_id)?
    };
    let name = "Performance 1".to_string(); // Simple default — user can rename
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let scenario = crate::db::eval_workbench::save_scenario(&mut *conn, crate::db::eval_workbench::SaveScenario {
        id: None,
        plugin_slug,
        skill_id,
        name,
        description: String::new(),
        mode: crate::db::eval_workbench::EvalWorkbenchMode::Performance,
        prompt: String::new(),
        assertions: vec![],
    })?;
    Ok(scenario_to_dto(scenario))
}
```

- [ ] **Step 4: Update save_scenario**

```rust
#[tauri::command]
pub fn save_scenario(
    skill_id: i64,
    scenario: ScenarioDto,
    previous_scenario_name: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<ScenarioDto, String> {
    let plugin_slug = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        resolve_plugin_slug_for_skill(&conn, skill_id)?
    };
    let scenario = scenario_from_dto(scenario)?;
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let db_scenario = crate::db::eval_workbench::save_scenario(&mut *conn, crate::db::eval_workbench::SaveScenario {
        id: Some(scenario.id),
        plugin_slug,
        skill_id,
        name: scenario.name,
        description: String::new(),
        mode: crate::db::eval_workbench::EvalWorkbenchMode::Performance,
        prompt: scenario.prompt,
        assertions: scenario.expectations,
    })?;
    Ok(scenario_to_dto(db_scenario))
}
```

- [ ] **Step 5: Update delete_scenario**

```rust
#[tauri::command]
pub fn delete_scenario(
    skill_id: i64,
    scenario_name: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    scenarios::validate_scenario_name(&scenario_name)?;
    let plugin_slug = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        resolve_plugin_slug_for_skill(&conn, skill_id)?
    };
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::eval_workbench::delete_scenario(&mut *conn, &plugin_slug, skill_id, &scenario_name)
}
```

- [ ] **Step 6: Add materialize_eval_scenarios Tauri command**

```rust
#[tauri::command]
pub fn materialize_eval_scenarios(
    plugin_slug: String,
    skill_id: i64,
    scenarios_json: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<String>, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::eval_workbench::materialize_eval_scenarios(&mut *conn, &plugin_slug, skill_id, &scenarios_json)
}
```

- [ ] **Step 7: Add helper to resolve plugin_slug from skill_id**

```rust
fn resolve_plugin_slug_for_skill(conn: &rusqlite::Connection, skill_id: i64) -> Result<String, String> {
    conn.query_row(
        "SELECT plugin_slug FROM skills WHERE id = ?1",
        params![skill_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| format!("Failed to resolve plugin slug for skill {}: {}", skill_id, e))
}
```

- [ ] **Step 8: Update lib.rs command registration**

```rust
// app/src-tauri/src/lib.rs — update eval_workbench commands:
            commands::eval_workbench::list_scenarios,
            commands::eval_workbench::load_scenario,
            commands::eval_workbench::create_scenario,
            commands::eval_workbench::save_scenario,
            commands::eval_workbench::delete_scenario,
            commands::eval_workbench::materialize_eval_scenarios,
            // Remove: commands::eval_workbench::define_eval_scenario,
```

- [ ] **Step 9: Update types.rs ScenarioDto to include description**

```rust
// app/src-tauri/src/commands/eval_workbench/types.rs
pub struct ScenarioDto {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub prompt: String,
    pub assertions: Vec<String>,
}
```

- [ ] **Step 10: Update scenario_to_dto**

```rust
fn scenario_to_dto(scenario: crate::db::eval_workbench::Scenario) -> ScenarioDto {
    ScenarioDto {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        tags: vec![scenario.mode.as_str().to_string()],
        prompt: scenario.prompt,
        assertions: scenario.assertions,
    }
}
```

- [ ] **Step 11: Run tests and commit**

```bash
cd app/src-tauri && cargo test commands::eval_workbench:: -- --nocapture
cd app/src-tauri && cargo clippy -- -D warnings
```

```bash
git add app/src-tauri/src/commands/eval_workbench/mod.rs app/src-tauri/src/commands/eval_workbench/types.rs app/src-tauri/src/lib.rs
git commit -m "feat: update eval workbench commands for DB-backed skill_id operations"
```
    crate::db::eval_workbench::delete_scenario(&mut conn, &plugin_slug, skill_id, &scenario_name)
}
```

- [ ] **Step 6: Add materialize_eval_scenarios Tauri command**

```rust
#[tauri::command]
pub fn materialize_eval_scenarios(
    plugin_slug: String,
    skill_id: i64,
    scenarios_json: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<String>, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::eval_workbench::materialize_eval_scenarios(&mut conn, &plugin_slug, skill_id, &scenarios_json)
}
```

- [ ] **Step 7: Add helper to resolve plugin_slug from skill_id**

```rust
fn resolve_plugin_slug_for_skill(conn: &rusqlite::Connection, skill_id: i64) -> Result<String, String> {
    conn.query_row(
        "SELECT plugin_slug FROM skills WHERE id = ?1",
        params![skill_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| format!("Failed to resolve plugin slug for skill {}: {}", skill_id, e))
}
```

- [ ] **Step 8: Update lib.rs command registration**

```rust
// app/src-tauri/src/lib.rs — update eval_workbench commands:
            commands::eval_workbench::list_scenarios,
            commands::eval_workbench::load_scenario,
            commands::eval_workbench::create_scenario,
            commands::eval_workbench::save_scenario,
            commands::eval_workbench::delete_scenario,
            commands::eval_workbench::materialize_eval_scenarios,
            // Remove: commands::eval_workbench::define_eval_scenario,
```

- [ ] **Step 9: Update types.rs ScenarioDto to include description**

```rust
// app/src-tauri/src/commands/eval_workbench/types.rs
pub struct ScenarioDto {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub prompt: String,
    pub assertions: Vec<String>,
}
```

- [ ] **Step 10: Update scenario_to_dto and scenario_from_dto**

```rust
fn scenario_to_dto(scenario: crate::db::eval_workbench::Scenario) -> ScenarioDto {
    ScenarioDto {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        tags: scenario_tag_strings(&scenario.tags),
        prompt: scenario.prompt,
        assertions: scenario.assertions,
    }
}
```

Note: The Scenario struct from db::eval_workbench doesn't have tags — it has mode. Update the mapping accordingly.

- [ ] **Step 11: Run tests and commit**

```bash
cd app/src-tauri && cargo test commands::eval_workbench:: -- --nocapture
cd app/src-tauri && cargo clippy -- -D warnings
```

```bash
git add app/src-tauri/src/commands/eval_workbench/mod.rs app/src-tauri/src/commands/eval_workbench/types.rs app/src-tauri/src/lib.rs
git commit -m "feat: update eval workbench commands for DB-backed skill_id operations"
```

---

### Task 10: Startup cleanup — delete legacy eval folders

**Files:**
- Modify: `app/src-tauri/src/cleanup.rs`
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Add startup eval cleanup function**

```rust
// app/src-tauri/src/cleanup.rs
/// Delete legacy evals/ directories from all skill directories.
/// Called once on startup after migration 58 rebuilds the scenarios table.
pub fn cleanup_legacy_eval_dirs(skills_root: &Path) {
    if !skills_root.is_dir() {
        return;
    }

    // Walk plugin directories
    if let Ok(plugin_entries) = std::fs::read_dir(skills_root) {
        for plugin_entry in plugin_entries.flatten() {
            let plugin_path = plugin_entry.path();
            if !plugin_path.is_dir() {
                continue;
            }

            // Walk skill directories within each plugin
            let skills_dir = plugin_path.join("skills");
            if !skills_dir.is_dir() {
                continue;
            }

            if let Ok(skill_entries) = std::fs::read_dir(&skills_dir) {
                for skill_entry in skill_entries.flatten() {
                    let skill_path = skill_entry.path();
                    if !skill_path.is_dir() {
                        continue;
                    }

                    let evals_dir = skill_path.join("evals");
                    if evals_dir.is_dir() {
                        match std::fs::remove_dir_all(&evals_dir) {
                            Ok(()) => log::info!(
                                "[cleanup] removed legacy evals/ dir: {}",
                                evals_dir.display()
                            ),
                            Err(e) => log::warn!(
                                "[cleanup] failed to remove legacy evals/ dir {}: {}",
                                evals_dir.display(),
                                e
                            ),
                        }
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 2: Call cleanup on startup**

```rust
// app/src-tauri/src/lib.rs — in the setup function, after init_db:
    // Clean up legacy eval directories after DB migration
    if let Ok(skills_root) = crate::db::get_skills_root(&db.0.lock().map_err(|e| e.to_string())?) {
        crate::cleanup::cleanup_legacy_eval_dirs(std::path::Path::new(&skills_root));
    }
```

- [ ] **Step 3: Add test for cleanup function**

```rust
// app/src-tauri/src/cleanup.rs — tests
#[test]
fn cleanup_legacy_eval_dirs_removes_evals_folders() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_root = tmp.path();

    // Create plugin/skill/evals structure
    let skill_dir = skills_root.join("default/skills/my-skill");
    std::fs::create_dir_all(skill_dir.join("evals/cases")).unwrap();
    std::fs::write(skill_dir.join("evals/cases/test.yaml"), "test").unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill").unwrap();

    cleanup_legacy_eval_dirs(skills_root);

    assert!(!skill_dir.join("evals").exists());
    assert!(skill_dir.join("SKILL.md").exists());
}
```

- [ ] **Step 4: Run tests and commit**

```bash
cd app/src-tauri && cargo test cleanup:: -- --nocapture
cd app/src-tauri && cargo clippy -- -D warnings
```

```bash
git add app/src-tauri/src/cleanup.rs app/src-tauri/src/lib.rs
git commit -m "feat: add startup cleanup for legacy evals/ directories"
```

---

### Task 11: Frontend — remove generate button, update eval workbench to use skill_id

**Files:**
- Modify: Frontend eval workbench page (find the component that renders the generate button)
- Modify: Frontend API calls for eval workbench

- [ ] **Step 1: Find and remove the "Generate scenarios" button**

Search for the button in the eval workbench page and remove it along with its handler.

- [ ] **Step 2: Update API calls to use skill_id instead of plugin_slug + skill_name**

Update all frontend calls to `list_scenarios`, `load_scenario`, `save_scenario`, `delete_scenario` to pass `skill_id` instead of `plugin_slug` and `skill_name`.

- [ ] **Step 3: Run frontend typecheck**

```bash
cd app && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/src/
git commit -m "feat: remove generate button, update eval workbench to use skill_id"
```

---

### Task 12: Update repo-map.json and run full verification

**Files:**
- Modify: `repo-map.json`

- [ ] **Step 1: Update repo-map.json**

Add new files:
- `app/src-tauri/src/agents/hooks/mod.rs`
- `app/src-tauri/src/agents/eval_generator.rs`
- `app/src-tauri/src/agents/eval_watcher.rs`
- `agent-sources/workspace/hooks/post-tool-use-verify.sh`
- `agent-sources/workspace/hooks/stop-hook.sh`
- `agent-sources/prompts/eval-generation.txt`

- [ ] **Step 2: Run full test suite**

```bash
cd app && npm run test:unit
cd app/src-tauri && cargo test
cd app/src-tauri && cargo clippy -- -D warnings
```

- [ ] **Step 3: Commit**

```bash
git add repo-map.json
git commit -m "chore: update repo-map.json for eval generation hook files"
```

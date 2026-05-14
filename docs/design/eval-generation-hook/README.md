# Design: Post-Verify Eval Generation via OpenHands Hooks

## Summary

Automatically generate eval scenarios after a skill is written and verified, using OpenHands Agent Server hooks. The eval generation runs as a tracked throwaway session, materializes scenarios + assertions into the SQLite DB, and the eval workbench UI displays them for editing and execution.

## Architecture Overview

```
Skill-creator agent writes SKILL.md
  → skill-verifier subagent reviews (existing pattern)
    → PostToolUse hook detects verifier completion
      → writes .vibedata/.eval-generation-request
        → Rust notify watcher picks up marker
          → launches tracked throwaway eval session
            → eval agent writes scenarios to DB
              → Rust writes .vibedata/.eval-generation-complete
                → Stop hook unblocks, agent finishes
```

## Hook Scripts

### File Location

Hook scripts live in `agent-sources/workspace/hooks/` and are deployed to `{skill_dir}/.openhands/hooks/` alongside agents and skills during the existing `ensure_workspace_prompts()` flow.

### `post-tool-use-verify.sh`

Fires after every tool use. Detects when the skill-verifier subagent has completed with a pass result, then writes a request marker file.

- Matches tool name `task` / `task_tool_set`
- Checks prompt content for "skill-verifier"
- Checks tool output for `status: "pass"`
- Writes timestamp to `SKILL_DIR/.vibedata/.eval-generation-request`
- Exits 0 (non-blocking)

### `stop-hook.sh`

Blocks the agent from finishing while eval generation is in progress.

- If `.vibedata/.eval-generation-complete` exists → exit 0
- If no request file → exit 0
- If request is < 5 minutes old → exit 2 with `additionalContext` message
- If past TTL → exit 0 (allow through even if incomplete)

### `.vibedata/` Directory

All internal tracker files live under `SKILL_DIR/.vibedata/`. This directory is gitignored.

## Rust Backend

### HookConfig in StartConversationRequest

`agents/openhands_server/types.rs` gains a `hook_config` field serialized into the `POST /conversations` payload. The `HookConfig` struct maps to the SDK model:

```rust
struct HookConfig {
    post_tool_use: Vec<HookMatcher>,
    stop: Vec<HookMatcher>,
}

struct HookMatcher {
    matcher: Option<String>,
    hooks: Vec<HookDefinition>,
}

struct HookDefinition {
    command: String,
    timeout: Option<u32>,
}
```

### Hook Deployment

Extend `commands/workflow/deploy.rs` to copy hook scripts from `agent-sources/workspace/hooks/` to `{skill_dir}/.openhands/hooks/` during the existing deployment flow.

The `HookDefinition.command` field wraps each script with environment variable injection:

```
SKILL_DIR=/path/to/skill bash /path/to/.openhands/hooks/post-tool-use-verify.sh
```

This ensures `$SKILL_DIR` is available to all hook scripts regardless of the agent's working directory.

### Notify Watcher

The watcher is installed per-conversation when the skill-creator session starts. It watches `SKILL_DIR/.vibedata/` for `.eval-generation-request` file creation using the existing `notify` crate (already a dependency).

On detection:

1. Launches a tracked throwaway eval-generation session (via `run_tracked_throwaway_openhands_session()`)
2. Uses eval-specific agent config (new `agents/eval_generator.rs`)
3. On session completion, parses the agent's JSON output
4. Calls `materialize_eval_scenarios()` to persist to DB
5. Writes `.vibedata/.eval-generation-complete`

The watcher is torn down when the skill-creator conversation ends or the eval session completes.

### Eval Agent Config

`agents/eval_generator.rs` — builds an `OpenHandsRuntimeConfig`:

- Agent name: `eval-generator`
- Tools: `file_editor`, `terminal`
- Max turns: 50
- Workspace: `SKILL_DIR`
- System prompt from `agent-sources/prompts/eval-generation.txt`
- Output format: JSON schema for structured completion

### Eval Agent Prompt

`agent-sources/prompts/eval-generation.txt` instructs the agent to:

1. Analyze the provided `SKILL.md` content and workflow decisions/clarifications (injected into the user message by the Rust backend)
2. Identify key user flows, edge cases, and failure modes
3. Generate 5-8 scenarios covering: happy path, edge cases, error handling, performance
4. Return structured JSON with `mode` set to `"performance"` for all scenarios

Agent output format:

```json
{
  "scenarios": [
    {
      "name": "Scenario Name",
      "description": "One-sentence description",
      "prompt": "...",
      "assertions": ["assertion 1", "assertion 2"]
    }
  ]
}
```

## DB Schema

### Migration

Drop and recreate `scenarios` and `assertions` tables (dev-only, no data migration):

```sql
DROP TABLE IF EXISTS assertions;
DROP TABLE IF EXISTS scenarios;

CREATE TABLE scenarios (
    id TEXT PRIMARY KEY,
    plugin_slug TEXT NOT NULL,
    skill_id TEXT NOT NULL,
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

CREATE INDEX idx_scenarios_skill ON scenarios(skill_id, sort_order);
CREATE INDEX idx_scenarios_plugin ON scenarios(plugin_slug, sort_order);
CREATE INDEX idx_assertions_scenario ON assertions(scenario_id, sort_order);
```

Key changes from old schema:
- `skill_name` removed from `scenarios`
- `skill_id` added as FK to `skills(id)` with `ON DELETE CASCADE`
- `description` column added
- `assertions` table unchanged (already references `scenarios(id)`)

### Startup Cleanup

On app startup, a migration deletes `evals/` directories from all skill directories under the skills root. Old YAML-based eval data is not migrated to DB.

## Tauri Commands

### New

- `materialize_eval_scenarios(plugin_slug, skill_id, scenarios_json)` — bulk-inserts scenarios + assertions from agent JSON output

### Updated

- `list_scenarios(skill_id)` — query by `skill_id` instead of `eval_dir`
- `load_scenario(scenario_id)` — direct lookup
- `save_scenario(scenario_id, updates)` — update
- `delete_scenario(scenario_id)` — delete (cascades to assertions)

### Removed

- `define_eval_scenario` — generation is now automated via hooks

## Eval UI Changes

- Remove "Generate scenarios" button
- Scenario list, edit, delete, and run functionality backed by DB queries
- No generation trigger — scenarios are auto-populated by the hook pipeline
- User flow: skill created → verifier passes → hook triggers → evals generated → user opens eval workbench → sees pre-generated scenarios → edits/runs

## File Map

| File | Change |
|---|---|
| `agent-sources/workspace/hooks/post-tool-use-verify.sh` | New |
| `agent-sources/workspace/hooks/stop-hook.sh` | New |
| `agent-sources/prompts/eval-generation.txt` | New |
| `app/src-tauri/src/agents/openhands_server/types.rs` | Add `hook_config` field |
| `app/src-tauri/src/agents/hooks/mod.rs` | New — HookConfig types |
| `app/src-tauri/src/agents/eval_generator.rs` | New — eval agent config builder |
| `app/src-tauri/src/commands/workflow/deploy.rs` | Extend to deploy hooks |
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | Add `materialize_eval_scenarios`, update existing commands, remove `define_eval_scenario` |
| `app/src-tauri/src/db/migrations.rs` | New migration for scenarios/assertions schema |
| `app/src-tauri/src/lib.rs` | Add startup cleanup call |
| `app/src-tauri/src/cleanup.rs` | New — startup eval folder cleanup |

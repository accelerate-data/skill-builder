# Tauri Command Reference

All commands are exposed via `#[tauri::command]` and return `Result<T, String>`. Async commands use Tokio.

## Settings

| Command | Description |
|---|---|
| `get_settings` | Read `AppSettings` from DB |
| `save_settings` | Write `AppSettings`; handles `skills_path` init/move |
| `test_api_key` | Validate an Anthropic API key with a live call |
| `set_log_level` | Change runtime log level without restarting |
| `get_log_file_path` | Path to the Tauri app log file |
| `get_default_skills_path` | Platform default for `skills_path` |
| `get_data_dir` | Tauri `app_data_dir` |

## Skill Management

| Command | Description |
|---|---|
| `list_skills` | All Skills Library entries with tags and workflow metadata |
| `list_refinable_skills` | Completed skills with SKILL.md on disk (eligible for refine) |
| `create_skill` | Create workspace directories and DB entries |
| `delete_skill` | Remove skill from all tables and disk |
| `rename_skill` | Rename skill on disk and in all DB tables |
| `update_skill_tags` | Upsert tags for a skill |
| `update_skill_metadata` | Update description, version, model, argument hint, flags |
| `get_all_tags` | Sorted list of all tags across all skills |
| `get_installed_skill_names` | Skill names from the `skills` master |
| `generate_suggestions` | AI-generated skill name and domain suggestions |
| `acquire_lock` | Lock a skill to this instance |
| `release_lock` | Release a skill lock |
| `check_lock` | Check whether a skill is locked and by whom |
| `get_locked_skills` | All currently held locks |

## Workflow Execution

| Command | Description |
|---|---|
| `run_workflow_step` | Execute a workflow step (spawns agent) |
| `get_workflow_state` | Current step and all step statuses |
| `save_workflow_state` | Persist workflow run and step data |
| `verify_step_output` | Check that expected output files exist |
| `reset_workflow_step` | Reset a step and all subsequent steps to pending |
| `preview_step_reset` | List files that would be deleted by a step reset |
| `run_answer_evaluator` | LLM gate decision validation |
| `autofill_clarifications` | Pre-populate clarification fields |
| `autofill_refinements` | Pre-populate refinement suggestions |
| `log_gate_decision` | Record a gate decision in logs |
| `get_disabled_steps` | Steps disabled for the current skill type |

## Agent Lifecycle

| Command | Description |
|---|---|
| `start_agent` | Spawn a sidecar agent process |
| `has_running_agents` | Whether any agents are currently active |
| `cleanup_skill_sidecar` | Terminate the sidecar for a specific skill |
| `graceful_shutdown` | Stop all sidecars with a timeout before app exit |

## File I/O

| Command | Description |
|---|---|
| `list_skill_files` | Recursive directory listing for a skill |
| `read_file` | Read a file as text (5 MB cap) |
| `write_file` | Write a text file (validated to skills dir) |
| `copy_file` | Copy a file within or between skills |
| `read_file_as_base64` | Read a binary file base64-encoded |
| `write_base64_to_temp_file` | Decode base64 to a temp file |
| `save_raw_file` | Save a raw file during clarification |

## Settings→Skills (workspace_skills)

| Command | Description |
|---|---|
| `upload_skill` | Extract ZIP and register in `workspace_skills` |
| `list_imported_skills` | All `workspace_skills` entries hydrated with SKILL.md |
| `toggle_skill_active` | Set active/inactive flag; auto-deactivates other active skills sharing the same purpose |
| `delete_imported_skill` | Remove from `workspace_skills` |
| `get_skill_content` | Read SKILL.md content |
| `export_skill` | Package a skill as a ZIP for download |
| `set_workspace_skill_purpose` | Set or clear the `purpose` tag on a workspace skill |

## GitHub Integration

| Command | Description |
|---|---|
| `parse_github_url` | Parse a GitHub URL into owner/repo/branch/subpath |
| `check_marketplace_url` | Verify a marketplace repo is valid |
| `list_github_skills` | List available skills from `.claude-plugin/marketplace.json` in a GitHub repo |
| `import_github_skills` | Download selected skills into `workspace_skills` |
| `import_marketplace_to_library` | Bulk import all marketplace skills into Skills Library |
| `github_start_device_flow` | Start GitHub OAuth device flow |
| `github_poll_for_token` | Poll for OAuth token completion |
| `github_get_user` | Fetch authenticated GitHub user info |
| `github_logout` | Clear GitHub auth tokens |

## Usage Analytics

| Command | Description |
|---|---|
| `persist_agent_run` | Store agent run metrics |
| `get_usage_summary` | Aggregate cost and run counts |
| `get_recent_runs` | Last N agent runs |
| `get_recent_workflow_sessions` | Last N sessions with cost summaries |
| `get_session_agent_runs` | All agent runs for a session |
| `get_step_agent_runs` | Completed agent runs for a (skill, step) pair |
| `get_usage_by_step` | Cost aggregated by workflow step |
| `get_usage_by_model` | Cost aggregated by model |
| `reset_usage` | Soft-delete all runs/sessions via `reset_marker` |

## Workspace & Reconciliation

| Command | Description |
|---|---|
| `get_workspace_path` | Current `workspace_path` from settings |
| `clear_workspace` | Delete the entire workspace directory |
| `reconcile_startup` | Compare disk state to DB; return orphans and discoveries |
| `resolve_orphan` | Register a discovered orphan into the Skills Library |
| `resolve_discovery` | Register a discovered skill into the Skills Library |
| `create_workflow_session` | Start a refine or workflow session |
| `end_workflow_session` | Close a session |

## Refine

| Command | Description |
|---|---|
| `get_skill_content_for_refine` | Load skill files into the refine editor |
| `get_refine_diff` | Unified diff between original and modified content |
| `start_refine_session` | Spawn an agent with skill content as context |
| `send_refine_message` | Continue a refine conversation |
| `close_refine_session` | End session, optionally persist changes |

## Git History

| Command | Description |
|---|---|
| `get_skill_history` | Commit log for a skill |
| `get_skill_diff` | Diff between two commits |
| `restore_skill_version` | Restore skill to a previous commit |

## Node & Dependencies

| Command | Description |
|---|---|
| `check_node` | Verify Node.js availability (bundled or system) |
| `check_startup_deps` | Check all startup dependencies |

## Feedback & Testing

| Command | Description |
|---|---|
| `create_github_issue` | Create an issue in the feedback repo |
| `prepare_skill_test` | Set up a skill test environment |
| `cleanup_skill_test` | Tear down a skill test environment |

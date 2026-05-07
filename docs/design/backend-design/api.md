# Tauri Command Reference

All commands are exposed via `#[tauri::command]` and return `Result<T, String>`. Async commands use Tokio.

## Settings

| Command | Description |
|---|---|
| `get_settings` | Read `AppSettings` from DB |
| `save_settings` | Write `AppSettings`; handles `skills_path` init/move |
| `test_model_connection` | Validate model connectivity with a live call |
| `set_log_level` | Change runtime log level without restarting |
| `get_log_file_path` | Path to the Tauri app log file |
| `get_default_skills_path` | Platform default for `skills_path` |
| `get_data_dir` | Tauri `app_data_dir` |
| `update_user_settings` | Update user-specific preferences |
| `update_github_identity` | Update stored GitHub user identity |
| `log_frontend` | Bridge frontend `console.*` calls into Rust logging |
| `allow_app_exit` | Signal that the app can safely exit (closes close-guard) |

## Skill Management

| Command | Description |
|---|---|
| `list_skills` | All Skills Library entries with tags and workflow metadata |
| `get_dashboard_skill_names` | Skill names for the dashboard view |
| `get_workflow_skill_names` | Skill names for the workflow context |
| `create_skill` | Create workspace directories and DB entries |
| `delete_skill` | Remove skill from all tables and disk |
| `rename_skill` | Rename skill on disk and in all DB tables |
| `update_skill_tags` | Upsert tags for a skill |
| `update_skill_metadata` | Update description, version, model, argument hint, flags |
| `get_all_tags` | Sorted list of all tags across all skills |
| `generate_suggestions` | AI-generated skill name and purpose suggestions |
| `acquire_lock` | Lock a skill to this instance |
| `release_lock` | Release a skill lock |
| `get_externally_locked_skills` | Locks held by other app instances |
| `check_skill_customized` | Check whether a skill has local customizations |
| `review_skill_scope` | Run a scope review agent against a skill |
| `navigate_back_to_step` | Return the workflow to a previous step |

## Workflow Execution

| Command | Description |
|---|---|
| `run_workflow_step` | Execute a workflow step (dispatches to OpenHands Agent Server) |
| `get_workflow_state` | Current step and all step statuses |
| `save_workflow_state` | Persist workflow run and step data |
| `verify_step_output` | Check that expected output files exist |
| `get_step_output_files` | List artifact files produced by a step |
| `reset_workflow_step` | Reset a step and all subsequent steps to pending |
| `preview_step_reset` | List files that would be deleted by a step reset |
| `cancel_workflow_step` | Cancel an in-progress workflow step |
| `run_answer_evaluator` | LLM gate decision validation |
| `log_gate_decision` | Record a gate decision in logs |
| `get_disabled_steps` | Steps disabled for the current skill type |
| `materialize_answer_evaluation_output` | Generate gate decision output artifact |
| `materialize_workflow_step_output` | Materialize full workflow step artifacts to disk |

## Workflow Artifacts

| Command | Description |
|---|---|
| `get_clarifications` | Retrieve clarification data for a skill |
| `update_clarification_answer` | Update an answer on a clarification question |
| `update_clarification_verdicts` | Update per-question evaluation verdicts |
| `get_decisions` | Retrieve decision data for a skill |
| `save_decisions_edit` | Persist edits to decision items |

## Agent Lifecycle

| Command | Description |
|---|---|
| `cancel_agent_run` | Cancel a running agent |
| `cancel_session` | Cancel an OpenHands session |
| `graceful_shutdown` | Stop all agent processes with a timeout before app exit |

## File I/O

| Command | Description |
|---|---|
| `list_skill_files` | Recursive directory listing for a skill |
| `read_file` | Read a file as text (5 MB cap) |
| `write_file` | Write a text file (validated to skills dir) |

## Imported Skills

| Command | Description |
|---|---|
| `import_skill_from_file` | Import a skill from a local file and register in the Skills Library |
| `parse_skill_file` | Parse SKILL.md frontmatter from a file path |
| `list_imported_skills` | All imported skill entries with plugin and metadata |
| `delete_imported_skill` | Remove an imported skill from the library |
| `export_skill_as_file` | Package a skill as a file for download |
| `get_skill_content_at_path` | Read SKILL.md content by path |

## GitHub Integration

| Command | Description |
|---|---|
| `parse_github_url` | Parse a GitHub URL into owner/repo/branch/subpath |
| `check_marketplace_url` | Verify a marketplace repo is valid |
| `list_github_skills` | List available skills from `.claude-plugin/marketplace.json` in a GitHub repo |
| `list_github_plugins` | Available plugins from marketplace registries |
| `import_marketplace_to_library` | Bulk import all marketplace skills into Skills Library |
| `import_marketplace_plugin_to_library` | Import an entire marketplace plugin into the Skills Library |
| `check_marketplace_updates` | Check for available updates to installed marketplace plugins |
| `github_start_device_flow` | Start GitHub OAuth device flow |
| `github_poll_for_token` | Poll for OAuth token completion |
| `github_get_user` | Fetch authenticated GitHub user info |
| `github_logout` | Clear GitHub auth tokens |

## Usage Analytics

| Command | Description |
|---|---|
| `get_usage_summary` | Aggregate cost and run counts |
| `get_agent_runs` | Agent run records with filtering |
| `get_recent_workflow_sessions` | Last N sessions with cost summaries |
| `get_step_agent_runs` | Completed agent runs for a (skill, step) pair |
| `get_usage_by_step` | Cost aggregated by workflow step |
| `get_usage_by_model` | Cost aggregated by model |
| `get_usage_by_day` | Cost aggregated by day |
| `reset_usage` | Soft-delete all runs/sessions via `reset_marker` |

## Workspace & Reconciliation

| Command | Description |
|---|---|
| `get_workspace_path` | Current `workspace_path` from settings |
| `init_workspace` | Initialize the workspace directory structure |
| `clear_workspace` | Delete the entire workspace directory |
| `invalidate_workspace_cache` | Force workspace state refresh |
| `ensure_workspace_prompts` | Ensure workspace prompt files are up to date |
| `ensure_openhands_runtime_dir` | Ensure the OpenHands runtime directory exists |
| `reconcile_startup` | Compare disk state to DB; return orphans and discoveries |
| `record_reconciliation_cancel` | Record that the user cancelled a reconciliation prompt |
| `resolve_orphan` | Register a discovered orphan into the Skills Library |
| `resolve_discovery` | Register a discovered skill into the Skills Library |
| `create_workflow_session` | Start a refine or workflow session |
| `end_workflow_session` | Close a session |

## Refine

| Command | Description |
|---|---|
| `get_skill_content_for_refine` | Load skill files into the refine editor |
| `start_refine_session` | Spawn an OpenHands session with skill content as context |
| `send_refine_message` | Continue a refine conversation |
| `pause_refine_session` | Suspend the session without closing it |
| `close_refine_session` | End session, optionally persist changes |
| `finalize_refine_run` | Write final summary and close run metrics |

## Git History

| Command | Description |
|---|---|
| `get_skill_history` | Commit log for a skill |
| `get_skill_files_at_sha` | Get skill file contents at a specific git commit |
| `restore_skill_version` | Restore skill to a previous commit |

## Node & Dependencies

| Command | Description |
|---|---|
| `check_node` | Verify Node.js availability (bundled or system) |
| `check_startup_deps` | Check all startup dependencies, including OpenHands Agent Server |

## Documents

| Command | Description |
|---|---|
| `add_document_file` | Attach a file as a document |
| `add_document_url` | Attach a URL as a document |
| `add_document_folder` | Attach a folder as a document |
| `update_document` | Update document metadata |
| `delete_document` | Remove a document attachment |
| `list_documents` | All document attachments with scope info |
| `list_skills_for_documents` | Skills eligible for skill-scoped document attachment |

## Plugins

| Command | Description |
|---|---|
| `list_plugins` | All registered plugins with metadata |
| `create_plugin_from_skills` | Create a plugin grouping from selected skills |
| `delete_plugin` | Remove a plugin and its skills |
| `move_skill_to_plugin` | Reassign a skill to a different plugin |
| `remove_skill_from_plugin` | Remove a skill from its plugin |
| `set_plugin_upgrade_lock` | Lock/unlock a plugin from marketplace upgrades |

## Eval Workbench

| Command | Description |
|---|---|
| `list_scenarios` | List scenario summaries for a plugin skill from disk |
| `load_scenario` | Read one full scenario from disk |
| `define_eval_scenario` | Rewrite an existing scenario from skill context and saved workflow artifacts |
| `run_eval_workbench` | Run the Promptfoo-backed Eval Workbench for a selected scenario and mode |
| `list_eval_runs` | List Promptfoo-backed Eval Workbench runs for a skill and mode |
| `read_eval_run` | Read one Eval Workbench run with results and persisted run metadata |
| `build_refine_improvement_brief` | Build a Refine-ready improvement brief from a saved workbench run |

## Feedback

| Command | Description |
|---|---|
| `create_github_issue` | Create an issue in the feedback repo |

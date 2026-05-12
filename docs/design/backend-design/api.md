# Tauri Command Surface

Target backend command surface for the Skill Builder desktop app.

All commands are exposed through Tauri IPC. The backend groups them by product
domain rather than by module layout.

## Settings And Lifecycle

| Command | Target responsibility |
|---|---|
| `get_settings` | Read app settings |
| `save_settings` | Persist app settings and trigger any required backend side effects |
| `update_user_settings` | Persist user-only preferences |
| `update_github_identity` | Persist authenticated GitHub identity |
| `get_default_skills_path` | Return the platform-default skills root |
| `get_data_dir` | Return the app data directory |
| `set_log_level` | Change backend log verbosity at runtime |
| `get_log_file_path` | Return the app log path |
| `log_frontend` | Bridge frontend logging into Rust logging |
| `allow_app_exit` | Release the close guard after the frontend confirms exit |
| `graceful_shutdown` | Release leases/session state and stop managed runtimes |

## Skills Library

| Command | Target responsibility |
|---|---|
| `list_skills` | Return the unified Skills Library view |
| `create_skill` | Create a new skill and its initial backend records |
| `delete_skill` | Remove a skill and all owned backend state |
| `rename_skill` | Rename a skill when that behavior is enabled by product policy |
| `update_skill_metadata` | Update skill metadata and behavior flags |
| `get_all_tags` | Return the global tag list |
| `get_dashboard_skill_names` | Return dashboard skill names |
| `get_workflow_skill_names` | Return workflow-eligible skill names |
| `check_skill_customized` | Detect local changes against the imported source |

## Skill Leasing And Persistent Sessions

| Command | Target responsibility |
|---|---|
| `acquire_lock` | Acquire a backend lease for a skill |
| `release_lock` | Release a backend lease for a skill |
| `get_externally_locked_skills` | Return skills leased by another instance |
| `select_skill_openhands_session` | Resolve the canonical skill, verify the lease, and restore or create the selected-skill conversation |
| `pause_openhands_session` | Pause the active selected-skill run without destroying the persistent conversation |
| `send_refine_message` | Dispatch the next turn on the selected-skill conversation |
| `get_skill_content_for_refine` | Load the current skill contents for refine |
| `get_skill_content_at_path` | Read skill contents directly from a path |
| `finalize_refine_run` | Persist the final refine outcome |
| `clean_benchmark_snapshot` | Clean transient refine benchmark artifacts |

## Workflow Execution

| Command | Target responsibility |
|---|---|
| `run_workflow_step` | Dispatch a workflow step through OpenHands |
| `run_answer_evaluator` | Dispatch the answer-evaluator gate |
| `get_workflow_state` | Read workflow run and step state by canonical skill identity |
| `save_workflow_state` | Persist workflow run and step state |
| `verify_step_output` | Verify that required step output exists |
| `preview_step_reset` | Show the reset blast radius |
| `reset_workflow_step` | Reset a step and clean owned artifacts |
| `navigate_back_to_step` | Return workflow state to an earlier step |
| `get_disabled_steps` | Return workflow steps blocked by current artifact state |
| `materialize_workflow_step_output` | Persist step outputs to app-owned artifacts |
| `materialize_answer_evaluation_output` | Persist gate outputs to app-owned artifacts |
| `log_gate_decision` | Emit structured gate-decision logs |
| `read_latest_benchmark` | Read the latest benchmark result |

## Workflow Artifact Editing

| Command | Target responsibility |
|---|---|
| `get_clarifications` | Read normalized clarifications by canonical skill identity |
| `update_clarification_answer` | Persist a question answer edit |
| `update_clarification_verdicts` | Persist evaluator verdicts |
| `get_decisions` | Read normalized decisions by canonical skill identity |
| `save_decisions_edit` | Persist editable decision changes |

## Marketplace And Import

| Command | Target responsibility |
|---|---|
| `parse_skill_file` | Parse frontmatter from a local skill file |
| `import_skill_from_file` | Import a local skill into the library |
| `list_imported_skills` | List imported and marketplace skill records |
| `delete_imported_skill` | Remove an imported skill entry |
| `export_skill_as_file` | Export a skill as a distributable file |
| `list_plugins` | List library plugins |
| `create_plugin_from_skills` | Create a plugin grouping from selected skills |
| `delete_plugin` | Delete a plugin |
| `move_skill_to_plugin` | Reassign a skill to another plugin |
| `remove_skill_from_plugin` | Remove a skill from a plugin |
| `set_plugin_upgrade_lock` | Lock or unlock plugin upgrades |
| `parse_github_url` | Parse a GitHub URL into import coordinates |
| `check_marketplace_url` | Validate a marketplace source |
| `list_github_plugins` | List plugins from a marketplace source |
| `list_github_skills` | List skills from a marketplace source |
| `import_marketplace_to_library` | Bulk-import marketplace content |
| `import_marketplace_plugin_to_library` | Import a single marketplace plugin |
| `check_marketplace_updates` | Check for marketplace updates |

## Documents

| Command | Target responsibility |
|---|---|
| `list_documents` | List document attachments |
| `list_skills_for_documents` | Return skill choices for scoped attachments |
| `add_document_file` | Attach a file-backed document |
| `add_document_url` | Attach a URL-backed document |
| `add_document_folder` | Attach a folder-backed document |
| `update_document` | Update document metadata |
| `delete_document` | Delete a document attachment |

## GitHub Authentication And Feedback

| Command | Target responsibility |
|---|---|
| `github_start_device_flow` | Start GitHub device auth |
| `github_poll_for_token` | Poll for GitHub auth completion |
| `github_get_user` | Return the authenticated GitHub user |
| `github_logout` | Clear GitHub auth state |
| `create_github_issue` | Create a feedback issue |

## Usage And History

| Command | Target responsibility |
|---|---|
| `get_usage_summary` | Return aggregated usage summaries |
| `get_usage_by_step` | Return usage grouped by workflow step |
| `get_usage_by_model` | Return usage grouped by model |
| `get_usage_by_day` | Return usage grouped by day |
| `get_recent_workflow_sessions` | Return recent workflow/refine sessions |
| `get_step_agent_runs` | Return runs for one workflow step |
| `get_agent_runs` | Return detailed run rows |
| `reset_usage` | Reset usage-visible telemetry state |
| `get_skill_history` | Return git history for a skill |
| `get_skill_files_at_sha` | Return files for a historical revision |
| `restore_skill_version` | Restore a historical revision |

## Workspace And Reconciliation

| Command | Target responsibility |
|---|---|
| `get_workspace_path` | Return the configured workspace path |
| `clear_workspace` | Clear app-owned workspace state |
| `reconcile_startup` | Compare disk and DB state on startup |
| `record_reconciliation_cancel` | Record a cancelled reconciliation action |
| `resolve_orphan` | Resolve an orphaned skill |
| `resolve_discovery` | Resolve a discovered skill |
| `create_workflow_session` | Create a workflow/refine session record |
| `end_workflow_session` | End a workflow/refine session record |

## LiteLLM Provider And Profile Management

| Command | Target responsibility |
|---|---|
| `list_litellm_providers` | List configured providers |
| `create_litellm_provider` | Create a provider record |
| `update_litellm_provider` | Update a provider record |
| `delete_litellm_provider` | Delete a provider record |
| `list_litellm_profiles` | List model-routing profiles |
| `get_litellm_profile_models` | List ordered models for a profile |
| `create_litellm_profile` | Create a profile |
| `update_litellm_profile` | Update a profile |
| `delete_litellm_profile` | Delete a profile |
| `add_profile_model` | Add a model/provider entry to a profile |
| `remove_profile_model` | Remove a model from a profile |
| `reorder_profile_models` | Reorder profile fallback priority |
| `verify_profile_virtual_key` | Verify that the profile virtual key exists in the proxy |

## Eval Scenarios

| Command | Target responsibility |
|---|---|
| `list_scenarios` | List saved eval scenarios |
| `load_scenario` | Load one saved eval scenario |
| `create_scenario` | Create a new scenario draft |
| `save_scenario` | Persist a scenario and its assertions |
| `delete_scenario` | Delete a saved scenario |
| `define_eval_scenario` | Generate a scenario from skill context and workflow artifacts |

## Notes

- This page documents the target backend command families, not every internal
  helper function.
- Any commands or behaviors that still differ on latest `main` belong in
  [implementation-gaps.md](implementation-gaps.md).

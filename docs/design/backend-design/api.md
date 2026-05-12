# Backend API Design

Target Tauri command families exposed by the Rust backend.

## Skill Library

| Command | Target responsibility |
|---|---|
| `list_skills` | Return the canonical skill library view |
| `create_skill` | Create a new skill record and on-disk scaffold |
| `update_skill_metadata` | Update app-owned skill metadata |
| `delete_skill` | Delete a skill and its owned records |
| `import_skill_from_file` | Import skill content into the library |

## Workflow And Refine Runtime

| Command | Target responsibility |
|---|---|
| `select_skill_openhands_session` | Acquire the lease, restore/create the persistent conversation, and hydrate transcript state |
| `send_refine_message` | Dispatch one refine turn into an existing persistent conversation |
| `pause_openhands_session` | Pause active execution and release the backend lease |
| `run_workflow_step` | Execute a throwaway workflow/eval turn |

## Settings And Runtime Resolution

| Command | Target responsibility |
|---|---|
| `load_settings` | Return persisted app settings |
| `save_settings` | Persist selected provider/model plus runtime overrides |
| `test_provider_connection` | Validate credentials/base URL against the chosen provider |

## Model Catalog

| Command | Target responsibility |
|---|---|
| `refresh_model_catalog` | Fetch `models.dev`, rewrite the local cache, and return the refreshed model vector |
| `get_cached_model_catalog` | Return the last cached model vector without a network call |
| `filter_models` | Apply backend-owned field filters to a provided model vector |

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

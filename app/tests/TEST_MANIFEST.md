# Test Manifest — Cross-Layer Map

Maps sources to tests that tooling can't derive automatically. Frontend tests follow naming conventions (`<source>.test.ts(x)`) and are detected by `npm run test:changed` via `vitest --changed`.

## Shared Infrastructure (change triggers full suite)

Changes to these files affect all test layers — run the full test suite (`./tests/run.sh`):

- `src/lib/tauri.ts` — Tauri command type definitions used everywhere
- `src/test/mocks/tauri.ts` — Unit/integration mock infrastructure
- `src/test/mocks/tauri-e2e.ts` — E2E mock infrastructure
- `src/test/mocks/tauri-e2e-event.ts` — E2E event system mock
- `e2e/helpers/app-helpers.ts` — Shared E2E helpers (splash screen wait, etc.)
- `e2e/helpers/workflow-helpers.ts` — Shared workflow E2E helpers (navigation, mock overrides)
- `e2e/helpers/refine-helpers.ts` — Shared refine E2E helpers (navigation, mock overrides)
- `e2e/helpers/agent-simulator.ts` — Agent lifecycle event simulators
- `src/test/setup.ts` — Vitest global setup
- `vite.config.ts` / `vitest.config.ts` / `playwright.config.ts` — Build and test runner config

## Rust → E2E Tags

Rust modules have inline `#[cfg(test)]` tests run via `cargo test`. When a Rust command is UI-facing, also run the corresponding E2E tag.

| Rust Source | Cargo Test Filter | E2E Tag |
|---|---|---|
| `src-tauri/src/commands/workflow.rs` | `commands::workflow` | `@workflow` |
| `src-tauri/src/commands/workspace.rs` | `commands::workspace` | `@dashboard` |
| `src-tauri/src/commands/skill.rs` | `commands::skill` | `@dashboard` |
| `src-tauri/src/commands/files.rs` | `commands::files` | `@workflow` |
| `src-tauri/src/commands/settings.rs` | `commands::settings` | `@settings` |
| `src-tauri/src/commands/clarification.rs` | `commands::clarification` | `@workflow` |
| `src-tauri/src/commands/github_push.rs` | `commands::github_push` | `@dashboard` |
| `src-tauri/src/commands/github_auth.rs` | -- | `@settings` |
| `src-tauri/src/commands/imported_skills.rs` | `commands::imported_skills` | `@skills` |
| `src-tauri/src/commands/github_import.rs` | `commands::github_import` | `@skills` |
| `src-tauri/src/commands/team_import.rs` | `commands::team_import` | `@skills` |
| `src-tauri/src/commands/usage.rs` | `commands::usage` | `@usage` |
| `src-tauri/src/commands/agent.rs` | -- | `@workflow-agent` |
| `src-tauri/src/commands/sidecar_lifecycle.rs` | -- | `@workflow-agent` |
| `src-tauri/src/commands/refine.rs` | `commands::refine` | `@refine` |
| `src-tauri/src/commands/git.rs` | -- | `@dashboard` |
| `src-tauri/src/commands/lifecycle.rs` | -- | -- |
| `src-tauri/src/commands/feedback.rs` | -- | -- |
| `src-tauri/src/commands/node.rs` | `commands::node` | -- |
| `src-tauri/src/agents/sidecar.rs` | `agents::sidecar` | `@workflow-agent` |
| `src-tauri/src/agents/sidecar_pool.rs` | `agents::sidecar_pool` | `@workflow-agent` |
| `src-tauri/src/db.rs` | `db` | -- |
| `src-tauri/src/types.rs` | `types` | -- |
| `src-tauri/src/cleanup.rs` | `cleanup` | -- |
| `src-tauri/src/fs_validation.rs` | `fs_validation` | -- |
| `src-tauri/src/reconciliation.rs` | `reconciliation` | `@dashboard` |

## CLI Plugin

| Source Pattern | Plugin Tag | Plugin Tiers |
|---|---|---|
| `agents/*.md` | `@agents` | t1, t4 |
| `agent-sources/workspace/CLAUDE.md` | `@agents` | t1, t4 |
| `skills/generate-skill/SKILL.md` | `@coordinator` | t1, t2, t3 |
| `.claude-plugin/plugin.json` | `@structure` | t1 |

## E2E Spec Files

| Spec | Tag |
|---|---|
| `e2e/dashboard/dashboard.spec.ts` | `@dashboard` |
| `e2e/dashboard/dashboard-states.spec.ts` | `@dashboard` |
| `e2e/dashboard/skill-crud.spec.ts` | `@dashboard` |
| `e2e/dashboard/usage-multi-model.spec.ts` | `@dashboard` |
| `e2e/setup/setup-screen.spec.ts` | `@workflow` |
| `e2e/settings/settings.spec.ts` | `@settings` |
| `e2e/workflow/workflow-agent.spec.ts` | `@workflow-agent` |
| `e2e/navigation/navigation.spec.ts` | `@navigation` |
| `e2e/prompts/prompts.spec.ts` | `@prompts` |
| `e2e/skills/skills.spec.ts` | `@skills` |
| `e2e/usage/usage.spec.ts` | `@usage` |
| `e2e/workflow/workflow-steps.spec.ts` | `@workflow` |
| `e2e/workflow/workflow-navigation.spec.ts` | `@workflow` |
| `e2e/refine/refine.spec.ts` | `@refine` |

## Quick Reference

```bash
# Frontend: auto-detect affected tests
npm run test:changed                           # Tests affected by recent changes

# Rust: module-level tests + E2E cross-check
cargo test --manifest-path src-tauri/Cargo.toml commands::workflow
./tests/run.sh e2e --tag @workflow             # Cross-layer E2E

# Plugin
./scripts/test-plugin.sh --tag @agents         # Agent prompts changed
./scripts/test-plugin.sh --tag @coordinator    # Coordinator changed
./scripts/test-plugin.sh t1                    # Quick structural check (free)

# Full suite (shared infrastructure changes)
./tests/run.sh
```

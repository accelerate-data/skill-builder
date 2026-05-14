# Test Map

Use this file to choose validation commands. Frontend tests follow naming
conventions and can usually be selected with `cd app && npm run test:changed`.
Use the tables below for cases tooling cannot infer safely.

## Suite Inventory

| Suite | Command | Location | Cost |
|---|---|---|---|
| Frontend unit | `cd app && npm run test:unit` | `app/src/__tests__/stores/`, `app/src/__tests__/lib/`, `app/src/__tests__/hooks/` | Free |
| Frontend guards | `cd app && npm run test:guard` | `app/src/__tests__/guards/` | Free |
| Frontend integration | `cd app && npm run test:integration` | `app/src/__tests__/components/`, `app/src/__tests__/pages/` | Free |
| E2E | `cd app && npm run test:e2e` | `app/e2e/` | Free, mocked backend |
| Rust | `cargo test --manifest-path app/src-tauri/Cargo.toml` | `app/src-tauri/src/` | Free |
| Agent structural | `cd app && npm run test:agents:structural` | `app/agent-tests/` plus `agent-sources/` | Free |
| Repo map audit | `cd app && npm run test:repo-map` | `repo-map.json`, `scripts/ci/verify-repo-map.mjs` | Free |
| Eval harness contracts | `cd tests/evals && npm test` | `tests/evals/scripts/`, `tests/evals/assertions/` | Free |
| Live agent smoke | `cd app && npm run test:agents:smoke` | `tests/evals/` | Automated OpenCode eval; run when prompt, agent, or runtime behavior changes |
| Live eval smoke | `cd tests/evals && npm run eval:smoke` | `tests/evals/packages/` | Automated OpenCode eval; run when prompt, agent, or runtime behavior changes |
| OpenHands Agent Server live smoke | `cd app && OPENHANDS_AGENT_SERVER_LIVE_SMOKE=1 npm run test:openhands:live-smoke` | `scripts/smoke/openhands-agent-server-live-smoke.mjs` | Gated live Agent Server run; reads app DB model settings by default, env vars may override |
| OpenHands AgentSkill live smoke | `cd app && OPENHANDS_AGENT_SERVER_LIVE_SMOKE=1 npm run test:openhands:agentskill-smoke` | `scripts/smoke/openhands-agentskill-live-smoke.mjs` | Gated live skill-loading smoke; verifies AgentSkill is surfaced in SystemPromptEvent and invoke_skill is called |

## Directory Boundaries

| Path | Role | Rule |
|---|---|---|
| `app/tests/` | App-local test runner and harness self-tests | Keep orchestration scripts here. Run from `app/`. |
| `app/src/__tests__/` | Frontend Vitest tests | Mirror source areas by `stores`, `lib`, `hooks`, `components`, `pages`, and `guards`. |
| `app/e2e/` | Playwright E2E specs | Use mocked Tauri commands, not bare-metal system tests. |
| `tests/evals/` | Promptfoo/OpenCode eval harness | Keep separate from `app/tests/`; it has its own package and live-model risk. Promptfoo state is exported by the eval runtime, not worktree creation. |

## Change To Test Map

| Changed path | Required validation | Notes |
|---|---|---|
| `AGENTS.md`, `CLAUDE.md`, `.claude/rules/**` | `npx markdownlint-cli2 <changed-md-files>` and `bash app/scripts/lint-agent-docs.sh` | Instruction docs only. |
| `repo-map.json`, `scripts/ci/verify-repo-map.mjs`, `scripts/ci/verify-repo-map.test.mjs` | `cd app && npm run test:repo-map` | Verifies repo-map command/page/store inventory against the filesystem. |
| `app/src/**` | `cd app && npm run test:unit` | Prefer `npm run test:changed` for narrower local feedback when appropriate. |
| `app/src/__tests__/guards/**`, `app/src/lib/tauri-command-types.ts`, `app/src/lib/tauri-command-types.typecheck.ts` | `cd app && npm run test:guard` | Also run affected unit tests. |
| `agent-sources/plugins/**/agents/*.md` | `cd app && npm run test:agents:structural` | Structural validation only by default; live smoke requires explicit approval. |
| `agent-sources/workspace/**` | `cd app && npm run test:agents:structural`; run the affected OpenCode eval package or smoke subset | Structural plus live automated eval coverage for changed prompt behavior. |
| `app/src/__tests__/fixtures/openhands-events/**` | `cd app && npm run test:unit` | `canonical-format.test.ts` is the canary for OpenHands transcript fixture format drift. |
| `app/src-tauri/src/contracts/**` | `cd app && npm run codegen && cd src-tauri && cargo test contracts::` | Generated command-contract surface. |
| `app/src-tauri/src/**` | Use the Rust map below | Add the mapped E2E tag when the command is UI-facing. |
| `tests/evals/**` | `cd tests/evals && npm test`; run affected `npm run eval:<package>` scripts when behavior changes | Live eval scripts are automated OpenCode checks and may be run as normal validation. |
| Shared infrastructure listed below | `cd app && bash tests/run.sh` | Full suite; these files affect multiple layers. |

## Shared Infrastructure

Changes to these files affect all test layers.

| Path | Why it is broad |
|---|---|
| `app/src/lib/tauri.ts` | Tauri command wrapper used across frontend tests and runtime calls. |
| `app/src/lib/tauri-command-types.ts` | Typed command name, args, and result contract. |
| `app/src/lib/tauri-command-types.typecheck.ts` | Compile-time negative checks for typed commands. |
| `app/src/test/mocks/tauri.ts` | Unit and integration mock infrastructure. |
| `app/src/test/mocks/tauri-e2e.ts` | E2E Tauri mock infrastructure. |
| `app/src/test/mocks/tauri-e2e-event.ts` | E2E event mock infrastructure. |
| `app/src/test/mocks/tauri-e2e-dialog.ts` | E2E dialog mock infrastructure. |
| `app/src/test/mocks/tauri-e2e-window.ts` | E2E window mock infrastructure. |
| `app/e2e/helpers/app-helpers.ts` | Shared E2E app startup and splash helpers. |
| `app/e2e/helpers/workflow-helpers.ts` | Shared workflow E2E helpers. |
| `app/e2e/helpers/refine-helpers.ts` | Shared refine E2E helpers. |
| `app/e2e/helpers/agent-simulator.ts` | Agent lifecycle event simulator. |
| `app/e2e/helpers/settings-helpers.ts` | Shared settings E2E helpers. |
| `app/src/test/setup.ts` | Vitest global setup. |
| `app/vite.config.ts`, `app/vitest.config.ts`, `app/playwright.config.ts` | Test runner and build configuration. |

## Rust To E2E Map

Rust modules have inline `#[cfg(test)]` tests. When a Rust command is
UI-facing, also run the mapped E2E tag.

| Rust source | Cargo filter | E2E tag |
|---|---|---|
| `app/src-tauri/src/commands/workflow/mod.rs` | `commands::workflow` | `@workflow` |
| `app/src-tauri/src/commands/workflow/guards.rs` | `commands::workflow::guards` | `@workflow` |
| `app/src-tauri/src/commands/workflow/clarifications.rs` | `commands::workflow::clarifications` | `@workflow` |
| `app/src-tauri/src/commands/workflow/decisions.rs` | `commands::workflow::decisions` | `@workflow` |
| `app/src-tauri/src/commands/workflow/answer_evaluation.rs` | `commands::workflow::answer_evaluation` | `@workflow` |
| `app/src-tauri/src/db/workflow_artifacts.rs` | `db::workflow_artifacts` | -- |
| `app/src-tauri/src/commands/workspace.rs` | `commands::workspace` | `@dashboard` |
| `app/src-tauri/src/commands/skill/mod.rs` | `commands::skill` | `@dashboard` |
| `app/src-tauri/src/commands/skill/export.rs` | `commands::skill::export` | `@skills` |
| `app/src-tauri/src/commands/skill/scope_review.rs` | -- | `@dashboard` |
| `app/src-tauri/src/commands/files.rs` | `commands::files` | `@workflow` |
| `app/src-tauri/src/commands/settings.rs` | `commands::settings` | `@settings` |
| `app/src-tauri/src/commands/github_auth.rs` | `commands::github_auth` | `@settings` |
| `app/src-tauri/src/commands/imported_skills/mod.rs` | `commands::imported_skills` | `@skills` |
| `app/src-tauri/src/commands/imported_skills/frontmatter.rs` | `commands::imported_skills::frontmatter` | `@skills` |
| `app/src-tauri/src/commands/github_import/mod.rs` | `commands::github_import` | `@skills` |
| `app/src-tauri/src/commands/github_import/updates.rs` | `commands::github_import` | `@skills` |
| `app/src-tauri/src/commands/documents/mod.rs` | `commands::documents` | `@settings` |
| `app/src-tauri/src/commands/usage.rs` | `commands::usage` | `@dashboard` |
| `app/src-tauri/src/commands/agent.rs` | -- | `@workflow` |
| `app/src-tauri/src/commands/runtime_lifecycle.rs` | -- | `@workflow`, `@setup` |
| `app/src-tauri/src/commands/skill_session.rs` | `commands::skill_session` | `@workflow`, `@refine` |
| `app/src-tauri/src/commands/workflow_lifecycle.rs` | `commands::workflow_lifecycle` | `@workflow` |
| `app/src-tauri/src/commands/refine/mod.rs` | `commands::refine` | `@refine` |
| `app/src-tauri/src/commands/refine/events.rs` | `commands::refine::events` | `@refine` |
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | `commands::eval_workbench` | `@evals` |
| `app/src-tauri/src/commands/git.rs` | -- | `@dashboard` |
| `app/src-tauri/src/commands/lifecycle.rs` | -- | -- |
| `app/src-tauri/src/commands/feedback.rs` | -- | -- |
 | `app/src-tauri/src/commands/startup.rs` | `commands::startup` | -- |
| `app/src-tauri/src/agents/openhands_server/` | `agents::openhands_server` | `@workflow` |
| `app/src-tauri/src/agents/runtime_config.rs` | `agents::runtime_config` | `@workflow` |
| `app/src-tauri/src/db/mod.rs` | `db` | -- |
| `app/src-tauri/src/types/mod.rs` | `types` | -- |
| `app/src-tauri/src/cleanup.rs` | `cleanup` | -- |
| `app/src-tauri/src/fs_validation.rs` | `fs_validation` | -- |
| `app/src-tauri/src/commands/reconciliation.rs` | `commands::reconciliation` | `@dashboard` |
| `app/src-tauri/src/commands/model_catalog.rs` | `commands::model_catalog` | -- |
| `app/src-tauri/src/services/model_catalog.rs` | `services::model_catalog` | -- |
| `app/src-tauri/src/reconciliation/mod.rs` | `reconciliation` | `@dashboard` |
| `app/src-tauri/src/reconciliation/` | `reconciliation` | `@dashboard` |

## Artifact Contract Map

Agent prompts and generated artifacts are parsed by Rust and TypeScript. Keep
format changes covered across producer, fixture, and parser layers.

| Source | Consumer or risk | Compliance test |
|---|---|---|
| `agent-sources/workspace/**/agents/*.md` | Agent artifact anti-patterns and structural rules | `cd app && npm run test:agents:structural` |
| `app/src/__tests__/fixtures/openhands-events/*.jsonl` | OpenHands transcript fixture format drift | `cd app && npm run test:unit` (`canonical-format.test.ts`) |
| `app/src-tauri/src/commands/workflow/guards.rs` | Scope recommendation and decisions guard parser behavior | `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow::guards` |
| `app/src/components/decisions-summary-card.tsx` (`parseDecisions`) | Decision heading and frontmatter parser behavior | `cd app && npm run test:unit -- decisions-summary-card.test.tsx` |

## E2E Tags

| Tag | Spec files |
|---|---|
| `@dashboard` | `app/e2e/dashboard/dashboard-smoke.spec.ts`, `app/e2e/dashboard/reconciliation.spec.ts`, `app/e2e/dashboard/skill-history.spec.ts`, `app/e2e/dashboard/duplicate-skill-name.spec.ts`, `app/e2e/usage/usage-smoke.spec.ts` |
| `@setup` | `app/e2e/setup/setup-screen.spec.ts`, `app/e2e/setup/startup-error.spec.ts` |
| `@settings` | `app/e2e/settings/settings.spec.ts`, `app/e2e/settings/github-oauth.spec.ts`, `app/e2e/settings/workspace-reconfigure.spec.ts`, `app/e2e/settings/documents.spec.ts` |
| `@workflow` | `app/e2e/workflow/workflow-smoke.spec.ts`, `app/e2e/workflow/workflow-gate.spec.ts`, `app/e2e/workflow/display-items.spec.ts`, `app/e2e/workflow/file-viewer.spec.ts` |
| `@refine` | `app/e2e/refine/refine.spec.ts`, `app/e2e/refine/benchmark-snapshot-cleanup.spec.ts` |
| `@skills` | `app/e2e/skills-library/skills-library.spec.ts`, `app/e2e/github-import/github-import.spec.ts` |
| `@evals` | `app/e2e/evals/evals.spec.ts` Mocked Performance-mode browser coverage inside Eval Workbench |

## Quick Commands

```bash
cd app && npm run test:changed
cd app && bash tests/run.sh
cd app && bash tests/run.sh e2e --tag @workflow
cd tests/evals && npm test
cd app && npm run test:openhands:live-smoke # skips unless OPENHANDS_AGENT_SERVER_LIVE_SMOKE=1
```

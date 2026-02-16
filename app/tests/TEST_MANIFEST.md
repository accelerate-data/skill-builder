# Test Manifest

Maps every source file to its tests across all layers. Use this to determine which tests to run after a code change.

## Source-to-Test Mapping

### Stores

| Source | Unit Tests | Integration Tests | E2E Tag |
|---|---|---|---|
| `src/stores/agent-store.ts` | `stores/agent-store.test.ts` (45) | `components/agent-output-panel.test.tsx`, `components/agent-status-header.test.tsx`, `components/feedback-dialog.test.tsx`, `components/reasoning-review.test.tsx`, `pages/workflow.test.tsx` | `@workflow-agent` |
| `src/stores/workflow-store.ts` | `stores/workflow-store.test.ts` (26) | `components/agent-initializing-indicator.test.tsx`, `components/agent-status-header.test.tsx`, `components/reasoning-review.test.tsx`, `pages/workflow.test.tsx` | `@workflow`, `@workflow-agent` |
| `src/stores/skill-store.ts` | `stores/skill-store.test.ts` (2) | `pages/dashboard.test.tsx` | `@dashboard` |
| `src/stores/settings-store.ts` | `stores/settings-store.test.ts` (5) | `components/reasoning-review.test.tsx`, `pages/dashboard.test.tsx`, `pages/settings.test.tsx`, `pages/workflow.test.tsx` | `@settings` |
| `src/stores/imported-skills-store.ts` | `stores/imported-skills-store.test.ts` (13) | `components/imported-skill-card.test.tsx`, `pages/skills.test.tsx` | -- |
| `src/stores/auth-store.ts` | -- | `components/feedback-dialog.test.tsx`, `components/github-login-dialog.test.tsx`, `pages/settings.test.tsx` | `@settings` |
| `src/stores/usage-store.ts` | `stores/usage-store.test.ts` (8) | `pages/usage.test.tsx` | -- |

### Hooks

| Source | Unit Tests | Integration Tests | E2E Tag |
|---|---|---|---|
| `src/hooks/use-agent-stream.ts` | `hooks/use-agent-stream.test.ts` (21) | -- | `@workflow-agent` |
| `src/hooks/use-node-validation.ts` | -- | `components/app-layout.test.tsx` | -- |

### Library / Utilities

| Source | Unit Tests | Integration Tests | E2E Tag |
|---|---|---|---|
| `src/lib/utils.ts` | `lib/utils.test.ts` (3) | -- | -- |
| `src/lib/reasoning-parser.ts` | `lib/reasoning-parser.test.ts` (23) | `components/reasoning-review.test.tsx` | -- |
| `src/lib/types.ts` | -- | _(used by many integration tests)_ | -- |
| `src/lib/tauri.ts` | -- | -- | _all tags_ |

### Pages

| Source | Unit Tests | Integration Tests | E2E Tag |
|---|---|---|---|
| `src/pages/dashboard.tsx` | -- | `pages/dashboard.test.tsx` (18) | `@dashboard` |
| `src/pages/workflow.tsx` | -- | `pages/workflow.test.tsx` (26) | `@workflow`, `@workflow-agent` |
| `src/pages/settings.tsx` | -- | `pages/settings.test.tsx` (32) | `@settings` |
| `src/pages/skills.tsx` | -- | `pages/skills.test.tsx` (10) | -- |
| `src/pages/prompts.tsx` | -- | `pages/prompts.test.tsx` (6) | -- |
| `src/pages/usage.tsx` | -- | `pages/usage.test.tsx` (14) | -- |

### Components

| Source | Unit Tests | Integration Tests | E2E Tag |
|---|---|---|---|
| `src/components/agent-output-panel.tsx` | -- | `components/agent-output-panel.test.tsx` (114) | `@workflow-agent` |
| `src/components/agent-initializing-indicator.tsx` | -- | `components/agent-initializing-indicator.test.tsx` (10) | `@workflow-agent` |
| `src/components/agent-status-header.tsx` | -- | `components/agent-status-header.test.tsx` (20) | `@workflow-agent` |
| `src/components/about-dialog.tsx` | -- | `components/about-dialog.test.tsx` (9) | `@settings` |
| `src/components/skill-card.tsx` | -- | `components/skill-card.test.tsx` (35) | `@dashboard` |
| `src/components/new-skill-dialog.tsx` | -- | `components/new-skill-dialog.test.tsx` (21) | `@dashboard` |
| `src/components/delete-skill-dialog.tsx` | -- | `components/delete-skill-dialog.test.tsx` (8) | `@dashboard` |
| `src/components/reset-step-dialog.tsx` | -- | `components/reset-step-dialog.test.tsx` (7) | `@workflow` |
| `src/components/edit-tags-dialog.tsx` | -- | `components/edit-tags-dialog.test.tsx` (9) | `@dashboard` |
| `src/components/feedback-dialog.tsx` | -- | `components/feedback-dialog.test.tsx` (18) | `@workflow` |
| `src/components/reasoning-review.tsx` | -- | `components/reasoning-review.test.tsx` (8) | `@workflow` |
| `src/components/close-guard.tsx` | -- | `components/close-guard.test.tsx` (4) | `@navigation` |
| `src/components/imported-skill-card.tsx` | -- | `components/imported-skill-card.test.tsx` (14) | -- |
| `src/components/orphan-resolution-dialog.tsx` | -- | `components/orphan-resolution-dialog.test.tsx` (11) | -- |
| `src/components/tag-filter.tsx` | -- | `components/tag-filter.test.tsx` (6) | -- |
| `src/components/tag-input.tsx` | -- | `components/tag-input.test.tsx` (17) | -- |
| `src/components/error-boundary.tsx` | -- | -- | -- |
| `src/components/github-import-dialog.tsx` | -- | -- | -- |
| `src/components/onboarding-dialog.tsx` | -- | -- | -- |
| `src/components/runtime-error-dialog.tsx` | -- | -- | -- |
| `src/components/skill-preview-dialog.tsx` | -- | -- | -- |
| `src/components/splash-screen.tsx` | -- | -- | -- |
| `src/components/theme-provider.tsx` | -- | -- | -- |
| `src/components/trigger-text-editor.tsx` | -- | -- | -- |
| `src/components/workflow-sidebar.tsx` | -- | -- | `@workflow` |
| `src/components/workflow-step-complete.tsx` | -- | -- | `@workflow` |
| `src/components/github-login-dialog.tsx` | -- | `components/github-login-dialog.test.tsx` (7) | `@settings` |
| `src/components/layout/app-layout.tsx` | -- | `components/app-layout.test.tsx` (8) | `@navigation` |
| `src/components/layout/header.tsx` | -- | -- | `@navigation` |
| `src/components/layout/sidebar.tsx` | -- | -- | `@navigation` |

### Rust Backend

| Source | Cargo Tests | E2E Tag |
|---|---|---|
| `src-tauri/src/db.rs` | `cargo test db` (84) | -- |
| `src-tauri/src/types.rs` | `cargo test types` (5) | -- |
| `src-tauri/src/commands/workflow.rs` | `cargo test commands::workflow` (50) | `@workflow` |
| `src-tauri/src/commands/workspace.rs` | `cargo test commands::workspace` (1) | `@dashboard` |
| `src-tauri/src/commands/skill.rs` | `cargo test commands::skill` (19) | `@dashboard` |
| `src-tauri/src/commands/imported_skills.rs` | `cargo test commands::imported_skills` (30) | -- |
| `src-tauri/src/commands/files.rs` | `cargo test commands::files` (19) | `@workflow` |
| `src-tauri/src/commands/settings.rs` | `cargo test commands::settings` (7) | `@settings` |
| `src-tauri/src/commands/node.rs` | `cargo test commands::node` (6) | -- |
| `src-tauri/src/commands/clarification.rs` | `cargo test commands::clarification` (1) | `@workflow` |
| `src-tauri/src/commands/github_auth.rs` | -- | `@settings` |
| `src-tauri/src/cleanup.rs` | `cargo test cleanup` (1) | -- |
| `src-tauri/src/fs_validation.rs` | `cargo test fs_validation` (14) | -- |
| `src-tauri/src/reconciliation.rs` | `cargo test reconciliation` (28) | `@dashboard` |
| `src-tauri/src/agents/sidecar.rs` | `cargo test agents::sidecar` (2) | `@workflow-agent` |
| `src-tauri/src/agents/sidecar_pool.rs` | `cargo test agents::sidecar_pool` (8) | `@workflow-agent` |

### Sidecar (Node.js Agent Runner)

| Source | Unit Tests | E2E Tag |
|---|---|---|
| `sidecar/run-agent.ts` | `sidecar/__tests__/run-agent.test.ts` (14) | -- |
| `sidecar/options.ts` | `sidecar/__tests__/options.test.ts` (20) | -- |
| `sidecar/persistent-mode.ts` | `sidecar/__tests__/persistent-mode.test.ts` (33) | -- |
| `sidecar/shutdown.ts` | `sidecar/__tests__/shutdown.test.ts` (5) | -- |

### E2E Test Files

| Spec File | Tag | Test Count |
|---|---|---|
| `e2e/dashboard/dashboard.spec.ts` | `@dashboard` | 3 |
| `e2e/dashboard/dashboard-states.spec.ts` | `@dashboard` | 6 |
| `e2e/dashboard/skill-crud.spec.ts` | `@dashboard` | 6 |
| `e2e/settings/settings.spec.ts` | `@settings` | 4 |
| `e2e/workflow/workflow-agent.spec.ts` | `@workflow-agent` | 4 |
| `e2e/navigation/navigation.spec.ts` | `@navigation` | 2 |

### CLI Plugin (shared with desktop app)

Agents and references are shared between the desktop app and the CLI plugin. Changes to these files require plugin tests too.

| Source Pattern | Plugin Tag | Plugin Tiers | Desktop App Impact |
|---|---|---|---|
| `agent-sources/templates/*.md` (5 files) | `@agents` | t1, t4 | Run `build-agents.sh` first |
| `agent-sources/types/*/config.conf` (4 files) | `@agents` | t1, t4 | Run `build-agents.sh` first |
| `agents/{type}/*.md` (20 generated files) | `@agents` | t1, t4 | -- |
| `agents/shared/*.md` (4 files) | `@agents` | t1, t4 | -- |
| `scripts/build-agents.sh` | `@agents` | t1 | Run to regenerate agents |
| `skills/generate-skill/SKILL.md` | `@coordinator` | t1, t2, t3 | -- |
| `agent-sources/workspace/CLAUDE.md` (agent instructions) | `@agents` | t1, t4 | -- |
| `.claude-plugin/plugin.json` | `@structure` | t1 | -- |

**Commands:**
```bash
./scripts/test-plugin.sh --tag @agents        # Agent prompts changed
./scripts/test-plugin.sh --tag @coordinator   # Coordinator skill changed
./scripts/test-plugin.sh --tag @structure     # Plugin manifest changed
./scripts/test-plugin.sh t1                   # Quick structural check (free, no LLM)
```

### Skill Evaluation Harness

| Source | Test Script | Test Count |
|---|---|---|
| `scripts/eval/eval-skill-quality.sh` | `scripts/eval/test-eval-harness.sh` (14 structural + 5 live API) | 19 |
| `scripts/eval/prompts/*.txt` (4 files) | -- | -- |

**Command:** `./tests/run.sh eval`

## Change Impact Rules

### Shared infrastructure (run everything)

If you change any of these files, run the full test suite (`./tests/run.sh`):

- `src/lib/tauri.ts` -- Tauri command type definitions used everywhere
- `src/test/mocks/tauri.ts` -- Unit test mock infrastructure
- `src/test/mocks/tauri-e2e.ts` -- E2E mock infrastructure
- `src/test/mocks/tauri-e2e-event.ts` -- E2E event system mock
- `src/test/setup.ts` -- Vitest global setup
- `vite.config.ts` -- Build config affects all tests
- `vitest.config.ts` or `playwright.config.ts` -- Test runner config

### Adding a new Tauri command

1. Add the command type to `src/lib/tauri.ts`
2. Add a mock response in `src/test/mocks/tauri.ts` (for unit/integration tests)
3. Add a mock response in `src/test/mocks/tauri-e2e.ts` (for E2E tests)
4. Write a `#[cfg(test)]` test in the Rust command module
5. Write a component or page test that exercises the command

### Adding a new store

1. Create `src/stores/<name>-store.ts`
2. Create `src/__tests__/stores/<name>-store.test.ts`
3. If the store is used in a page, add integration tests in `src/__tests__/pages/`

### Harness Self-Tests

These scripts validate the test infrastructure itself. Run after modifying `run.sh`, `test-plugin.sh`, or `TEST_MANIFEST.md`.

| Script | Tests | What it validates |
|---|---|---|
| `tests/harness-test.sh` | 23 | Arg parsing, level/tier routing, tag mapping, error handling |
| `tests/manifest-scenarios.sh` | 70 | Source-to-test mapping for app, plugin, and cross-cutting changes |

## Quick Reference Commands

```bash
# By feature area
./tests/run.sh e2e --tag @dashboard       # Dashboard E2E
./tests/run.sh e2e --tag @settings        # Settings E2E
./tests/run.sh e2e --tag @workflow-agent   # Workflow agent E2E
./tests/run.sh e2e --tag @navigation      # Navigation E2E

# By level
npm run test:unit                          # Frontend stores + lib + hooks
npm run test:integration                   # Frontend components + pages
npm run test:e2e                           # All Playwright tests
cargo test --manifest-path src-tauri/Cargo.toml   # All Rust tests
cd sidecar && npx vitest run              # All sidecar tests

# Plugin tests
./tests/run.sh plugin                    # All plugin tiers
./tests/run.sh plugin --tag @agents      # Agent prompt changes
./tests/run.sh plugin --tag @coordinator # Coordinator changes

# Targeted Rust tests
cargo test --manifest-path src-tauri/Cargo.toml commands::workflow
cargo test --manifest-path src-tauri/Cargo.toml db
cargo test --manifest-path src-tauri/Cargo.toml agents::sidecar_pool

# Harness self-tests
./tests/harness-test.sh                  # Validate harness arg parsing (21 tests)
./tests/manifest-scenarios.sh            # Validate manifest coverage (68 scenarios)
```

# Skill Builder Test Guide

Unified test documentation for the Skill Builder desktop app. Tests span four runtimes (Vitest, Playwright, cargo, sidecar Vitest) organized into five logical levels plus a self-test suite.

## Quick Start

```bash
cd app

# Run everything (all levels)
./tests/run.sh

# Run a single level
./tests/run.sh unit            # Pure logic: stores, utils, hooks, Rust, sidecar
./tests/run.sh integration     # Component rendering with mocked APIs
./tests/run.sh e2e             # Full browser tests (Playwright)
./tests/run.sh agents          # Agent structural tests (Vitest, free)
./tests/run.sh eval            # Eval harness tests

# E2E: run by feature area
./tests/run.sh e2e --tag @dashboard
./tests/run.sh e2e --tag @settings
./tests/run.sh e2e --tag @workflow
./tests/run.sh e2e --tag @workflow-agent
./tests/run.sh e2e --tag @navigation
./tests/run.sh e2e --tag @skills
./tests/run.sh e2e --tag @usage

# Validate the harness and manifest themselves
./tests/harness-test.sh        # Harness arg parsing + error handling (21 tests)
./tests/manifest-scenarios.sh  # Cross-layer manifest validation (45 scenarios)

# npm script equivalents
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:e2e:dashboard
npm run test:e2e:settings
npm run test:e2e:workflow
npm run test:e2e:navigation
npm run test:e2e:skills
npm run test:e2e:usage
```

## Test Levels

### Level 1: Unit Tests

Pure logic with no DOM rendering. Tests individual functions, store actions, and derived state.

| Runtime | Command | Location |
|---|---|---|
| Frontend (Vitest) | `npm run test:unit` | `src/__tests__/stores/`, `src/__tests__/lib/`, `src/__tests__/hooks/` |
| Rust (cargo) | `cargo test --manifest-path src-tauri/Cargo.toml` | `src-tauri/src/` (inline `#[cfg(test)]` modules) |
| Sidecar (Vitest) | `cd sidecar && npx vitest run` | `sidecar/__tests__/` |

### Level 2: Integration Tests

Component rendering with mocked Tauri APIs. Uses `@testing-library/react` to mount components and verify behavior against mock backends.

| Runtime | Command | Location |
|---|---|---|
| Frontend (Vitest) | `npm run test:integration` | `src/__tests__/components/`, `src/__tests__/pages/` |

### Level 3: E2E Tests (Playwright)

Full browser tests via Playwright. The app runs with `TAURI_E2E=true`, which swaps real Tauri APIs for mock implementations. Tests exercise complete user flows.

| Runtime | Command | Location |
|---|---|---|
| Playwright | `npm run test:e2e` | `e2e/dashboard/`, `e2e/settings/`, `e2e/workflow/`, `e2e/navigation/`, `e2e/skills/`, `e2e/usage/` |

### Level 4: Agent Tests

Structural checks for agent prompts in Vitest. Run without an API key — no LLM calls are made.

| Suite | What | Cost | npm script |
|---|---|---|---|
| structural | Agent files, format checks, anti-patterns | Free | `test:agents:structural` |
| smoke | Individual agent output via API | ~$0.50 | `test:agents:smoke` |

```bash
./tests/run.sh agents              # Structural agent tests (free)
npm run test:agents:structural     # Structural only (free, no API key needed)
```

### Level 5: Eval Harness Tests

Structural and live API tests for the skill evaluation harness. Structural tests run without API keys; live tests require `ANTHROPIC_API_KEY`.

| Runtime | Command | Location |
|---|---|---|
| Bash + Claude | `./tests/run.sh eval` | `scripts/eval/test-eval-harness.sh` |

### Self-Tests

Validate the test infrastructure itself — argument parsing, tag routing, and cross-layer manifest mappings.

| Script | Tests | What it validates |
|---|---|---|
| `./tests/harness-test.sh` | — | run.sh accepts valid args, rejects invalid ones, shows help |
| `./tests/manifest-scenarios.sh` | 45 | Cross-layer mappings: Rust → E2E tags, shared infra, plugin sources |

## Running by Area

Each E2E spec file has a Playwright tag on its top-level `test.describe()`. Use tags to run tests for a specific feature area:

| Area | Tag | Command | Specs |
|---|---|---|---|
| Dashboard | `@dashboard` | `./tests/run.sh e2e --tag @dashboard` | `dashboard.spec.ts`, `dashboard-states.spec.ts`, `skill-crud.spec.ts` |
| Settings | `@settings` | `./tests/run.sh e2e --tag @settings` | `settings.spec.ts` |
| Workflow (steps) | `@workflow` | `./tests/run.sh e2e --tag @workflow` | `workflow-steps.spec.ts`, `workflow-navigation.spec.ts` |
| Workflow (agent) | `@workflow-agent` | `./tests/run.sh e2e --tag @workflow-agent` | `workflow-agent.spec.ts` |
| Navigation | `@navigation` | `./tests/run.sh e2e --tag @navigation` | `navigation.spec.ts` |
| Skills Library | `@skills` | `./tests/run.sh e2e --tag @skills` | `skills.spec.ts` |
| Usage | `@usage` | `./tests/run.sh e2e --tag @usage` | `usage.spec.ts` |

## Adding Tests

### Where to put new tests

- **New store action or derived state** -- `src/__tests__/stores/<store-name>.test.ts`
- **New utility function** -- `src/__tests__/lib/<module>.test.ts`
- **New hook** -- `src/__tests__/hooks/<hook-name>.test.ts`
- **New component** -- `src/__tests__/components/<component-name>.test.tsx`
- **New page** -- `src/__tests__/pages/<page-name>.test.tsx`
- **New Rust command with testable logic** -- inline `#[cfg(test)]` module in the same `.rs` file
- **New sidecar module** -- `sidecar/__tests__/<module-name>.test.ts`
- **New user flow** -- `e2e/<area>/<flow-name>.spec.ts`

### How to tag E2E tests

Add `{ tag: "@area" }` to the top-level `test.describe()`:

```typescript
test.describe("Feature Name", { tag: "@area" }, () => {
  test("does something", async ({ page }) => {
    // ...
  });
});
```

Available tags: `@dashboard`, `@navigation`, `@settings`, `@skills`, `@usage`, `@workflow`, `@workflow-agent`.

### Naming conventions

- Unit and integration tests: `<source-name>.test.ts` or `<source-name>.test.tsx`
- E2E tests: `<feature-name>.spec.ts`
- Rust tests: inline `#[cfg(test)] mod tests { ... }` in the source file

## Directory Structure

```text
app/
  agent-tests/
    agent-structure.test.ts  # Agent file structure, format checks, anti-patterns (free)
    agent-smoke.test.ts      # Agent smoke tests via API (~$0.50)
    helpers.ts               # Shared helpers
    fixtures.ts              # Fixture factories
  tests/
    README.md                # This file
    TEST_MANIFEST.md         # Cross-layer map (Rust → E2E tags, shared infra, agents)
    run.sh                   # Unified test runner (unit, integration, e2e, agents)
    harness-test.sh          # Self-tests for run.sh
    manifest-scenarios.sh    # Cross-layer manifest validation
    unit/
      frontend/              -> ../../src/__tests__/       (symlink)
      sidecar/               -> ../../sidecar/__tests__/   (symlink)
    e2e/                     -> ../e2e/                    (symlink)
```

Symlinks provide a single entry point for browsing tests without moving files from their framework-idiomatic locations.

## For AI Assistants

For frontend changes, use `npm run test:changed` to auto-detect affected tests. For Rust and cross-layer concerns, consult **`TEST_MANIFEST.md`** in this directory — it maps Rust modules to E2E tags, shared infrastructure files, and plugin sources.

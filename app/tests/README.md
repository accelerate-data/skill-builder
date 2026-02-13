# Skill Builder Test Guide

Unified test documentation for the Skill Builder desktop app. Tests span four runtimes (Vitest, Playwright, cargo, sidecar Vitest) organized into three logical levels.

## Quick Start

```bash
cd app

# Run everything (all levels)
./tests/run.sh

# Run a single level
./tests/run.sh unit            # Pure logic: stores, utils, hooks, Rust, sidecar
./tests/run.sh integration     # Component rendering with mocked APIs
./tests/run.sh e2e             # Full browser tests (Playwright)

# Run E2E tests by feature area
./tests/run.sh e2e --tag @dashboard
./tests/run.sh e2e --tag @settings
./tests/run.sh e2e --tag @workflow-agent
./tests/run.sh e2e --tag @navigation

# npm script equivalents
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:e2e:dashboard
npm run test:e2e:settings
npm run test:e2e:workflow
npm run test:e2e:navigation
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

### Level 3: E2E Tests

Full browser tests via Playwright. The app runs with `TAURI_E2E=true`, which swaps real Tauri APIs for mock implementations. Tests exercise complete user flows.

| Runtime | Command | Location |
|---|---|---|
| Playwright | `npm run test:e2e` | `e2e/dashboard/`, `e2e/settings/`, `e2e/workflow/`, `e2e/navigation/` |

## Running by Area

Each E2E spec file has a Playwright tag on its top-level `test.describe()`. Use tags to run tests for a specific feature area:

| Area | Tag | Command | Specs |
|---|---|---|---|
| Dashboard | `@dashboard` | `./tests/run.sh e2e --tag @dashboard` | `dashboard.spec.ts`, `dashboard-states.spec.ts`, `skill-crud.spec.ts` |
| Settings | `@settings` | `./tests/run.sh e2e --tag @settings` | `settings.spec.ts` |
| Workflow (agent) | `@workflow-agent` | `./tests/run.sh e2e --tag @workflow-agent` | `workflow-agent.spec.ts` |
| Navigation | `@navigation` | `./tests/run.sh e2e --tag @navigation` | `navigation.spec.ts` |

## Test Inventory

| Layer | Files | Test Cases | Location |
|---|---|---|---|
| Frontend unit | 9 | ~113 | `src/__tests__/stores/`, `src/__tests__/lib/`, `src/__tests__/hooks/` |
| Frontend integration | 21 | ~413 | `src/__tests__/components/`, `src/__tests__/pages/` |
| E2E (Playwright) | 6 | ~25 | `e2e/` subdirectories |
| Rust (cargo) | 13 | ~216 | `src-tauri/src/` inline modules |
| Sidecar | 6 | ~82 | `sidecar/__tests__/` |
| **Total** | **55** | **~849** | |

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

Available tags: `@dashboard`, `@settings`, `@workflow`, `@workflow-agent`, `@navigation`.

### Naming conventions

- Unit and integration tests: `<source-name>.test.ts` or `<source-name>.test.tsx`
- E2E tests: `<feature-name>.spec.ts`
- Rust tests: inline `#[cfg(test)] mod tests { ... }` in the source file

## Directory Structure

```
app/tests/
  README.md              # This file
  TEST_MANIFEST.md       # Source-to-test mapping (for AI-assisted test selection)
  run.sh                 # Unified test runner
  unit/
    frontend/            -> ../../src/__tests__/       (symlink)
    sidecar/             -> ../../sidecar/__tests__/   (symlink)
  e2e/                   -> ../e2e/                    (symlink)
```

Symlinks provide a single entry point for browsing tests without moving files from their framework-idiomatic locations.

## For AI Assistants

When deciding which tests to run after a code change, consult **`TEST_MANIFEST.md`** in this directory. It maps every source file to its corresponding tests across all three levels, with exact commands for each.

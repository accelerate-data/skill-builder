# App Test Runner

`app/tests/` contains app-local test orchestration scripts. The root
`TEST_MAP.md` is the source of truth for choosing validation commands across
the repo.

## Quick Start

```bash
cd app

# Run everything (all levels)
./tests/run.sh

# Run a single level
./tests/run.sh unit            # Pure logic: stores, utils, hooks, Rust
./tests/run.sh integration     # Component rendering with mocked APIs
./tests/run.sh e2e             # Full browser tests (Playwright)
./tests/run.sh agents          # Agent structural tests (Vitest, free)

# E2E: run by feature area
./tests/run.sh e2e --tag @dashboard
./tests/run.sh e2e --tag @settings
./tests/run.sh e2e --tag @workflow
./tests/run.sh e2e --tag @refine
./tests/run.sh e2e --tag @description
./tests/run.sh e2e --tag @skills
./tests/run.sh e2e --tag @evals

# Validate the harness and test map themselves
./tests/harness-test.sh        # Harness arg parsing + error handling
./tests/test-map-scenarios.sh  # Cross-layer test map validation

# npm script equivalents
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:e2e:dashboard
npm run test:e2e:settings
npm run test:e2e:workflow
npm run test:e2e:skills
npm run test:e2e:usage
```

## Test Levels

| Level | Command | Scope |
|---|---|---|
| Unit | `./tests/run.sh unit` | Frontend unit tests and Rust inline tests |
| Integration | `./tests/run.sh integration` | Component and page tests with mocked Tauri APIs |
| E2E | `./tests/run.sh e2e` | Playwright tests with mocked Tauri APIs |
| Agents | `./tests/run.sh agents` | Structural agent prompt checks only |
| All | `./tests/run.sh` | Unit, integration, E2E, and agent structural tests |

### Self-Tests

Validate the test infrastructure itself: argument parsing, tag routing, and
cross-layer test-map mappings.

| Script | Tests | What it validates |
|---|---|---|
| `./tests/harness-test.sh` | — | run.sh accepts valid args, rejects invalid ones, shows help |
| `./tests/test-map-scenarios.sh` | — | Cross-layer mappings: Rust → E2E tags, shared infra, agent sources |

## Adding Tests

Use `TEST_MAP.md` for test placement, E2E tags, Rust-to-E2E mappings, and
artifact-contract coverage. Update that file when a new test suite, mapped Rust
source, E2E spec, or artifact parser contract is added.

## Directory Structure

```text
app/
  tests/
    README.md                # This file
    run.sh                   # Unified test runner (unit, integration, e2e, agents)
    harness-test.sh          # Self-tests for run.sh
    test-map-scenarios.sh    # Cross-layer test map validation
  src/__tests__/             # Frontend unit, guard, integration tests
  e2e/                       # Playwright E2E specs
  agent-tests/               # Agent structural tests
tests/evals/                 # Repo-level Promptfoo/OpenCode eval harness
```

## For AI Assistants

For frontend changes, use `npm run test:changed` to auto-detect affected
tests. For Rust, cross-layer, agent, or eval changes, consult `TEST_MAP.md` at
the repo root.

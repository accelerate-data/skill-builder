# Agent Unit Test Suite

## Decision

Keep agent behavior regression testing in two layers: free deterministic structural checks and paid Promptfoo smoke evals; always run structural checks autonomously, and gate smoke evals behind explicit API-enabled runs.

## Why

This keeps fast feedback cheap and continuous while preserving real behavior coverage for agent regressions with actionable artifacts.

## Test Layers

| Layer | Purpose | Primary command |
|---|---|---|
| Unit | Frontend pure logic, Rust inline tests, sidecar unit tests | `cd app && npm run test:unit` and `cd app && cargo test --manifest-path src-tauri/Cargo.toml` and `cd app/sidecar && npx vitest run` |
| Integration | Frontend component/page behavior with mocked APIs | `cd app && npm run test:integration` |
| E2E | End-to-end UI flows with Playwright | `cd app && npm run test:e2e` |
| Agent structural | Prompt/frontmatter/format anti-pattern checks (no API) | `cd app && npm run test:agents:structural` |
| Agent smoke (Promptfoo) | Live agent behavior regression scenarios via Claude CLI | `cd app && npm run test:agents:smoke` |
| Harness self-tests | Test harness and manifest integrity | `cd app && ./tests/harness-test.sh && ./tests/manifest-scenarios.sh` |

## Promptfoo Harness Structure

| File | Responsibility |
|---|---|
| `app/agent-tests/promptfoo/promptfooconfig.yaml` | Scenario catalog and assertions |
| `app/agent-tests/promptfoo/provider.mjs` | Custom Promptfoo provider; fixture setup + Claude CLI invocation + output validation |
| `app/package.json` (`test:agents:smoke`) | Canonical smoke entrypoint and artifact output paths |
| `app/test-results/promptfoo-results.json` | Machine-readable eval result |
| `app/test-results/promptfoo-results.html` | Human-readable eval report |

## Maintaining Scenarios

### Add or modify a scenario

1. Add/update a `tests[]` entry in `app/agent-tests/promptfoo/promptfooconfig.yaml`.
2. Keep `description` equal to scenario id (used for filtering).
3. Implement/adjust handler logic in `provider.mjs` under `scenarioHandlers`.
4. Validate expected output shape in provider return payload, then assert it in config.

### Existing scenarios

- `research-orchestrator`
- `answer-evaluator`
- `confirm-decisions`
- `refine-skill`

## Running Tests

### Run full suite

```bash
cd app
./tests/run.sh
```

### Run only agent structural

```bash
cd app
npm run test:agents:structural
```

### Run all Promptfoo smoke scenarios

```bash
cd app
npm run test:agents:smoke
```

### Run one specific Promptfoo scenario

```bash
cd app
promptfoo eval -c agent-tests/promptfoo/promptfooconfig.yaml --filter-pattern "^research-orchestrator$"
```

Swap `research-orchestrator` with `answer-evaluator`, `confirm-decisions`, or `refine-skill`.

## Agent Autonomy Policy (for coding agents)

When changed files match these patterns, coding agents should auto-run the mapped tests before reporting completion:

| Changed area | Auto-run tests |
|---|---|
| `agents/*.md` | `cd app && npm run test:agents:structural` |
| `agent-sources/workspace/**` | `cd app && npm run test:agents:structural` |
| `app/sidecar/**` | `cd app && npm run test:agents:structural` and `cd app/sidecar && npx vitest run` |
| Artifact-format files (`app/sidecar/mock-templates/**`, `app/e2e/fixtures/agent-responses/**`) | `cd app && npm run test:unit` |

Promptfoo smoke evals are manual by default (`npm run test:agents:smoke`) because they are live API calls.

## CI Expectations

- Required checks: `frontend` and `rust`.
- Promptfoo outputs must be written to `app/test-results/` for debugging and triage.
- Keep lockfile in sync with `package.json` to avoid `npm ci` drift in CI.

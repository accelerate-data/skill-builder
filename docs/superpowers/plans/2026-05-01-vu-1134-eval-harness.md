# VU-1134 Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app-local Promptfoo harness with a root `tests/evals` harness patterned after Migration Utility's tiered runner.

**Architecture:** The new harness owns its own npm package, repo-local Promptfoo state, config-resolution scripts, tier config, and package-level eval configs. Existing Skill Builder agent and scope-advisor scenarios are moved into this harness as live/model-backed packages, while deterministic Node tests validate the harness itself without calling an LLM.

**Tech Stack:** Node.js test runner, Promptfoo, JavaScript provider scripts, JSON package configs, TOML tier config, existing Claude CLI live scenario providers.

---

## Manual Test Scope

No manual UI or exploratory tests are required.

Live/model-backed smoke evals are automated CLI scenarios, but they remain human-triggered because they make live model/API calls. Coding agents must not run them autonomously. The implementation will document the exact manual commands.

## Files

- Create: `tests/evals/package.json`
- Create: `tests/evals/package-lock.json`
- Create: `tests/evals/.gitignore`
- Create: `tests/evals/config/eval-tiers.toml`
- Create: `tests/evals/scripts/promptfoo.sh`
- Create: `tests/evals/scripts/run-promptfoo-with-guard.js`
- Create: `tests/evals/scripts/eval-tier-config.js`
- Create: `tests/evals/scripts/resolve-promptfoo-config.js`
- Create: `tests/evals/scripts/*.test.js`
- Create: `tests/evals/providers/skill-builder-agent-provider.mjs`
- Create: `tests/evals/providers/scope-advisor-provider.mjs`
- Create: `tests/evals/assertions/contracts.mjs`
- Create: `tests/evals/packages/agent-contracts/promptfooconfig.json`
- Create: `tests/evals/packages/scope-advisor/promptfooconfig.json`
- Modify: `app/package.json`
- Delete: `app/agent-tests/promptfoo/*`
- Modify: `.gitignore`
- Modify: `repo-map.json`
- Modify: `TEST_MANIFEST.md`
- Modify: `AGENTS.md`

## Tasks

### Task 1: Add Harness Contract Tests

- [ ] Create `tests/evals/package.json` with `node --test` scripts.
- [ ] Add failing tests for tier config validation, config materialization, repo-local artifact guard, and package contract checks.
- [ ] Run `cd tests/evals && npm test` and verify the tests fail because scripts/configs do not exist yet.

### Task 2: Port Migration Utility Harness Scripts

- [ ] Copy and adapt the Migration Utility scripts into `tests/evals/scripts`.
- [ ] Add `tests/evals/config/eval-tiers.toml` with light/standard/high/x_high tiers.
- [ ] Keep Promptfoo state under `tests/evals/.promptfoo`, cache under `tests/evals/.cache`, temp configs under `tests/evals/.tmp`, and outputs under `tests/evals/results` or `tests/evals/output`.
- [ ] Run `cd tests/evals && npm test` and verify deterministic harness tests pass.
- [ ] Commit the harness infrastructure.

### Task 3: Move Existing Promptfoo Scenarios Into Packages

- [ ] Copy `app/agent-tests/promptfoo/provider.mjs` to `tests/evals/providers/skill-builder-agent-provider.mjs`.
- [ ] Copy `app/agent-tests/promptfoo/scope-advisor-provider.mjs` to `tests/evals/providers/scope-advisor-provider.mjs`.
- [ ] Copy `app/agent-tests/promptfoo/assertions/contracts.mjs` to `tests/evals/assertions/contracts.mjs`.
- [ ] Convert the two existing YAML configs into package-level JSON configs with `metadata.eval_tier`, package-local providers supplied by the resolver, and the existing assertions preserved.
- [ ] Update providers to read model/budget/timeout from resolved provider config instead of package-local environment variables where possible.
- [ ] Delete the old `app/agent-tests/promptfoo` directory.
- [ ] Run `cd tests/evals && npm test`.
- [ ] Commit the package migration.

### Task 4: Wire Repo Scripts And Docs

- [ ] Update `app/package.json` so `test:agents:smoke` and `test:scope-advisor:smoke` delegate to `tests/evals`.
- [ ] Add root eval scripts if needed for convenient direct execution.
- [ ] Update `.gitignore`, `repo-map.json`, `TEST_MANIFEST.md`, and `AGENTS.md` with the new harness path, commands, and manual live-smoke policy.
- [ ] Run `cd app && npm run test:agents:structural`.
- [ ] Run `cd tests/evals && npm test`.
- [ ] Commit script and docs wiring.

### Task 5: Final Verification And Linear Update

- [ ] Run deterministic verification:
  - `cd tests/evals && npm test`
  - `cd app && npm run test:agents:structural`
  - `cd app && npm run test:unit`
- [ ] Do not run live smoke evals autonomously.
- [ ] Post Linear implementation evidence with completed automation and the manual live-smoke commands.
- [ ] Leave the worktree clean with local commits only; do not push or raise PR.

## Self-Review

- The plan covers the VU-1134 harness acceptance criteria and leaves eval scenario redesign to VU-1135.
- The only human-triggered step is live/model-backed smoke execution; the scenarios themselves are automated CLI runs.
- The plan keeps deterministic harness validation separate from live eval behavior.

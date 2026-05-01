# VU-1048 Playwright E2E Surface Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review Playwright E2E coverage across UI surfaces and add the missing Optimize Description happy path.

**Architecture:** Keep Playwright at the existing browser-mocked Tauri boundary. Add one focused `@description` spec that drives the real workspace tab UI with deterministic command/event mocks, and keep broader surface decisions in this durable plan instead of expanding CI with low-value duplicates.

**Tech Stack:** Playwright, React workspace tabs, Tauri E2E command mocks, sidecar mock templates, Markdown test manifest.

---

## E2E Surface Review

| Surface | Existing specs | Decision | Rationale |
|---|---|---|---|
| Dashboard and skill list | `dashboard-smoke`, duplicate-name, reconciliation, skill-history, usage smoke | Keep | Covers workspace routing, create/delete, restore, startup reconciliation, and usage workflows at user boundaries. |
| Setup | setup screen, startup error | Keep | Protects first-run and runtime dependency failure entrypoints. |
| Settings | settings, GitHub OAuth, workspace reconfigure, documents | Keep | Covers multi-section settings flows with Tauri command boundaries. |
| Workflow generation | workflow smoke, gates, display items, file viewer | Keep | Broadest cross-layer workflow surface; guard and display tests protect regressions not covered by unit-only checks. |
| Refine | refine, benchmark snapshot cleanup | Keep | Covers chat, file preview/diff, redirects, running guards, and cleanup side effects. |
| Evals | evals browser mock and sidecar integration | Keep | Browser mock covers the tab workflow; sidecar integration is intentionally separated under nightly tags. |
| Skills Library and GitHub import | skills-library, github-import | Keep | Covers plugin management and marketplace import workflows. |
| Desktop smoke | desktop-smoke | Keep | Post-merge/nightly safety net with real mock sidecar. |
| Optimize Description | none before VU-1048 | Add | Missing user-facing workspace tab happy path: generate queries, optimize, inspect results, apply best description. |

No existing Playwright scenario is pruned in this issue. Several tests overlap lower-level coverage, but each retained case protects a user-visible routing, modal, event, or command-mock integration boundary. The only missing high-value scenario in scope is Optimize Description.

## Task 1: Add Description Mock Fixtures

**Files:**

- Create: `app/e2e/fixtures/description-optimization.ts`
- Modify: `app/src/test/mocks/tauri-e2e.ts`
- Modify: `app/sidecar/mock-agent.ts`
- Create: `app/sidecar/mock-templates/description-evals-generator.jsonl`
- Create: `app/sidecar/mock-templates/outputs/description-evals-generator/description-evals-result.json`
- Test: `app/sidecar/__tests__/mock-agent.test.ts`

- [x] **Step 1: Add deterministic query-generation and optimization payloads**

The browser E2E fixture exports generated eval queries and an optimization result whose best iteration is visibly better than the baseline.

- [x] **Step 2: Add sidecar mock-template mapping for `stepId=-12`**

`resolveStepTemplate(undefined, { stepId: -12 })` returns `description-evals-generator`, and `buildStructuredMockResult()` reads the JSON payload used by the mock result.

- [x] **Step 3: Add a regression test for the mapping**

Run: `cd app/sidecar && npx vitest run __tests__/mock-agent.test.ts`

Expected: the new mapping test passes with the existing mock-agent suite.

## Task 2: Add Optimize Description E2E Spec

**Files:**

- Create: `app/e2e/helpers/description-helpers.ts`
- Create: `app/e2e/description/description-optimization.spec.ts`

- [x] **Step 1: Add a helper that selects `test-skill` and opens the tab**

The helper uses `reloadWithOverrides()` and the same `__TAURI_MOCK_OVERRIDES__` boundary as the rest of the E2E suite.

- [x] **Step 2: Add the happy path**

The spec clicks Generate, emits `description:eval-queries-generated`, verifies trigger/non-trigger queries render, runs optimization, verifies score progression and best description, then applies the best description.

- [x] **Step 3: Tag the spec**

The describe block uses `{ tag: "@description" }` so it can run via `./tests/run.sh e2e --tag @description`.

## Task 3: Wire Manifests and CI Filtering

**Files:**

- Modify: `TEST_MANIFEST.md`
- Modify: `app/playwright.config.ts`
- Modify: `app/tests/run.sh`
- Modify: `repo-map.json`

- [x] **Step 1: Map description Rust commands to `@description`**

Description command modules now list `@description` as their UI-facing E2E tag.

- [x] **Step 2: Add the new spec to the E2E manifest**

`e2e/description/description-optimization.spec.ts` is listed with `@description`.

- [x] **Step 3: Include `@description` in the smoke project and runner help**

The Playwright smoke project and `tests/run.sh` tag help both include `@description`.

## Task 4: Validate

**Files:**

- Test-only verification

- [x] **Step 1: Run the new E2E tag**

Run: `cd app && ./tests/run.sh e2e --tag @description`

Expected: one `@description` Playwright test passes.

- [x] **Step 2: Run sidecar mock-agent unit coverage**

Run: `cd app/sidecar && npx vitest run __tests__/mock-agent.test.ts`

Expected: mock-agent tests pass.

- [x] **Step 3: Run manifest/docs checks**

Run: `markdownlint docs/superpowers/plans/2026-05-01-vu-1048-playwright-e2e-surface-review.md && git diff --check`

Expected: no output and exit code 0.

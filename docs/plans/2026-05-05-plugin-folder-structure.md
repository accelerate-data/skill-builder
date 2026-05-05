# VU-1160 Runtime Contract Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining clean-break violations in the OpenHands runtime branch by deleting stale `sdk_ready` and `runtimeProvider` usage, and by stopping frontend settings hydration/forms from inventing Anthropic defaults when no model provider is configured.

**Architecture:** This is a narrow runtime-contract cleanup, not a broad provider removal. The app already emits `runtime_ready` in the canonical Rust/TypeScript contracts and no longer models `runtimeProvider` in `SidecarConfig`; the remaining work is to align E2E helpers, event fixtures, and frontend settings defaults to that contract. Because the user explicitly wants clean-break behavior, we remove old names instead of adding aliases or compatibility shims.

**Tech Stack:** React/TypeScript, Tauri/Rust generated contracts, Playwright E2E helpers, Vitest, cargo codegen.

**Functional spec:** `not_applicable`
**Design docs:** `docs/design/openhands-event-display-projection/README.md`, `docs/design/openhands-workspace-management/README.md`
**Related prior plan:** `docs/plans/2026-05-04-vu-1145-dead-code-cleanup.md`

---

## File Structure

| File | Change |
|---|---|
| `app/src/hooks/use-app-startup.ts` | Stop hydrating missing provider values as `"anthropic"` |
| `app/src/hooks/use-settings-form.ts` | Stop defaulting unsaved form state to `"anthropic"` when provider is unset |
| `app/src/__tests__/hooks/use-app-startup.test.ts` | Assert unset provider stays unset |
| `app/src/__tests__/hooks/use-settings-form.test.ts` | Assert unset provider stays unset through form normalization |
| `app/e2e/helpers/agent-simulator.ts` | Replace `sdk_ready` with `runtime_ready` in emitted events and comments |
| `app/src/__tests__/fixtures/openhands-events/*.jsonl` | Remove stale `runtimeProvider` field from fixture config payloads |

## Task 1: Remove implicit Anthropic defaults from frontend settings hydration

**Files:**
- Modify: `app/src/hooks/use-app-startup.ts`
- Modify: `app/src/hooks/use-settings-form.ts`
- Test: `app/src/__tests__/hooks/use-app-startup.test.ts`
- Test: `app/src/__tests__/hooks/use-settings-form.test.ts`

- [ ] **Step 1: Update the startup hydration test first**

In `app/src/__tests__/hooks/use-app-startup.test.ts`, add a test that loads `model_settings: null` and asserts:

```ts
expect(patch.modelSettings.provider).toBeNull();
expect(patch.modelSettings.model).toBeNull();
expect(patch.modelSettings.api_key).toBeNull();
```

Keep the existing configured-settings test so explicit providers still round-trip unchanged.

- [ ] **Step 2: Update the settings form test first**

In `app/src/__tests__/hooks/use-settings-form.test.ts`, add a test that renders `useSettingsForm()` after `useSettingsStore.getState().reset()` and asserts:

```ts
expect(result.current.modelSettings.provider).toBeNull();
expect(result.current.modelSettings.model).toBeNull();
expect(result.current.modelSettings.api_key).toBeNull();
```

- [ ] **Step 3: Run the hook tests and confirm the new assertions fail**

```bash
cd app && npx vitest run src/__tests__/hooks/use-app-startup.test.ts src/__tests__/hooks/use-settings-form.test.ts
```

Expected: failures showing provider currently resolves to `"anthropic"` when unset.

- [ ] **Step 4: Remove the implicit Anthropic defaults in production code**

Update `app/src/hooks/use-app-startup.ts`:

```ts
provider: s.model_settings?.provider ?? null,
```

Update `app/src/hooks/use-settings-form.ts`:

```ts
const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  provider: null,
  model: null,
  api_key: null,
  base_url: null,
  api_version: null,
  temperature: null,
  max_output_tokens: null,
  timeout_seconds: 300,
  num_retries: 5,
  reasoning_effort: "auto",
  extra_headers: null,
  input_cost_per_token: null,
  output_cost_per_token: null,
  usage_id: "workflow",
};
```

Leave explicit configured providers unchanged; only the unset path changes.

- [ ] **Step 5: Re-run the hook tests**

```bash
cd app && npx vitest run src/__tests__/hooks/use-app-startup.test.ts src/__tests__/hooks/use-settings-form.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Run TypeScript**

```bash
cd app && npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add app/src/hooks/use-app-startup.ts app/src/hooks/use-settings-form.ts app/src/__tests__/hooks/use-app-startup.test.ts app/src/__tests__/hooks/use-settings-form.test.ts
git commit -m "VU-1160: remove implicit anthropic settings defaults"
```

## Task 2: Remove stale `sdk_ready` init-stage usage from E2E helper infrastructure

**Files:**
- Modify: `app/e2e/helpers/agent-simulator.ts`

- [ ] **Step 1: Update the helper to the canonical stage name**

Replace every emitted `sdk_ready` payload in `app/e2e/helpers/agent-simulator.ts` with `runtime_ready`, including the surrounding comments/docstrings:

```ts
stage: "runtime_ready",
```

Docstrings should describe the init sequence as `init_start`, then `runtime_ready`.

- [ ] **Step 2: Confirm there are no `sdk_ready` references left in the helper**

```bash
rg -n "sdk_ready" app/e2e/helpers/agent-simulator.ts
```

Expected: no matches.

- [ ] **Step 3: Run the workflow-oriented unit coverage that consumes init progress stages**

```bash
cd app && npx vitest run src/__tests__/hooks/use-agent-stream.test.ts src/__tests__/components/agent-initializing-indicator.test.tsx
```

Expected: all tests pass.

- [ ] **Step 4: Run the targeted workflow E2E tag because `agent-simulator.ts` is shared E2E infrastructure**

```bash
cd app && npm run test:e2e -- --grep @workflow
```

Expected: workflow-tagged specs pass with no `sdk_ready`-stage failures.

- [ ] **Step 5: Commit**

```bash
git add app/e2e/helpers/agent-simulator.ts
git commit -m "VU-1160: replace sdk_ready with runtime_ready in e2e agent simulator"
```

## Task 3: Remove stale `runtimeProvider` from OpenHands event fixtures

**Files:**
- Modify: `app/src/__tests__/fixtures/openhands-events/gate-eval-insufficient.jsonl`
- Modify: `app/src/__tests__/fixtures/openhands-events/gate-eval-sufficient.jsonl`
- Modify: `app/src/__tests__/fixtures/openhands-events/research-with-errors.jsonl`

- [ ] **Step 1: Remove `runtimeProvider` from the fixture config blobs**

Delete the `"runtimeProvider":"openhands"` property from each fixture's top-level `config` object. Do not replace it with another field.

- [ ] **Step 2: Confirm fixture cleanup**

```bash
rg -n '"runtimeProvider"' app/src/__tests__/fixtures/openhands-events
```

Expected: no matches.

- [ ] **Step 3: Run the OpenHands fixture-based tests**

```bash
cd app && npx vitest run src/__tests__/lib/openhands-event-projection.fixtures.test.ts src/__tests__/lib/openhands-event-projection.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/__tests__/fixtures/openhands-events/gate-eval-insufficient.jsonl app/src/__tests__/fixtures/openhands-events/gate-eval-sufficient.jsonl app/src/__tests__/fixtures/openhands-events/research-with-errors.jsonl
git commit -m "VU-1160: remove runtimeProvider from openhands event fixtures"
```

## Task 4: Final validation and implementation handoff state

- [ ] **Step 1: Regenerate generated contracts to confirm no hidden drift**

```bash
cd app && npm run codegen
```

Expected: succeeds with no generated diffs, or only deterministic formatting diffs that match current contract state.

- [ ] **Step 2: Run changed-area validation**

```bash
cd app && npx tsc --noEmit
cd app && npm run test:unit
cd app && npm run test:integration
```

Expected: all pass.

- [ ] **Step 3: Run the focused Rust/codegen coverage for agent contracts**

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml contracts::agent_events
```

Expected: all pass.

- [ ] **Step 4: Grep for forbidden runtime-compat leftovers in the touched scope**

```bash
rg -n "sdk_ready|runtimeProvider" app/e2e/helpers app/src/__tests__/fixtures/openhands-events app/src/hooks
```

Expected: no matches.

- [ ] **Step 5: Create the final implementation commit**

```bash
git status --short
git add docs/plans/2026-05-05-plugin-folder-structure.md
git commit -m "docs: update VU-1160 runtime contract cleanup plan"
```

If code changes remain after validation, fold this plan-file addition into the final task commit instead of creating a docs-only tail commit.

## Review Gates

- Independent code review subagent
- Independent simplification review subagent
- Independent test-coverage review subagent
- Independent acceptance-criteria review subagent

## Remaining Risks To Check During Execution

- Some E2E helpers still hard-code Anthropic provider values for configured test scenarios; do not remove explicit provider fixtures unless they are acting as implicit defaults rather than test data.
- `agent-simulator.ts` is shared infrastructure; if the workflow-tagged E2E run exposes unrelated failures, capture exact failures before broadening the change.
- Linear is currently unavailable due to expired auth, so issue-status and implementation-note updates may need to be replayed once access is restored.

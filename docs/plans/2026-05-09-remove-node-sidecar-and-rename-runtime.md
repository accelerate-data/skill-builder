# Remove Node Sidecar And Rename Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `app/sidecar/` completely, re-home its remaining TypeScript contract ownership, and rename Rust/frontend/docs/runtime surfaces so the repo consistently reflects the Rust-managed OpenHands Agent Server architecture.

**Architecture:** Implement the change as one PR with three ordered layers. Layer 1 removes the packaged Node sidecar and all build/release/test plumbing. Layer 2 re-homes the surviving TypeScript contract surfaces so frontend code compiles without `app/sidecar/`. Layer 3 renames Rust/runtime/frontend/docs symbols away from `sidecar` to runtime-focused names so the codebase and docs no longer describe a Node sidecar architecture.

**Tech Stack:** Rust (Tauri backend), TypeScript/React frontend, Specta codegen, Vitest, cargo test, repo scripts, GitHub Actions metadata

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `app/sidecar/**` | Delete | Remove the dead Node sidecar package and its tests/artifacts |
| `app/package.json` | Modify | Remove sidecar install hooks and workspace assumptions |
| `app/src-tauri/tauri.conf.json` | Modify | Stop bundling `sidecar/dist` as a Tauri resource |
| `app/src-tauri/src/bin/codegen.rs` | Modify | Emit TS contracts only to frontend-owned paths |
| `app/src/lib/agent-events.ts` | Modify | Keep frontend event contract entrypoint with no sidecar sync assumptions |
| `app/src/lib/display-types.ts` | Modify | Make frontend-owned `DisplayItem` types canonical |
| `app/src/__tests__/lib/agent-events-sync.test.ts` | Modify | Remove `app/sidecar` sync expectations |
| `app/src/__tests__/lib/display-types-sync.test.ts` | Replace or remove | Stop comparing frontend render types to deleted sidecar files |
| `app/src-tauri/src/agents/mod.rs` | Modify | Rename module exports away from `sidecar` |
| `app/src-tauri/src/agents/sidecar.rs` | Rename | Re-home config builder under a runtime-focused module name |
| `app/src-tauri/src/agents/events.rs` | Modify | Re-export renamed runtime event handlers |
| `app/src-tauri/src/agents/event_router.rs` | Modify | Rename `handle_sidecar_*` APIs and sidecar-specific comments |
| `app/src-tauri/src/agents/event_types.rs` | Modify | Rename sidecar-specific structs/comments if they now represent runtime events |
| `app/src-tauri/src/agents/openhands_server/**` | Modify | Consume renamed runtime config and handler APIs |
| `app/src-tauri/src/commands/**` | Modify | Update imports/types/functions from `sidecar` to runtime names |
| `app/src-tauri/src/contracts/agent_events.rs` | Modify | Remove TypeScript-sidecar wording from contract docs |
| `app/src-tauri/src/types/mod.rs` | Modify | Update serde/config tests to renamed runtime config types |
| `app/tests/run.sh` | Modify | Remove sidecar dist bootstrap and sidecar Vitest execution |
| `.github/workflows/pr-ci.yml` | Modify | Remove sidecar install/test/stub steps |
| `.github/workflows/release.yml` | Modify | Stop staging sidecar artifacts |
| `scripts/ci/verify-release-stage.mjs` | Modify | Remove sidecar artifact expectations |
| `scripts/ci/verify-release-stage.test.mjs` | Modify | Align tests to new release artifact list |
| `scripts/worktree.sh` | Modify | Remove sidecar dist copy bootstrap |
| `repo-map.json` | Modify | Remove `app/sidecar` package references and rename runtime docs |
| `TEST_MAP.md` | Modify | Remove `app/sidecar` test routing and update runtime path names |
| `AGENTS.md` | Modify | Remove Node sidecar guidance and update runtime/testing text |
| `docs/design/backend-design/**` | Modify | Replace stale Node sidecar wording |
| `docs/design/openhands-runtime-model/**` | Modify | Align runtime docs to the post-sidecar architecture |
| `docs/plans/2026-05-09-remove-node-sidecar-and-rename-runtime.md` | Create | Execution checklist for the branch |

---

## Layer 1: Remove The Packaged Node Sidecar

### Task 1: Delete `app/sidecar` and remove app package hooks

**Files:**

- Delete: `app/sidecar/`
- Modify: `app/package.json`

- [x] **Step 1: Verify the package is only legacy plumbing**

Run:

```bash
rg -n "sidecar:install|app/sidecar|sidecar/dist" app/package.json app/src-tauri/tauri.conf.json .github/workflows scripts app/tests/run.sh repo-map.json TEST_MAP.md AGENTS.md
```

Expected: hits in package/build/test/docs metadata, not a live Node runtime entrypoint.

- [x] **Step 2: Remove sidecar install hooks from `app/package.json`**

Update the scripts block to remove:

```json
"sidecar:install": "cd sidecar && npm install",
"postinstall": "cd sidecar && npm install"
```

Keep all remaining frontend and OpenHands smoke scripts intact.

- [x] **Step 3: Delete `app/sidecar/` from the repo**

Delete the full directory, including:

```text
app/sidecar/__tests__/
app/sidecar/agent-events.ts
app/sidecar/config.ts
app/sidecar/display-types.ts
app/sidecar/dist/
app/sidecar/generated/
app/sidecar/package.json
app/sidecar/package-lock.json
app/sidecar/shutdown.ts
app/sidecar/tsconfig.json
app/sidecar/vitest.config.ts
```

- [x] **Step 4: Remove Tauri resource bundling of `sidecar/dist`**

Delete this resource mapping from `app/src-tauri/tauri.conf.json`:

```json
"../sidecar/dist/": "sidecar/dist"
```

- [x] **Step 5: Run focused validation for deleted package assumptions**

Run:

```bash
rg -n "app/sidecar|sidecar/dist|sidecar:install" app/package.json app/src-tauri/tauri.conf.json
```

Expected: no matches.

### Task 2: Remove sidecar CI, release, and worktree plumbing

**Files:**

- Modify: `.github/workflows/pr-ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/ci/verify-release-stage.mjs`
- Modify: `scripts/ci/verify-release-stage.test.mjs`
- Modify: `scripts/worktree.sh`
- Modify: `app/tests/run.sh`

- [x] **Step 1: Remove sidecar install/test/stub steps from CI**

Delete workflow steps that:

```text
- install dependencies in app/sidecar
- run tests from app/sidecar
- create app/sidecar/dist just to satisfy Tauri resource validation
```

Keep OpenHands, frontend, Rust, and repo-audit checks.

- [x] **Step 2: Remove sidecar artifacts from release staging**

Delete release-stage copy logic shaped like:

```bash
mkdir -p "$STAGE/sidecar/dist"
cp -R "app/sidecar/dist/." "$STAGE/sidecar/dist/"
```

Update release-stage verification fixtures so `sidecar/dist/*` is no longer required.

- [x] **Step 3: Remove worktree/bootstrap assumptions**

Delete the sidecar dist copy block from `scripts/worktree.sh` and the dist bootstrap from `app/tests/run.sh`.

- [x] **Step 4: Run metadata-only validation**

Run:

```bash
rg -n "app/sidecar|sidecar/dist" .github/workflows scripts/ci scripts/worktree.sh app/tests/run.sh
```

Expected: no active workflow/script references outside intentionally historical docs or fixtures.

---

## Layer 2: Re-home TypeScript Contract Ownership

### Task 3: Make frontend `AgentEvent` ownership independent of `app/sidecar`

**Files:**

- Modify: `app/src-tauri/src/bin/codegen.rs`
- Modify: `app/src/lib/agent-events.ts`
- Modify: `app/src/__tests__/lib/agent-events-sync.test.ts`

- [x] **Step 1: Stop writing generated contracts into the deleted sidecar path**

In `app/src-tauri/src/bin/codegen.rs`, remove the secondary output path:

```rust
let sidecar_path = project_root().join("sidecar/generated/contracts.ts");
write_with_dirs(&sidecar_path, &ts_output)?;
println!("  wrote {}", sidecar_path.display());
```

Keep the frontend output:

```rust
let frontend_path = project_root().join("src/generated/contracts.ts");
write_with_dirs(&frontend_path, &ts_output)?;
```

- [x] **Step 2: Simplify the sync test to frontend-only expectations**

Replace sidecar comparisons with assertions that:

```text
- app/src/lib/agent-events.ts re-exports from "@/generated/contracts"
- AGENT_EVENTS_VERSION still exists where expected
- no test requires app/sidecar/agent-events.ts
```

- [x] **Step 3: Regenerate contracts**

Run:

```bash
cd app && npm run codegen
```

Expected: `app/src/generated/contracts.ts` updates if needed, with no `sidecar/generated/contracts.ts` output.

### Task 4: Make `app/src/lib/display-types.ts` canonical

**Files:**

- Modify: `app/src/lib/display-types.ts`
- Modify or delete: `app/src/__tests__/lib/display-types-sync.test.ts`

- [x] **Step 1: Rewrite the file header to reflect canonical frontend ownership**

Replace the “mirror of sidecar types” wording with a header shaped like:

```ts
/**
 * Canonical frontend DisplayItem type definitions for rendering OpenHands output.
 * READ-ONLY except when intentionally changing the UI contract consumed by the app.
 */
```

- [x] **Step 2: Remove the deleted-file sync test**

Choose one of:

```text
- delete app/src/__tests__/lib/display-types-sync.test.ts entirely, or
- rewrite it to validate local invariants within app/src/lib/display-types.ts only
```

Preferred: delete it unless there is a meaningful non-duplicative invariant left.

- [x] **Step 3: Verify no frontend code imports from `app/sidecar`**

Run:

```bash
rg -n "sidecar/(agent-events|display-types|generated/contracts)" app/src app/src-tauri
```

Expected: no imports or file-path references to deleted sidecar TS sources.

---

## Layer 3: Rename Rust And Runtime Surfaces

### Task 5: Rename the runtime config module and core config type

**Files:**

- Rename: `app/src-tauri/src/agents/sidecar.rs`
- Modify: `app/src-tauri/src/agents/mod.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/types.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/client.rs`
- Modify: `app/src-tauri/src/commands/api_validation.rs`
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `app/src-tauri/src/commands/skill/scope_review.rs`
- Modify: `app/src-tauri/src/commands/skill_session.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/types/mod.rs`

- [x] **Step 1: Rename the module and the primary config type**

Use a runtime-accurate naming set such as:

```text
agents/sidecar.rs -> agents/runtime_config.rs
SidecarConfig -> OpenHandsRuntimeConfig
OpenHandsRuntimeConfigParams -> BuildOpenHandsRuntimeConfigParams
```

Keep field names stable unless they are themselves misleading.

- [x] **Step 2: Update imports and helper names everywhere**

Convert imports shaped like:

```rust
use crate::agents::sidecar::{OpenHandsRuntimeConfigParams, OpenHandsRuntimeMode, SidecarConfig};
```

to the renamed runtime module and types.

- [x] **Step 3: Rename config-focused tests**

Rename tests such as:

```text
test_sidecar_config_serialization
test_sidecar_config_serde
```

to runtime-focused equivalents so grep no longer suggests a Node sidecar config.

- [x] **Step 4: Verify compile-time references are clean**

Run:

```bash
rg -n "crate::agents::sidecar|SidecarConfig|test_sidecar_config|mod sidecar" app/src-tauri/src
```

Expected: no matches.

### Task 6: Rename runtime event handlers and sidecar-shaped runtime types

**Files:**

- Modify: `app/src-tauri/src/agents/events.rs`
- Modify: `app/src-tauri/src/agents/event_router.rs`
- Modify: `app/src-tauri/src/agents/event_types.rs`
- Modify: `app/src-tauri/src/contracts/agent_events.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`

- [x] **Step 1: Rename event router APIs**

Convert function names shaped like:

```rust
handle_sidecar_message
handle_sidecar_exit
handle_sidecar_exit_with_detail
```

to runtime-accurate names such as:

```rust
handle_runtime_message
handle_runtime_exit
handle_runtime_exit_with_detail
```

- [x] **Step 2: Rename sidecar-specific structs/comments where they now represent runtime traffic**

Examples to evaluate and rename if appropriate:

```text
SidecarModelUsageEntry
SidecarRunSummary
AgentInitError docs mentioning sidecar startup
contract comments that say these mirror app/sidecar/*.ts
```

- [x] **Step 3: Preserve protocol semantics while changing labels**

Do not change serialized event names like `agent_event` or `display_item` unless a real protocol migration is intended. This task is about internal naming clarity, not wire-format churn.

- [x] **Step 4: Verify no active Rust event code still describes a Node sidecar**

Run:

```bash
rg -n "sidecar" app/src-tauri/src/agents app/src-tauri/src/contracts app/src-tauri/src/commands
```

Expected: only intentional historical comments or explicitly deferred strings remain.

---

## Repo Metadata And Documentation Cleanup

### Task 7: Update repo guidance, maps, and docs to the post-sidecar architecture

**Files:**

- Modify: `AGENTS.md`
- Modify: `repo-map.json`
- Modify: `TEST_MAP.md`
- Modify: `docs/design/backend-design/README.md`
- Modify: `docs/design/backend-design/agent-event-contracts.md`
- Modify: `docs/design/openhands-runtime-model/README.md`
- Modify: `docs/design/openhands-runtime-model/tools-included.md`
- Modify: other touched docs returned by repo grep

- [x] **Step 1: Remove repo guidance that claims a Node sidecar runtime**

Update AGENTS, repo-map, and TEST_MAP so they:

```text
- stop describing the app as orchestrating agents via a Node.js sidecar
- remove app/sidecar test routing and workspace/package metadata
- describe the Rust-managed OpenHands Agent Server as the runtime
```

- [x] **Step 2: Update backend/runtime docs**

Replace stale wording like:

```text
Node.js sidecar
sidecar startup
sidecar config
mirrors app/sidecar/agent-events.ts
```

with runtime/OpenHands terminology consistent with the renamed Rust code.

- [x] **Step 3: Re-run repo metadata audits**

Run:

```bash
cd app && npm run test:repo-map
bash app/tests/test-map-scenarios.sh
```

Expected: metadata/tests reflect the new structure with no stale sidecar inventory.

---

## Verification

### Task 8: Run targeted end-to-end verification for the single-PR cleanup

**Files:**

- Validate all modified files from Tasks 1-7

- [x] **Step 1: Run frontend unit/integration tests**

Run:

```bash
cd app && npm run test:unit
```

Expected: pass.

- [x] **Step 2: Run agent structural tests**

Run:

```bash
cd app && npm run test:agents:structural
```

Expected: pass.

- [x] **Step 3: Run Rust tests**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml
```

Expected: pass.

- [x] **Step 4: Run TypeScript compile check**

Run:

```bash
cd app && npx tsc --noEmit
```

Expected: pass.

- [x] **Step 5: Run release-stage verification tests**

Run:

```bash
node --test scripts/ci/verify-release-stage.test.mjs
```

Expected: pass with no `sidecar/dist` expectations.

- [x] **Step 6: Run markdown/doc lint on touched docs**

Run:

```bash
markdownlint docs/design/openhands-runtime-model/remove-node-sidecar.md docs/plans/2026-05-09-remove-node-sidecar-and-rename-runtime.md AGENTS.md TEST_MAP.md
```

Expected: pass.

## Manual Checks

- [ ] Start the app with `cd app && npm run dev` and confirm Tauri no longer requires `app/sidecar/dist` to exist.
- [ ] Trigger a workflow run and confirm agent events still render in the UI.
- [ ] Trigger a refine run and confirm display items still render correctly.
- [ ] Trigger an eval/workbench path that uses the OpenHands runtime and confirm renamed Rust config/event code still works.
- [x] Build confidence that no active script, workflow, or repo doc claims the app ships a Node sidecar.

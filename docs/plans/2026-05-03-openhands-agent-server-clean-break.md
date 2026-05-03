# OpenHands Agent Server Clean-Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** VU-1153

**Goal:** Replace the Node/Python OpenHands runner path with a Rust-managed local OpenHands Agent Server using REST and WebSockets.

**Architecture:** Rust starts one local Agent Server process per app instance on a random localhost port, owns workspace folders on disk, binds those folders into Agent Server conversations, streams server events into the current `conversation_event` and terminal `conversation_state` app semantics, and deletes the old Node/stdout runtime path after replacement tests pass.

**Tech Stack:** Tauri v2, Rust, Tokio, reqwest, tokio-tungstenite or the repo's chosen WebSocket client, OpenHands Agent Server, cargo test, Vitest where frontend contracts are affected, Playwright workflow/refine mocks, Promptfoo/OpenCode eval smoke.

---

## Source Context

- Design: `docs/design/openhands-agent-server-runtime/README.md`
- Current umbrella design: `docs/design/openhands-native-migration/README.md`
- Superseded runner design: `docs/design/openhands-sdk-runner/README.md`
- Workspace path source: `app/plugin-paths.json`
- Workspace helpers: `app/src-tauri/src/skill_paths.rs`
- Current OpenHands Rust boundary: `app/src-tauri/src/agents/sidecar.rs`
- Current Node sidecar pool: `app/src-tauri/src/agents/sidecar_pool/`
- Current Python runner: `app/sidecar/openhands/runner.py`

## Execution Rules

- [ ] Start from the current VU-1145 accumulation branch:
  `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`.
- [ ] Create a child branch/worktree for this clean-break slice from VU-1145,
  for example:
  `feature/vu-1153-replace-openhands-runner-with-rust-managed-agent-server`.
- [ ] Raise the VU-1153 PR against
  `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`, not
  against `main`.
- [ ] Merge VU-1153 back into VU-1145 only after the deterministic tests and
  the gated local Agent Server smoke pass.
- [ ] Replace tests before deleting the old runtime implementation.
- [ ] Do not keep a production fallback to Node, the Python runner, or stdout JSONL.
- [ ] Verify the pinned Agent Server package's actual OpenAPI/routes before implementing production REST calls.
- [ ] Keep Rust as the owner of workspace folder creation, `.agents/**` deployment, app logs, cancellation, and terminal task results.
- [ ] Commit after each passing slice.

## Phase 1: Pin And Inspect Agent Server

**Files:**

- Modify: `app/src-tauri/Cargo.toml`
- Modify: `app/src-tauri/Cargo.lock`
- Modify or create: packaging/runtime dependency files selected by the implementation
- Create: `docs/references/openhands-agent-server-api.md`

- [ ] **Step 1: Choose the local server distribution**

Verify whether the branch will bundle `openhands-agent-server` as a Python
runtime, a standalone executable, or another supported package shape. Record the
decision in `docs/references/openhands-agent-server-api.md`.

- [ ] **Step 2: Capture the actual API surface**

Run the pinned server locally, fetch its OpenAPI schema or route list, and
record the exact endpoints for health, workspace binding, conversation create,
message send, run, pause/cancel, close/delete, and WebSocket events.

- [ ] **Step 3: Decide local auth behavior from the pinned version**

If API-key auth is supported locally, document the startup flag/env var and
expected `Authorization: Bearer <token>` behavior. If not supported, document
that security for VU-1153 is loopback binding plus app-owned process lifecycle.

- [ ] **Step 4: Add dependency validation test coverage**

Replace tests and fixtures that assert `openhands_runner` availability with
tests that assert the Agent Server executable/package can be resolved.

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::node
```

Expected: dependency validation tests pass for the new Agent Server runtime
contract and no longer require `openhands_runner`.

## Phase 2: Add Rust Agent Server Contracts First

**Files:**

- Create: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Create: `app/src-tauri/src/agents/openhands_server/process.rs`
- Create: `app/src-tauri/src/agents/openhands_server/client.rs`
- Create: `app/src-tauri/src/agents/openhands_server/events.rs`
- Create: `app/src-tauri/src/agents/openhands_server/types.rs`
- Modify: `app/src-tauri/src/agents/mod.rs`

- [ ] **Step 1: Write process-manager tests**

Cover random port selection, health wait, startup timeout, port retry, stderr
redaction, and shutdown using a fake command/server.

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml agents::openhands_server::process
```

Expected: tests fail until the process manager exists, then pass without a real
OpenHands server.

- [ ] **Step 2: Write REST client serialization tests**

Use a mock HTTP server to assert that Rust sends the expected workspace binding
and conversation request. The workflow-step request must bind
`workspace_skill_dir` as the OpenHands local workspace working directory. Scope
review must bind the initialized workspace root.

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml agents::openhands_server::client
```

Expected: tests pass against mocked HTTP and do not spawn OpenHands.

- [ ] **Step 3: Write WebSocket event adapter tests**

Feed representative Agent Server event JSON into the adapter and assert the
app-visible output:

- progress/activity becomes `conversation_event`;
- terminal success becomes `conversation_state(status = "completed")`;
- terminal failure becomes `conversation_state(status = "error")`;
- cancellation becomes `conversation_state(status = "cancelled")`;
- raw payload is preserved.

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml agents::openhands_server::events
```

Expected: event adapter tests pass without a real server.

- [ ] **Step 4: Add one-shot runtime facade tests**

Introduce a Rust facade that workflow/scope-review callers use instead of the
sidecar runner. Test that it binds workspace, creates conversation, sends one
message, starts the run, streams events, waits for terminal state, and closes
the conversation.

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml agents::openhands_server
```

Expected: contract tests pass with fake process/client implementations.

## Phase 3: Rewire Product Call Sites

**Files:**

- Modify: `app/src-tauri/src/commands/skill/scope_review.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/commands/workflow/step_config.rs`
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`
- Modify: `app/src-tauri/src/commands/workflow/deploy.rs` only if deployment preconditions need tightening

- [ ] **Step 1: Rewire scope review to the Rust Agent Server facade**

Keep the current advisory product behavior. Change only the runtime transport.
Tests should assert that scope review uses the initialized workspace root and
parses terminal `conversation_state.result_text`.

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill::scope_review
```

Expected: scope-review tests pass without the old sidecar/runner config.

- [ ] **Step 2: Rewire workflow one-shot execution**

Route OpenHands workflow steps through the Rust Agent Server facade. Preserve
existing prompt rendering, `.agents/**` deployment, terminal JSON extraction,
and materialization behavior.

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
```

Expected: workflow tests pass and no workflow test asserts
`path_to_openhands_runner` or Node sidecar routing.

- [ ] **Step 3: Preserve frontend event behavior**

If event field names change at the Tauri boundary, update frontend tests and
fixtures. Prefer no frontend contract churn: keep `conversation_event` and
terminal `conversation_state`.

Run:

```bash
cd app && npm run test:unit
```

Expected: affected frontend unit tests pass.

## Phase 4: Delete Old Runtime Path

**Files:**

- Delete: `app/sidecar/runtime/openhands-runtime.ts`
- Delete: `app/sidecar/openhands/runner.py`
- Delete: `app/sidecar/openhands/build.sh`
- Delete or update: OpenHands-specific tests under `app/sidecar/__tests__/`
- Modify: `app/sidecar/package.json`
- Modify: `app/sidecar/package-lock.json`
- Modify: `app/src-tauri/src/agents/sidecar.rs`
- Modify: `app/src-tauri/src/agents/sidecar_pool/`
- Modify: `app/src-tauri/src/commands/sidecar_lifecycle.rs`
- Modify: `app/src-tauri/tauri.conf.json` if bundled resources change
- Modify: `repo-map.json`
- Modify: `TEST_MAP.md`

- [ ] **Step 1: Delete Python runner and packaging**

Remove the runner, PyInstaller build path, staged `openhands-runner` resource
resolution, and dependency validation tied to that binary.

- [ ] **Step 2: Delete Node OpenHands runtime routing**

Remove OpenHands routing from persistent Node sidecar code. If no remaining
runtime uses Node, delete the Node sidecar process boundary entirely in this
branch. If a non-OpenHands feature still compiles through Node temporarily,
document the remaining owner and leave no OpenHands fallback.

- [ ] **Step 3: Replace sidecar tests with Rust tests**

Remove sidecar tests that only prove stdin/stdout runner behavior. Keep or move
tests that still validate app-owned prompt, event, or artifact contracts.

- [ ] **Step 4: Update repo maps and test maps**

Make `repo-map.json` and `TEST_MAP.md` reflect the deleted files, new Rust
runtime module, and new validation commands.

Run:

```bash
cd app && npm run test:agents:structural
cargo test --manifest-path app/src-tauri/Cargo.toml
```

Expected: structural and Rust suites pass without the deleted runtime files.

## Phase 5: Live Local Server Smoke

**Files:**

- Create or modify: smallest live Agent Server smoke test location selected by implementation
- Modify: `TEST_MAP.md`

- [ ] **Step 1: Add a gated live smoke**

Add one automated smoke that starts the local Agent Server, runs a small
one-shot conversation in a temporary workspace, verifies progress events arrive
before terminal state, and verifies cleanup. Gate it behind the same live-runtime
conditions used by other OpenHands/OpenCode smoke checks.

- [ ] **Step 2: Run deterministic automation**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml
cd app && npm run test:agents:structural
cd app && npm run test:unit
cd tests/evals && npm test
```

Expected: all deterministic suites pass.

- [ ] **Step 3: Run live smoke**

Run the new local Agent Server smoke and the smallest affected live agent smoke.
Use the exact command added to `TEST_MAP.md`.

Expected: Agent Server starts on a random local port, at least one progress
event streams, terminal state is received, and the process shuts down cleanly.

## Phase 6: Final Readiness

**Files:**

- Modify: `docs/design/openhands-native-migration/README.md`
- Modify: `docs/design/openhands-sdk-runner/README.md`
- Modify: `docs/design/README.md`
- Modify: `README.md` if user-facing setup/dependency requirements changed
- Modify: `AGENTS.md` only if a durable non-obvious repo memory emerges

- [ ] **Step 1: Remove stale runner references**

Update docs that still describe PyInstaller runner or Node OpenHands routing as
the target runtime. Keep historical pointers only when clearly marked
superseded.

- [ ] **Step 2: Audit repository metadata**

Verify `repo-map.json` reflects added, removed, and renamed runtime files.
Verify `TEST_MAP.md` reflects the new test commands and no longer requires
`cd app/sidecar && npx vitest run` for deleted OpenHands runtime code.

- [ ] **Step 3: Commit and push**

Run:

```bash
git status --short
git add docs/design/openhands-agent-server-runtime/README.md docs/plans/2026-05-03-openhands-agent-server-clean-break.md docs/design/README.md docs/design/openhands-native-migration/README.md docs/design/openhands-sdk-runner/README.md
git commit -m "docs: design OpenHands agent server runtime"
git push
```

Expected: the VU-1153 branch is pushed and the PR is ready to open against
`feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`.

# VU-1145 Dead Code Cleanup Plan

**Goal:** Remove every vestige of the Claude Agent SDK runtime from the
`vu-1145-implement-openhands-native-clean-break-agent-runtime` branch so the
branch ships with OpenHands as the only agent runtime.

**Status (as of 2026-05-04):** The large structural removals are done. Five targeted tasks remain, all with explicit file lists from the audit.

---

## What Is Already Done

The following were verified directly from the branch code:

- **Node sidecar Claude runtime files deleted:** `options.ts`,
  `runtime/claude-runtime.ts`, `runtime/sink.ts`, `runtime/types.ts`,
  `stream-session.ts`, `run-agent.ts`, `result-gate.ts`,
  `openhands-rejection.ts` — all gone.
- **`@anthropic-ai/claude-agent-sdk` removed** from `app/sidecar/package.json`
  (`dependencies: {}`).
- **Rust `sidecar_pool` deleted** — `sidecar_pool/` no longer exists in
  `app/src-tauri/src/agents/`.
- **`start_agent` command gone** — not in any Rust command file.
- **`step_id > 3` sidecar fallback removed** — `runtime.rs` step dispatch
  only handles 0–3, returns error otherwise.
- **Legacy settings fields removed** — `anthropic_api_key`, `preferred_model`,
  `fallback_model`, `extended_thinking`, `interleaved_thinking_beta`,
  `sdk_effort`, `openhands_provider`, `openhands_api_key`, `openhands_model`,
  `openhands_base_url` are absent from Rust settings structs and DB. DB tests
  confirm they are silently dropped on old data.
- **`api_validation.rs` migrated** — uses `test_model_connection`, no
  Anthropic-specific HTTP call.
- **`agent-sources/claude/` deleted** — directory is gone.
- **`agent-sources/plugins/skill-content-researcher/.claude-plugin/` deleted.**
- **Sidecar Claude test files deleted:** `options.test.ts`,
  `message-processor.test.ts`, `run-agent.test.ts`,
  `run-metadata-accumulator.test.ts`, `persistent-mode.test.ts`,
  `runtime-types.test.ts`, `runtime-sink.test.ts`, `result-gate.test.ts`,
  `message-classifier.test.ts` — all gone.
- **GHA workflows** — no Claude binary bundling, no sidecar Claude build/test
  steps.
- **`tauri.conf.json`** — no reference to `agent-sources/claude/` or a bundled
  Claude binary.
- **`permissionMode` / `requiredPlugins` on `SidecarConfig`** — retained with
  `skip_serializing_if = "Option::is_none"`; a guard test in
  `workflow/tests.rs` asserts these fields do NOT appear in workflow configs.
  These fields serve non-workflow paths (scope review) and are not dead.
- **Workspace scratch dir cleanup** (VU-1157 aftermath + dead `logs/` chain)
  — done. `create_openhands_persistence_dir` deleted, `transcript_log_dir`
  removed from `SidecarConfig`, stale JSON artifacts cleaned up on startup,
  `context/` no longer created on new skills.
- **DB consistency reset** — done. `reconcile_skill_builder` resets skills with
  `current_step > 0` but no DB artifact rows to step 0 on startup.

---

## Remaining Work

### 1. Sidecar Mock-Agent Chain

The mock-agent chain is the only consumer of the Node.js sidecar build. The
production OpenHands runtime communicates directly with the Python
`openhands-agent-server` binary via HTTP/WebSocket — no Node.js process
involved. The startup health check that verifies `agent-runner.js` and the
integration E2E tests that spawn it are both mock-only paths.

#### 1a. Sidecar TypeScript source files — delete

| File | Why dead |
|---|---|
| `app/sidecar/mock-agent.ts` | Mock sidecar entry point; MOCK_AGENTS path only |
| `app/sidecar/agent-runner.ts` | Sidecar entry point; spawned only by sidecar-bridge.ts and build.js |
| `app/sidecar/persistent-mode.ts` | JSONL request loop; only used by agent-runner.ts |
| `app/sidecar/message-processor.ts` | Only used by mock-agent.ts |
| `app/sidecar/message-classifier.ts` | Only used by message-processor.ts |
| `app/sidecar/run-metadata-accumulator.ts` | Only used by message-processor.ts |
| `app/sidecar/tool-summaries.ts` | Only used by message-processor.ts |
| `app/sidecar/bootstrap.js` | Source of `dist/bootstrap.js`; wraps agent-runner.js |
| `app/sidecar/__tests__/mock-agent.test.ts` | Tests the deleted mock-agent |
| `app/sidecar/__tests__/tool-summaries.test.ts` | Tests the deleted tool-summaries |
| `app/sidecar/mock-templates/` | MOCK_AGENTS replay files; not used by OpenHands path |

#### 1b. Sidecar build script — simplify or delete

`app/sidecar/build.js` currently does three things: builds `agent-runner.ts`,
copies `bootstrap.js`, and copies `mock-templates/`. After 1a, none of those
steps exist. The only survivor is writing `dist/package.json` (ESM module marker).
Options:
- Keep a minimal `build.js` that only writes `dist/package.json`, or
- Delete `build.js` and `sidecar:build` script from `app/package.json` entirely
  (if `dist/package.json` is no longer needed because no `.js` files live in
  `dist/` that Node.js needs to interpret as ESM).

Verify whether `dist/openhands/openhands-runner` or `dist/sdk/claude` (native
prebuilt binaries, not built by build.js) need an ESM package.json sibling —
these binaries don't. If no `.js` files remain in `dist/`, delete `build.js`.

#### 1c. Rust startup health check — remove `agent_sidecar_bundle` check

`app/src-tauri/src/commands/node.rs` (around line 100–111): the
`agent_sidecar_bundle` dependency check calls
`sidecar_path::resolve_sidecar_path_public` to verify `bootstrap.js` /
`agent-runner.js` exists. After deletion, this check will always fail. Remove:
- The `agent_sidecar_bundle` `DepStatus` push from `check_startup_deps`
- The `sidecar_path` import if it becomes unused
- `app/src-tauri/src/agents/sidecar_path.rs` if `resolve_sidecar_path_public`
  has no remaining callers (verify with grep before deleting)

#### 1d. Dead Rust startup-error types — delete

`app/src-tauri/src/agents/startup_error.rs` defines `SidecarStartupError` (a
legacy type from when the Node.js sidecar could fail to start). The only
consumer is `event_router.rs::emit_init_error`, which is defined but never
called. Delete:
- `app/src-tauri/src/agents/startup_error.rs`
- `emit_init_error` function from `app/src-tauri/src/agents/event_router.rs`
- The `startup_error` module from `app/src-tauri/src/agents/mod.rs`

#### 1e. E2E integration tests — delete the sidecar-bridge suite

`app/e2e/helpers/sidecar-bridge.ts` spawns `dist/agent-runner.js --persistent`.
All tests that use it are mock-sidecar-specific:

| File | Action |
|---|---|
| `app/e2e/helpers/sidecar-bridge.ts` | Delete |
| `app/e2e/integration/workflow-integration.spec.ts` | Delete (entire suite; tests mock sidecar streaming) |

#### 1f. String cleanup in surviving files

Two surviving files reference `agent-runner.js` in string literals only:

| File | Line | Change |
|---|---|---|
| `app/e2e/setup/startup-error.spec.ts` | ~49 | Remove or update the `fixHint` that says `"Check that the sidecar bundle exists at sidecar/dist/agent-runner.js"` |
| `app/src/test/mocks/tauri-e2e.ts` | ~97 | Remove the `agent_sidecar_bundle` mock entry from the `check_startup_deps` mock response |

**Validation gate resolved:** `grep -r "persistent-mode\|mock-agent\|agent-runner" app/sidecar/` returns no matches.

### 2. `@anthropic-ai/sdk` in `app/package.json`

**Audit result:** All production imports of `@anthropic-ai/sdk` in `app/src/`
and `app/sidecar/` were tied to the Claude SDK runtime which is already deleted.
No remaining production code imports from it.

**Action:** Remove `"@anthropic-ai/sdk": ">=0.91.1"` from `app/package.json`
`dependencies`. Run `npm install` in `app/` to update `package-lock.json`.

Verify with: `grep -r "@anthropic-ai/sdk" app/src/ app/sidecar/` returns no matches.

### 3. `agent-sources/plugins/` Cleanup

#### 3a. `skill-content-researcher` plugin — delete entirely

The entire plugin body is dead. `agents/research-agent.md` is only referenced
in a stale structural test (`app/src-tauri/src/commands/workflow/tests.rs` around
the "agent file list" assertion). The shared schemas duplicate
`agent-sources/workspace/skills/shared/` which IS deployed. The `skills/research/`
tree is not deployed by `deploy.rs`.

**Files/dirs to delete (relative to repo root):**

```
agent-sources/plugins/skill-content-researcher/agents/research-agent.md
agent-sources/plugins/skill-content-researcher/shared/
agent-sources/plugins/skill-content-researcher/skills/
```

**Test update required:** In `app/src-tauri/src/commands/workflow/tests.rs`,
remove the assertion that `research-agent.md` exists in the bundled plugin list
(the guard test that names agent files from the skill-content-researcher plugin).

#### 3b. `skill-creator` plugin — delete dead agent files

`grader.md` and `rewrite-skill.md` are not referenced by any Rust runtime code
or OpenHands dispatch path. The user confirmed neither is used.

**Files to delete:**

```
agent-sources/plugins/skill-creator/agents/grader.md
agent-sources/plugins/skill-creator/agents/rewrite-skill.md
```

#### 3c. `skill-creator` plugin — delete bundled-but-unread subtrees

`scripts/` and `skills/skill-creator/` inside the skill-creator plugin are
bundled via `tauri.conf.json` but no Rust path reads from them at runtime
(deploy.rs reads `agent-sources/skills/`, not `plugins/.../skills/`).

**Action:** Confirm with `grep -r "skill-creator/scripts\|plugins/skill-creator/skills" app/src-tauri/` — if no matches, delete:

```
agent-sources/plugins/skill-creator/scripts/
agent-sources/plugins/skill-creator/skills/
```

### 4. `agent-sources/prompts/` Cleanup

**Audit result:** All prompt files are actively included via `include_str!` in
Rust, **except one:**

| File | Status |
|---|---|
| `eval-generator-system-prompt.txt` | Dead — no `include_str!` or runtime reference |
| All others | Active via `include_str!` — keep |

**Action:** Delete `agent-sources/prompts/eval-generator-system-prompt.txt`.

Verify with: `grep -r "eval-generator-system-prompt" app/src-tauri/` returns no matches.

### 5. Repo Map, Docs, and TEST_MAP

`repo-map.json`, `TEST_MAP.md`, and design docs under `docs/design/` still
describe the mixed Claude/OpenHands runtime and old plugin-hosted workflow agents.

**Update `repo-map.json`:**
- Remove any mention of `sidecar_pool`, `claude-runtime`, `mock-agent`,
  `agent-runner`, `persistent-mode`, and the deleted sidecar files.
- Remove `skill-content-researcher` agent listing from plugin descriptions.
- Remove `grader.md` and `rewrite-skill.md` from skill-creator agent listings.

**Update `TEST_MAP.md`:**
- Remove test entries for deleted sidecar files (`mock-agent.test.ts`,
  `tool-summaries.test.ts`, and any other removed test files).
- Remove any E2E tag that was specific to mock-agent E2E flows.

**Update `docs/design/`:**
- Files that describe the dual Claude/OpenHands runtime dispatch should be
  updated or marked superseded. Focus on `agent-specs/` and `runtime/`
  subdirectories if they exist.

---

## Validation Gates

Before marking cleanup complete:

- `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings` passes.
- `cd app && npx tsc --noEmit` passes.
- `cd app && npm run test:unit` passes.
- `cd app && npm run test:agents:structural` passes.
- `grep -r "claude-agent-sdk\|pathToClaudeCodeExecutable\|ClaudeRuntime\|SidecarPool" app/sidecar/ app/src-tauri/src/` returns no production-code matches.
- `grep -r "persistent-mode\|mock-agent\|agent-runner" app/sidecar/` returns no matches.
- `grep -r "@anthropic-ai/sdk" app/src/ app/sidecar/` returns no matches.
- `tauri.conf.json` contains no reference to `agent-sources/claude/` or a bundled Claude binary.

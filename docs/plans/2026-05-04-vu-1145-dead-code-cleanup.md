# VU-1145 Dead Code Cleanup Plan

**Goal:** Remove every vestige of the Claude Agent SDK runtime from the
`vu-1145-implement-openhands-native-clean-break-agent-runtime` branch so the
branch ships with OpenHands as the only agent runtime.

**Status (as of 2026-05-04):** The large structural removals are done. A small
audit-and-decide tail remains.

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

The following files are still present because `mock-agent.ts` (kept for
OpenHands E2E testing) depends on them:

| File | Kept because |
|---|---|
| `app/sidecar/agent-runner.ts` | Sidecar entrypoint |
| `app/sidecar/persistent-mode.ts` | JSONL request loop used by entrypoint |
| `app/sidecar/message-processor.ts` | Used by `mock-agent.ts` |
| `app/sidecar/message-classifier.ts` | Used by `message-processor.ts` |
| `app/sidecar/run-metadata-accumulator.ts` | Used by `message-processor.ts` |
| `app/sidecar/tool-summaries.ts` | Used by `message-processor.ts` |

**Decision needed:** If the mock agent is still required for E2E/smoke tests,
keep the chain. If E2E tests have been migrated off the mock agent, delete the
whole chain and `mock-agent.ts`. Check `app/sidecar/__tests__/mock-agent.test.ts`
and any E2E test that references `runMockAgent`.

The validation gate grep `persistent-mode|stream-session` will fire on the
surviving `persistent-mode.ts` until this is resolved.

### 2. `@anthropic-ai/sdk` in `app/package.json`

`app/package.json` still lists `"@anthropic-ai/sdk": ">=0.91.1"`. Audit
whether any non-Claude-SDK production code still imports from it. If it is only
used for TypeScript types that are now covered by the OpenHands contracts,
remove it.

### 3. `agent-sources/plugins/skill-creator/agents/grader.md` and `rewrite-skill.md`

These files still exist. Determine whether they are consumed by the OpenHands
skill-creator runtime or only by the old Claude SDK eval/refine path. Delete
if only the latter.

### 4. Dead `agent-sources/prompts/` files

`refine-followup.txt`, `refine-initial.txt`, `workflow-step.txt`, and
`skill-suggestions.txt` exist in `agent-sources/prompts/`. Audit whether any
Rust command still reads these files at runtime. Delete the ones that are only
read by dead code paths.

### 5. Repo Map, Docs, and TEST_MAP

`repo-map.json`, `TEST_MAP.md`, and design docs under `docs/design/` likely
still describe the mixed Claude/OpenHands runtime and old plugin-hosted workflow
agents. Update to match the current clean-break state.

---

## Validation Gates

Before marking cleanup complete:

- `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings` passes.
- `cd app && npx tsc --noEmit` passes.
- `cd app && npm run test:unit` passes.
- `cd app && npm run test:agents:structural` passes.
- `grep -r "claude-agent-sdk\|pathToClaudeCodeExecutable\|ClaudeRuntime\|SidecarPool" app/sidecar/ app/src-tauri/src/` returns no production-code matches.
- `tauri.conf.json` contains no reference to `agent-sources/claude/` or a bundled Claude binary.

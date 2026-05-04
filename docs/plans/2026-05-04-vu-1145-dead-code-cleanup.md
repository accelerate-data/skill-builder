# VU-1145 Dead Code Cleanup Plan

**Goal:** Remove every vestige of the Claude Agent SDK runtime from the
`vu-1145-implement-openhands-native-clean-break-agent-runtime` branch so the
branch ships with OpenHands as the only agent runtime.

**Status (as of 2026-05-04):** All cleanup complete. Branch ships with OpenHands as the only agent runtime.

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

## Phase 2 — Completed (2026-05-04)

The following five tasks were implemented, reviewed (spec + code quality), and
all validation gates verified passing.

- **Mock-agent sidecar chain deleted** — `agent-runner.ts`, `mock-agent.ts`,
  `persistent-mode.ts`, `message-processor.ts`, `message-classifier.ts`,
  `run-metadata-accumulator.ts`, `tool-summaries.ts`, `bootstrap.js`,
  `mock-templates/`, and `build.js` removed. E2E sidecar-bridge suite deleted.
  Rust `startup_error.rs`, `sidecar_path.rs`, and `agent_sidecar_bundle` health
  check removed. `sidecar:build` script removed from `app/package.json`.
- **`@anthropic-ai/sdk` override removed** from `app/package.json`.
- **`agent-sources/plugins/` deleted entirely** — `skill-content-researcher`
  plugin (agents, shared, skills), `skill-creator` eval content (grader.md,
  rewrite-skill.md, scripts/, skills/). `agent-sources/plugins/` bundle entry
  removed from `tauri.conf.json`. `agent-structure.test.ts` updated.
- **`eval-generator-system-prompt.txt` deleted** — only dead prompt file.
- **`repo-map.json` and `TEST_MAP.md` updated** — sidecar, plugin, and
  deleted-test references removed.

---

## Validation Gates — All Pass

- `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings` ✅
- `cd app && npx tsc --noEmit` ✅
- `cd app && npm run test:unit` ✅ (612 tests)
- `cd app && npm run test:agents:structural` ✅ (20 tests)
- `grep -r "claude-agent-sdk\|pathToClaudeCodeExecutable\|ClaudeRuntime\|SidecarPool" app/sidecar/ app/src-tauri/src/` — no production-code matches ✅
- `grep -r "persistent-mode\|mock-agent\|agent-runner" app/sidecar/` — no matches ✅
- `grep -r "@anthropic-ai/sdk" app/src/ app/sidecar/` — no matches ✅
- `tauri.conf.json` — no reference to `agent-sources/claude/` or bundled Claude binary ✅

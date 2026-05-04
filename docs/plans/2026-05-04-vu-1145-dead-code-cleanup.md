# VU-1145 Dead Code Cleanup Plan

**Goal:** Remove every vestige of the Claude Agent SDK runtime from the
`vu-1145-implement-openhands-native-clean-break-agent-runtime` branch so the
branch ships with OpenHands as the only agent runtime.

---

## Current State Summary

The branch implements the OpenHands Agent Server runtime for workflow steps 0–3,
the answer evaluator, scope review, and refine turns. The Node sidecar and
Claude SDK path coexist with the OpenHands path. The sidecar pool and
`ClaudeRuntime` adapter remain intact but are dead for migrated paths.

Key finding from `workflow/runtime.rs`: steps 0–3 and refine route to
`openhands_server::dispatch_openhands_one_shot`/`dispatch_openhands_refine_turn`.
The sidecar pool is kept for `start_agent` (non-workflow one-shot calls from
Test/Feedback surfaces) and for the fallback step path (`step_id > 3`). Both of
those are also migration targets.

---

## Dead Code Inventory

### Node Sidecar — Delete Entirely

| File | Reason |
|---|---|
| `app/sidecar/options.ts` | Claude SDK option builder; imports `@anthropic-ai/claude-agent-sdk` |
| `app/sidecar/runtime/claude-runtime.ts` | Claude SDK one-shot adapter |
| `app/sidecar/runtime/sink.ts` | Claude SDK–to–sidecar-JSONL sink |
| `app/sidecar/runtime/types.ts` | Claude SDK runtime request/session types |
| `app/sidecar/stream-session.ts` | Claude SDK streaming session with `AskUserQuestion` bridge |
| `app/sidecar/run-agent.ts` | Compatibility wrapper for Claude one-shot callers |
| `app/sidecar/message-processor.ts` | Claude SDK message-to-protocol mapper |
| `app/sidecar/run-metadata-accumulator.ts` | Claude SDK run-result summary builder |
| `app/sidecar/message-classifier.ts` | Claude SDK message type classifier |
| `app/sidecar/result-gate.ts` | Claude SDK result gate |
| `app/sidecar/tool-summaries.ts` | Claude SDK tool-call summary formatter |
| `app/sidecar/persistent-mode.ts` | Node sidecar request demultiplexer (OpenHands path already rejected here) |
| `app/sidecar/agent-runner.ts` | Claude SDK agent runner entrypoint |
| `app/sidecar/openhands-rejection.ts` | Error constant used only by `persistent-mode.ts` |

**Note:** `app/sidecar/config.ts`, `app/sidecar/display-types.ts`,
`app/sidecar/agent-events.ts`, `app/sidecar/error-labels.ts`,
`app/sidecar/shutdown.ts`, `app/sidecar/mock-agent.ts`,
`app/sidecar/mock-templates/`, and `app/sidecar/generated/` may survive if they
are also consumed by non-Claude sidecar infrastructure (e.g. promptfoo sidecar
or mock agent). Audit imports before deleting.

### NPM Dependencies

| Package | Where | Action |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | `app/sidecar/package.json` | Remove |
| `@anthropic-ai/sdk` | `app/sidecar/package.json` | Remove (only needed for Claude SDK) |
| `@anthropic-ai/sdk` | `app/package.json` | Remove if only used for Claude SDK types |

### Rust — Dead Sidecar Pool Paths

| File / Symbol | Action |
|---|---|
| `app/src-tauri/src/agents/sidecar_pool/dispatch.rs` | Delete or gut — `send_request` and stream methods dead for OpenHands; verify `start_agent` command is also removed first |
| `app/src-tauri/src/agents/sidecar_pool/pool.rs` | Delete after dispatch removed |
| `app/src-tauri/src/agents/sidecar_pool/process.rs` | Delete after pool removed |
| `app/src-tauri/src/agents/sidecar_pool/startup_error.rs` | Delete after pool removed |
| `app/src-tauri/src/agents/sidecar_pool/mod.rs` | Delete after submodules removed |
| `app/src-tauri/src/agents/sidecar.rs` — `spawn_sidecar`, `SidecarPool` references | Remove Claude-specific spawn path; keep `SidecarConfig` only if still needed by Agent Server request building (verify) |
| `app/src-tauri/src/agents/sidecar_path.rs` | Delete if only used to resolve Node/Claude CLI path |
| `app/src-tauri/src/commands/agent.rs` — `start_agent` command | Audit: if this command only feeds Claude SDK, delete it; if it powers Test/Feedback via OpenHands, migrate it |
| `app/src-tauri/src/commands/api_validation.rs` | Replace Anthropic-specific `/v1/models` check with OpenHands `test_model_connection` (per `model-settings` design) |
| `app/src-tauri/src/commands/workflow/runtime.rs` — sidecar fallback | Remove `step_id > 3` sidecar fallback (no valid steps exist); remove dual-path cancellation |

### Claude SDK Settings Fields (Rust + TypeScript)

Remove reads/writes for these persisted fields (they are ignored by
`selected_workflow_llm` after the `model-settings` clean break, but dead
assignments still exist):

`anthropic_api_key`, `preferred_model`, `fallback_model`, `openhands_provider`,
`openhands_api_key`, `openhands_model`, `openhands_base_url`,
`extended_thinking`, `interleaved_thinking_beta`, `sdk_effort`,
`pathToClaudeCodeExecutable`, `permissionMode`, `requiredPlugins`.

Touch points: `app/src-tauri/src/db/settings.rs`,
`app/src-tauri/src/commands/settings.rs`,
`app/src-tauri/src/types/settings.rs`,
`app/src/lib/types.ts`, `app/src/pages/settings.tsx`,
`app/src/stores/settings-store.ts`.

### Agent Sources — Legacy Claude Files

| Path | Action |
|---|---|
| `agent-sources/claude/CLAUDE.md` | Delete — legacy always-on context for Claude runtime |
| `agent-sources/claude/CLAUDE-MINIMAL.md` | Delete |
| `agent-sources/plugins/skill-content-researcher/.claude-plugin/plugin.json` | Delete |
| `agent-sources/plugins/skill-content-researcher/agents/research-agent.md` | Delete |
| `agent-sources/plugins/skill-creator/.claude-plugin/plugin.json` | Delete |
| `agent-sources/plugins/skill-creator/agents/grader.md` | Audit: delete if only used by Claude SDK eval path |
| `agent-sources/plugins/skill-creator/agents/rewrite-skill.md` | Audit: delete if only used by Claude SDK refine path |
| `agent-sources/plugins/vd-agent/` | Audit: determine whether this plugin is OpenHands-compatible or Claude-SDK-only |
| `agent-sources/prompts/refine-followup.txt` and `refine-initial.txt` | Audit: delete if these fed the old Node sidecar refine path |
| `agent-sources/prompts/workflow-step.txt` | Audit: delete if this fed the old router-agent pattern |
| `agent-sources/prompts/skill-suggestions.txt` | Audit: delete if only used by a Claude-SDK command |
| `agent-sources/skills/skill-test/` | Audit: determine if the `skill-test` AgentSkill is OpenHands-compatible |

Note: `agent-sources/plugins/skill-creator/scripts/` and
`agent-sources/plugins/skill-creator/skills/` contain eval tooling — audit
before deleting to avoid breaking `tests/evals/`.

### Tests

| File / Suite | Action |
|---|---|
| `app/sidecar/__tests__/options.test.ts` | Delete (tests deleted `options.ts`) |
| `app/sidecar/__tests__/message-processor.test.ts` | Delete |
| `app/sidecar/__tests__/run-agent.test.ts` | Delete |
| `app/sidecar/__tests__/run-metadata-accumulator.test.ts` | Delete |
| `app/sidecar/__tests__/persistent-mode.test.ts` | Delete |
| `app/sidecar/__tests__/runtime-types.test.ts` | Delete |
| `app/sidecar/__tests__/runtime-sink.test.ts` | Delete |
| `app/sidecar/__tests__/result-gate.test.ts` | Delete (if tests deleted `result-gate.ts`) |
| `app/sidecar/__tests__/message-classifier.test.ts` | Delete |
| `app/sidecar/__tests__/mock-agent.test.ts` | Audit: keep if mock agent is still needed for OpenHands E2E |
| `app/sidecar/__tests__/config.test.ts` | Audit: keep config shape that is still used by Agent Server path |
| Frontend unit tests that mock `sidecar` Claude runtime events | Audit: replace with `conversation_event` / `conversation_state` fixtures |
| `app/src/__tests__/lib/canonical-format.test.ts` | Audit: ensure it only covers OpenHands event shapes, not legacy `display_item`/`run_result` |

### GHA Workflows

| File | Change |
|---|---|
| `.github/workflows/pr-ci.yml` | Remove sidecar build/test steps if sidecar is fully deleted. If sidecar is kept for non-Claude purposes (promptfoo sidecar), keep those steps only. |
| `.github/workflows/release.yml` | Remove Claude CLI binary bundling from Tauri resources if present; remove sidecar build from release pipeline if deleted. |

Verify in `tauri.conf.json`:
- `agent-sources/claude/` is no longer a bundled resource.
- No Claude Code CLI binary listed under `bundle.resources`.

### Scripts

| File | Action |
|---|---|
| `scripts/openhands-agentskill-live-smoke.mjs` | Audit: does this smoke test the old Python runner or the Agent Server? If runner, delete. |
| Any script referencing `openhands-runner` binary or `pyinstaller` | Delete |

### User Guide

| File | Change |
|---|---|
| `docs/user-guide/settings.md` | Replace **Claude SDK** section with **Models** per `model-settings` design. Remove `preferred_model`, `extended_thinking`, `interleaved_thinking_beta`, `sdk_effort`, `refine_prompt_suggestions` controls. Document `modelSettings` shape instead. |

---

## Recommended Execution Order

1. **Add replacement tests** for any deleted sidecar behavior that is now covered by OpenHands Agent Server (per the test strategy in `openhands-agent-server-runtime/README.md`). Do this before deleting.
2. **Delete sidecar Node Claude path**: `options.ts`, `runtime/claude-runtime.ts`, `runtime/sink.ts`, `runtime/types.ts`, `stream-session.ts`, `run-agent.ts`, `message-processor.ts`, `run-metadata-accumulator.ts`, `message-classifier.ts`, `result-gate.ts`, `tool-summaries.ts`, `agent-runner.ts`.
3. **Delete sidecar tests** for those files.
4. **Remove `@anthropic-ai/claude-agent-sdk`** from `app/sidecar/package.json`.
5. **Delete Rust sidecar pool** after confirming `start_agent` is migrated or deleted.
6. **Migrate `start_agent`** (Test/Feedback surfaces) to call `openhands_server::dispatch_openhands_one_shot` or remove the command if the surfaces are gone.
7. **Remove sidecar fallback** from `workflow/runtime.rs` (`step_id > 3` path).
8. **Clean settings fields**: remove legacy fields from Rust settings structs, DB normalization, and frontend settings store.
9. **Migrate api_validation.rs** to use OpenHands `test_model_connection`.
10. **Delete agent-sources/claude/** and legacy plugin files after confirming no code reads them.
11. **Update user guide** `settings.md` to describe `Models` section.
12. **Update GHA** to remove dead sidecar steps / Claude binary bundling.
13. **Run full test suite** (`cargo test`, `npm run test:unit`, `npm run test:agents:structural`, `npm run test:e2e`) to validate.

---

## Task: Workspace Scratch Dir Cleanup (VU-1157 Aftermath + Dead logs/ Chain)

**Context:** Two related problems leave the workspace scratch dir cluttered with dead files:

1. **VU-1157 stale artifacts.** VU-1157 stopped writing `context/clarifications.json`, `context/decisions.json`, `user-context.md`, `answer-evaluation.json`, and `gate-result.json` but never added startup cleanup for existing copies. `crud.rs` also still creates an empty `context/` on skill creation.

2. **Dead `logs/` chain.** `create_openhands_persistence_dir` creates `logs/{agent_id}-{timestamp}/` dirs every run but nothing ever writes into them — the `PathBuf` it returns is always discarded (`.map(|_| ())` or `let _persistence_path = ...`). The `transcript_dir` field on `OpenHandsOneShotRun` is set but never read by any caller. The entire `transcript_log_dir` field on `SidecarConfig` and all the places that set it exist only to feed this dead function.

**Files to modify:**
- `app/src-tauri/src/commands/workspace.rs`
- `app/src-tauri/src/commands/skill/crud.rs`
- `app/src-tauri/src/agents/openhands_server/mod.rs`
- `app/src-tauri/src/commands/workflow/runtime.rs`
- `app/src-tauri/src/commands/refine/mod.rs`
- `app/src-tauri/src/agents/sidecar.rs`
- `app/src-tauri/src/types/mod.rs`
- `app/src-tauri/src/agents/openhands_server/client.rs`

---

### Part A — Delete the dead `logs/` persistence chain

- [ ] `openhands_server/mod.rs` — delete `create_openhands_persistence_dir` (the function around line 770).
- [ ] `openhands_server/mod.rs` — in `dispatch_openhands_one_shot`: remove the `transcript_log_dir: Option<&str>` parameter and the `create_openhands_persistence_dir` call; change the return type from `Result<PathBuf, String>` to `Result<(), String>` and return `Ok(())`.
- [ ] `openhands_server/mod.rs` — in `dispatch_openhands_refine_turn`: remove the `transcript_log_dir: Option<&str>` parameter and the `let _persistence_path = create_openhands_persistence_dir(...)` call.
- [ ] `openhands_server/mod.rs` — in `run_openhands_one_shot`: remove `let log_dir = ...` and `let log_dir_str = ...` (lines ~159-160); update the `dispatch_openhands_one_shot` call to drop the log dir argument; remove `transcript_dir: persistence_dir` from the `OpenHandsOneShotRun` return value.
- [ ] `openhands_server/mod.rs` — remove `pub transcript_dir: PathBuf` field from `OpenHandsOneShotRun` struct.
- [ ] `runtime.rs` — remove the two `config.transcript_log_dir = Some(...)` assignments (lines ~202-207 and ~242-247); remove the two `let transcript_log_dir = config.transcript_log_dir.clone();` locals and the `transcript_log_dir.as_deref()` arguments passed to `dispatch_openhands_one_shot`.
- [ ] `refine/mod.rs` — remove `let log_dir = format!("{workspace_skill_dir_str}/logs");` and `config.transcript_log_dir = Some(log_dir.clone());`; update the `dispatch_openhands_refine_turn` call to drop the `Some(&log_dir)` argument.
- [ ] `sidecar.rs` — remove `pub transcript_log_dir: Option<String>` field from `SidecarConfig`; remove all `transcript_log_dir: None` defaults in the struct constructors in this file.
- [ ] `types/mod.rs` — remove `transcript_log_dir: None` from the `SidecarConfig` default/constructor there.
- [ ] `client.rs` — remove `transcript_log_dir: None` from the `SidecarConfig` construction there.

---

### Part B — Stop creating `context/` on new skills

- [ ] `crud.rs` — in `create_skill_filesystem_inner` (around line 337), change:
  ```rust
  // Create plugin-organised workspace dir and context subdir.
  fs::create_dir_all(workspace_skill_dir.join("context")).map_err(|e| e.to_string())?;
  ```
  to:
  ```rust
  fs::create_dir_all(&workspace_skill_dir).map_err(|e| e.to_string())?;
  ```

---

### Part C — Startup sweep for stale workspace artifacts

- [ ] `workspace.rs` — in `migrate_workspace_layout`, after the existing cleanup blocks, add a two-level walk over `{workspace}/{plugin_slug}/{skill_name}/` dirs. All removals are best-effort and non-fatal (use the existing pattern: `if path.is_X() { let _ = fs::remove_X(&path); }`). For each skill dir:
  - Delete these files if they exist: `context/clarifications.json`, `context/decisions.json`, `context/benchmark-meta.json`, `user-context.md`, `answer-evaluation.json`, `gate-result.json`.
  - Remove `context/` with `fs::remove_dir` (not `remove_dir_all`) if it is empty after the above.
  - Remove any empty `logs/{name}/` subdirectories left by the dead persistence chain (iterate one level into `logs/`, try `fs::remove_dir` on each entry). Then try `fs::remove_dir` on `logs/` itself.
  - Add a comment explaining the VU-1157 and dead-logs-chain origin so a future reader knows when to drop these rules.

---

### Part D — Tests and validation

- [ ] Add a unit test in `workspace.rs` `#[cfg(test)]` confirming `migrate_workspace_layout` removes the stale VU-1157 files and empty `logs/` dirs, and leaves unrelated files untouched.
- [ ] Add a unit test confirming `create_skill_filesystem_inner` no longer creates a `context/` subdir.
- [ ] `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings` — clean.
- [ ] `cargo test --manifest-path app/src-tauri/Cargo.toml` — all tests pass.
- [ ] Commit: `fix: remove dead transcript-log chain and clean up stale workspace artifacts on startup`

---

## Task: DB Consistency Reset for Pre-VU-1157 In-Progress Skills

**Context:** Skills that were in-progress when VU-1157 merged have `workflow_runs.current_step > 0` but no rows in the `clarifications` or `decisions` DB tables — their artifact data only ever existed in the now-dead workspace JSON files. The app will never read those files again. These skills are stuck: the UI thinks they have progress, the DB has no data backing that claim. **Do not attempt to parse the JSON files and reconstruct DB rows** — just reset the step to 0 so the user re-runs from the beginning.

The reset belongs in `reconcile_skill_builder` in `app/src-tauri/src/reconciliation/skill_builder.rs`, immediately after the existing stale `in_progress` step fix. It runs once at startup per affected skill and is idempotent (a skill already at step 0 skips the check).

**Files to modify:**
- `app/src-tauri/src/reconciliation/skill_builder.rs`

**Reset rules (incomplete skills only — skip if `status == "completed"`):**

| Condition | Action |
|---|---|
| `current_step >= 1` AND `read_clarifications(conn, name)` returns `Ok(None)` | Reset `current_step` → 0, `status` → `"pending"` |
| `current_step >= 3` AND `read_decisions(conn, name)` returns `Ok(None)` | Reset `current_step` → 0, `status` → `"pending"` |

Both conditions are checked independently; if the first resets to 0 the second is effectively a no-op.

**What to change:**

- [ ] In `reconcile_skill_builder`, after the stale `in_progress` step reset loop and before the `get_workflow_run` lookup, add a consistency check that:
  1. Reads `workflow_runs` for the skill to get `current_step` and `status`.
  2. Skips if status is `"completed"`.
  3. Checks clarifications if `current_step >= 1`; resets via `crate::db::save_workflow_run(conn, name, 0, "pending", purpose)` if missing.
  4. Checks decisions if `current_step >= 3`; resets the same way if missing.
  5. Logs an `info!` for each reset: `"[reconcile] '{}': resetting step {} → 0 (no DB artifacts for completed phase)"`.
  6. Pushes a notification string (same format as the existing stale-step notification).

- [ ] Add a test in `app/src-tauri/src/reconciliation/tests.rs`: create a skill with `current_step = 2` and no clarifications row; run reconciliation; assert `current_step` is reset to 0.

- [ ] `cargo test --manifest-path app/src-tauri/Cargo.toml` — all tests pass.
- [ ] Commit: `fix: reset in-progress skills with no DB artifact rows to step 0 on startup`

---

## Validation Gates

Before marking cleanup complete:

- `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings` passes.
- `cd app && npx tsc --noEmit` passes.
- `cd app && npm run test:unit` passes.
- `cd app && npm run test:agents:structural` passes.
- `grep -r "claude-agent-sdk\|pathToClaudeCodeExecutable\|ClaudeRuntime\|SidecarPool\|persistent-mode\|stream-session" app/sidecar/ app/src-tauri/src/` returns no production-code matches.
- `scripts/openhands-agent-server-live-smoke.mjs` runs clean end-to-end.
- `tauri.conf.json` contains no reference to `agent-sources/claude/` or a bundled Claude binary.

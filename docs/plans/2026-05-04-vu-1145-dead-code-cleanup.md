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

## Validation Gates

Before marking cleanup complete:

- `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings` passes.
- `cd app && npx tsc --noEmit` passes.
- `cd app && npm run test:unit` passes.
- `cd app && npm run test:agents:structural` passes.
- `grep -r "claude-agent-sdk\|pathToClaudeCodeExecutable\|ClaudeRuntime\|SidecarPool\|persistent-mode\|stream-session" app/sidecar/ app/src-tauri/src/` returns no production-code matches.
- `scripts/openhands-agent-server-live-smoke.mjs` runs clean end-to-end.
- `tauri.conf.json` contains no reference to `agent-sources/claude/` or a bundled Claude binary.

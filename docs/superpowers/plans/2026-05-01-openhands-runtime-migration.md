# OpenHands Runtime Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Claude Agent SDK execution path with an OpenHands-backed runtime without changing the Rust/frontend sidecar protocol.

**Architecture:** Preserve the existing Tauri <-> Node sidecar JSONL boundary and `AgentEvent`/`display_item` shapes. Add an OpenHands adapter behind `app/sidecar/runtime/types.ts`, validate it with one-shot workflow parity first, then move streaming/refine only after event fidelity and packaging are proven.

**Tech Stack:** Tauri v2, React/TypeScript, Rust, Node.js sidecar, Python OpenHands SDK packages (`openhands-sdk`, `openhands-tools`, optionally `openhands-workspace`/`openhands-agent-server`).

---

**Design reference:** `docs/design/agent-runtime-boundary/README.md` — covers the runtime contract, sink interface, one-shot/streaming split, `AskUserQuestion` contract, configuration split, and the **Structured Output Contract** section which defines how `outputFormat` must be handled by all adapters.

## Current Runtime Contract

- `app/sidecar/runtime/types.ts` is the contract to preserve: `AgentRuntime.runOnce`, `RuntimeSession`, `RuntimeSink`, `OneShotRunRequest`, and `StreamingSessionRequest`.
- `app/sidecar/runtime/claude-runtime.ts` already isolates one-shot Claude SDK execution behind that contract.
- `app/sidecar/stream-session.ts` still owns Claude-specific streaming, resume, abort, and `AskUserQuestion` handling.
- `app/sidecar/message-processor.ts` maps raw Claude SDK messages into Skill Builder display items and `run_result` events. OpenHands needs its own equivalent mapper rather than forcing OpenHands events through Claude message assumptions.
- `app/src-tauri/src/agents/sidecar.rs` currently resolves and passes a bundled Claude binary path. The OpenHands path should avoid leaking Python/runtime details into frontend callers.

## Migration Strategy

1. Keep the sidecar process as the app boundary.
2. Add OpenHands as a runtime provider behind the existing runtime interface.
3. Bridge Node -> Python with a small Python runner process at first. Do not embed Python packaging into Tauri until the spike proves the event stream and workflow outputs.
4. **Structured output is text-extraction only.** `outputFormat` in `SidecarConfig` is the app-owned signal that JSON is expected — it is never forwarded to any runtime SDK. Every adapter's event processor extracts JSON from result text using `extractJsonFromText` when `outputFormat` is set. See `docs/design/agent-runtime-boundary/README.md#structured-output-contract` for the full contract.
5. Migrate one-shot workflow steps before refine streaming. Refine is the risk-heavy path because it depends on blocking UI questions, cancellation, and session continuation.

## Task 1: Runtime Selection Flag

**Files:**

- Modify: `app/sidecar/config.ts`
- Modify: `app/src-tauri/src/agents/sidecar.rs`
- Modify: `app/sidecar/runtime/types.ts`
- Test: `app/sidecar/__tests__/config.test.ts`

- [ ] Add `runtimeProvider?: "claude" | "openhands"` to `SidecarConfig`, defaulting to `"claude"` when absent.
- [ ] Mirror the field in Rust `SidecarConfig` as `runtimeProvider`, with `skip_serializing_if = "Option::is_none"`.
- [ ] Add the provider to `RuntimeRequestBase` so all adapter code sees the selected runtime.
- [ ] Add config validation tests:

```ts
expect(parseSidecarConfig({ ...baseConfig, runtimeProvider: "openhands" }).runtimeProvider).toBe("openhands");
expect(() => parseSidecarConfig({ ...baseConfig, runtimeProvider: "bad" })).toThrow(
  "Invalid SidecarConfig: runtimeProvider must be one of claude, openhands",
);
```

- [ ] Run: `cd app/sidecar && npx vitest run __tests__/config.test.ts __tests__/runtime-types.test.ts`
- [ ] Commit: `git commit -m "Add sidecar runtime provider selection"`

## Task 2: OpenHands Runner Spike

**Files:**

- Create: `app/sidecar/openhands/runner.py`
- Create: `app/sidecar/openhands/requirements.txt`
- Create: `app/sidecar/__tests__/fixtures/openhands-events.jsonl`
- Test: manual spike command documented in the PR body

**Structured output contract (see design doc §Structured Output Contract):** The runner is not responsible for JSON extraction. It always emits `structured_output: null` and puts the agent's full result text in `result_text`. JSON extraction from that text is the event processor's job (Task 3).

- [ ] Create a Python runner that accepts one JSON request on stdin and emits JSONL events on stdout.
- [ ] Use `LLM`, `get_default_agent`, and `Conversation(agent=agent, workspace=cwd)` from OpenHands for the first pass.
- [ ] Map OpenHands lifecycle to raw neutral events:

```json
{"type":"openhands_event","event_kind":"message","text":"...","timestamp":123}
{"type":"openhands_event","event_kind":"tool_call","tool_name":"BashTool","summary":"...","timestamp":123}
{"type":"openhands_result","status":"success","result_text":"...","structured_output":null,"timestamp":123}
```

- [ ] Always emit `structured_output: null` — never attempt JSON extraction in the runner. The event processor handles extraction.
- [ ] Validate required fields (`prompt`, `apiKey`) before running; emit an `openhands_result` error for missing fields.
- [ ] Handle OpenHands `ImportError` gracefully: emit `openhands_result` error pointing to `requirements.txt`.
- [ ] Verify the runner can edit files in a temporary workspace using `LocalWorkspace`/plain workspace path.
- [ ] Verify which models and API key env names work through OpenHands `LLM`; record the chosen mapping in the plan PR notes.
- [ ] Do not bundle Python or change Tauri config yet.

## Task 3: OpenHands Runtime Adapter

**Files:**

- Create: `app/sidecar/runtime/openhands-runtime.ts`
- Create: `app/sidecar/openhands-event-processor.ts`
- Modify: `app/sidecar/runtime/claude-runtime.ts`
- Modify: `app/sidecar/run-agent.ts`
- Test: `app/sidecar/__tests__/openhands-runtime.test.ts`
- Test: `app/sidecar/__tests__/openhands-event-processor.test.ts`

- [ ] Implement `OpenHandsRuntime implements AgentRuntime` for one-shot only.
- [ ] Remove `outputFormat` from the Claude SDK options in `app/sidecar/options.ts` (line with `outputFormat: config.outputFormat`). The field stays in `SidecarConfig` as the extraction signal but must not be forwarded to the SDK.
- [ ] Spawn `python app/sidecar/openhands/runner.py` with a sanitized env and write the serialized `OneShotRunRequest` to stdin.
- [ ] Convert runner JSONL through `openhands-event-processor.ts` into existing `display_item` and `agent_event/run_result` messages.
- [ ] In `openhands-event-processor.ts`: when processing an `openhands_result`, use `extractJsonFromText` (from `app/sidecar/lib/result-extraction.ts`) to populate `structuredOutput` when `hasOutputFormat` is true — matching `MessageProcessor.processResultMessage` behavior. Emit `structured_output_missing` run-result error when extraction fails, same as the Claude path.
- [ ] Keep `runAgentRequest` provider routing small:

```ts
const runtime = config.runtimeProvider === "openhands"
  ? new OpenHandsRuntime()
  : new ClaudeRuntime();
```

- [ ] Preserve `MOCK_AGENTS=true` behavior in `ClaudeRuntime`; do not mix mock templates into OpenHands until the real adapter passes.
- [ ] Run: `cd app/sidecar && npx vitest run __tests__/openhands-runtime.test.ts __tests__/openhands-event-processor.test.ts __tests__/run-agent.test.ts`
- [ ] Commit: `git commit -m "Add OpenHands one-shot runtime adapter"`

## Task 5: One-Shot Workflow Gate

**Files:**

- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/types/settings.rs`
- Modify: `app/src/pages/settings.tsx` only if a visible provider toggle is needed
- Test: `app/src-tauri/src/commands/workflow/tests.rs` or the nearest existing workflow runtime test

- [ ] Add a developer-only setting or env var for `runtimeProvider=openhands`.
- [ ] Route only workflow one-shot runs to OpenHands initially. Leave refine/test/eval on Claude unless explicitly selected.
- [ ] Run a full mocked workflow to confirm no Rust/frontend event contract changes are required.
- [ ] Run: `cd app && npm run test:agents:structural`
- [ ] Run: `cd app && npm run test:unit`
- [ ] Commit: `git commit -m "Gate workflow runs behind OpenHands provider"`

## Task 6: Streaming And Refine Design

**Files:**

- Modify: `app/sidecar/stream-session.ts`
- Create or modify: `app/sidecar/runtime/openhands-stream-session.ts`
- Test: `app/sidecar/__tests__/stream-session.test.ts`
- Test: `app/sidecar/__tests__/persistent-mode.test.ts`

- [ ] Only start this task after one-shot workflow parity passes.
- [ ] Decide whether OpenHands conversation persistence can replace Claude `resume`, or whether Skill Builder must keep its own conversation ID and event log.
- [ ] Implement `AskUserQuestion` parity as either an OpenHands custom tool or a controlled interrupt event emitted by the runner.
- [ ] Preserve these frontend-visible behaviors: `refine_question`, answer submission, cancel current turn, shutdown `run_result`, and `session_exhausted`.
- [ ] Run: `cd app/sidecar && npx vitest run __tests__/stream-session.test.ts __tests__/persistent-mode.test.ts`
- [ ] Commit: `git commit -m "Add OpenHands streaming refine session support"`

## Task 7: Packaging Decision

**Files:**

- Modify: `app/sidecar/build.js`
- Modify: `app/src-tauri/tauri.conf.json`
- Modify: `app/src-tauri/src/agents/sidecar.rs`
- Modify: `README.md` if runtime prerequisites change
- Modify: `repo-map.json` if package/build structure changes

- [ ] Choose one packaging path:
  - Dev-only Python dependency for the first internal branch.
  - Bundled Python environment/resource for release builds.
  - Remote `openhands.agent_server` for sandboxed production execution.
- [ ] If bundling locally, add deterministic build scripts that stage the runner and Python dependencies under `sidecar/dist/openhands/`.
- [ ] If using agent server, add CSP/connectivity and settings changes for the local/remote endpoint.
- [ ] Keep `resolve_sdk_cli_path` Claude-specific or replace it with provider-specific runtime dependency validation.
- [ ] Run release-stage verification relevant to the chosen packaging path.
- [ ] Commit: `git commit -m "Package OpenHands runtime dependencies"`

## Task 8: Cleanup And Default Switch

**Files:**

- Modify: `app/sidecar/package.json`
- Modify: `app/sidecar/package-lock.json`
- Modify: `app/sidecar/options.ts`
- Modify: `app/sidecar/runtime/claude-runtime.ts`
- Modify: `app/src/components/about-dialog.tsx`
- Modify: `repo-map.json`
- Test: full affected sidecar/unit suite

- [ ] Keep Claude as fallback until OpenHands passes workflow, refine, test, and packaging parity.
- [ ] After parity, switch the default provider to OpenHands.
- [ ] Remove Claude-only options that no longer apply from runtime-neutral config, or isolate them in a `ClaudeRuntimeOptions` object.
- [ ] Update About/settings copy from Claude Agent SDK to the selected runtime.
- [ ] Remove `@anthropic-ai/claude-agent-sdk` only after no runtime path imports it.
- [ ] Run: `cd app/sidecar && npx vitest run`
- [ ] Run: `cd app && npm run test:agents:structural`
- [ ] Run: `cd app && npm run test:unit`
- [ ] Run Rust/cross-layer tests selected from `TEST_MANIFEST.md`.
- [ ] Commit: `git commit -m "Switch default agent runtime to OpenHands"`

## Acceptance Criteria

- OpenHands can complete at least one real workflow step and produce the same persisted artifacts as the Claude path.
- Sidecar stdout still uses the existing JSONL envelope shapes consumed by Rust and React.
- `run_result` persists usage/status/workspace/plugin metadata without Rust/frontend changes.
- Structured workflow output remains schema-validated.
- Refine still supports follow-up messages, blocking questions, cancellation, and visible shutdown/error states before it is moved off Claude.
- Release packaging has an explicit story for Python dependencies, workspaces, and sandboxing.

## Verification Matrix

- Sidecar adapter tests: `cd app/sidecar && npx vitest run`
- Agent structural tests: `cd app && npm run test:agents:structural`
- Frontend/unit contract tests: `cd app && npm run test:unit`
- Rust/cross-layer tests: read `TEST_MANIFEST.md` and run the mapped cargo filters for changed Rust command/agent files
- Manual smoke: run `cd app && MOCK_AGENTS=true npm run dev` for baseline UI and a real OpenHands workflow step only after API keys/runtime dependencies are configured

## Key Risks

- OpenHands SDK is Python-first; Skill Builder currently bundles a Node sidecar plus a native Claude binary.
- OpenHands event shapes will not match Claude SDK messages; a dedicated event processor is required.
- Claude `outputFormat`, `canUseTool`, `resume`, `allowedTools`, `permissionMode`, hooks, and usage accounting all need explicit parity decisions.
- Sandboxed OpenHands workspaces may be desirable long-term, but local workspace mode is the lowest-risk spike path.

# Agent Runtime Boundary

> **Status:** Draft

## Overview

Skill Builder currently talks directly to the Claude Agent SDK from the Node
sidecar. The intended design is to make the sidecar expose a Skill
Builder-owned runtime boundary first, keep Claude behind that boundary, and
then add an OpenHands implementation behind the same contract.

The boundary separates app behavior from provider/runtime behavior. React and
Rust should continue to consume Skill Builder protocol messages such as
`display_item`, `agent_event`, `refine_question`, and `run_result`; runtime
adapters are responsible for converting SDK-specific events into that protocol.

## Design Scope

**Covers**

- One-shot run and streaming-session runtime contracts.
- The invariant that one-shot runs cannot ask the user questions.
- How the existing Claude SDK implementation moves behind the new boundary.
- How OpenHands can be introduced after the boundary exists.
- Runtime-facing configuration and event mapping responsibilities.
- Progress visibility requirements for one-shot runs and streaming sessions.

**Does not cover**

- Rewriting the React/Tauri application shell.
- Changing skill artifact formats such as `clarifications.json` or
  `decisions.json`.
- Replacing the app's existing persistence schema.
- A detailed task-by-task implementation plan.

## Key Decisions

| Decision | Rationale |
|---|---|
| Add the runtime boundary before introducing OpenHands. | This keeps the current Claude behavior available while the app-facing contract is clarified. |
| Model one-shot runs and streaming sessions as separate runtime methods. | Callers must choose whether a run is autonomous or interactive instead of relying on sidecar inference. |
| Forbid user questions in one-shot runs. | A one-shot run has no app-owned pause/resume loop, so `AskUserQuestion` semantics are incompatible by definition. |
| Keep `AskUserQuestion` as a Skill Builder interaction contract. | The UX belongs to this app; Claude currently triggers it, but OpenHands can trigger the same app behavior through a custom tool. |
| Keep the app-facing protocol stable during the boundary refactor. | Rust persistence, frontend stores, and tests already depend on normalized sidecar messages. |
| Preserve visible progress for every runtime mode. | Users need to see reasoning/progress messages, tool calls, file activity, and terminal status while the agent runs. A runtime adapter that only emits a final result does not satisfy the app contract. |
| Treat Claude as the first runtime adapter. | Wrapping the current implementation creates a working reference adapter for OpenHands parity checks. |

## Runtime Contract

The sidecar owns the runtime abstraction. The app-facing shape is intentionally
Skill Builder-specific instead of a generic agent framework wrapper.

```ts
interface AgentRuntime {
  runOnce(
    request: OneShotRunRequest,
    sink: RuntimeSink,
    signal?: AbortSignal,
  ): Promise<void>;

  startStreamingSession(
    request: StreamingSessionRequest,
    sink: RuntimeSink,
  ): RuntimeSession;
}

interface RuntimeSession {
  sendUserMessage(message: string): Promise<void>;
  answerQuestion(toolUseId: string, answer: unknown): Promise<void>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}
```

Shared request fields belong in a base request:

```ts
interface RuntimeRequestBase {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  agentName?: string;
  cwd: string;
  workspaceRootDir: string;
  workspaceSkillDir: string;
  requiredPlugins?: string[];
  maxTurns?: number;
  outputFormat?: {
    type: "json_schema";
    schema: Record<string, unknown>;
  };
  context: RunPersistenceContext;
}
```

Mode-specific request fields express the app invariant:

```ts
interface OneShotRunRequest extends RuntimeRequestBase {
  mode: "one-shot";
  allowUserQuestions: false;
}

interface StreamingSessionRequest extends RuntimeRequestBase {
  mode: "streaming";
  allowUserQuestions: true;
}
```

The boundary should reject invalid configurations before a runtime adapter is
called:

- `OneShotRunRequest` must not include `AskUserQuestion` or its OpenHands
  equivalent in the tool set.
- `StreamingSessionRequest` may expose the app-owned question tool.
- If a runtime emits a user-question event during a one-shot run, the adapter
  emits an error `run_result` and closes the run.

## Runtime Sink

The sink is the only way a runtime adapter reports app-visible progress.

```ts
interface RuntimeSink {
  emitDisplayItem(item: DisplayItem): void;
  emitAgentEvent(event: AgentEvent): void;
  emitRefineQuestion(question: RefineQuestion): void;
  emitRaw(message: Record<string, unknown>): void;
}
```

Adapters can keep internal SDK event shapes, but they must normalize before
emitting to the sink. The Rust event router and React stores should not need to
know whether a message came from Claude or OpenHands.

## Progress Visibility

Both runtime modes must stream work-in-progress information through the sink.
The UI must never have to wait for a final `run_result` to know that work is
happening.

Runtime adapters should emit normalized events for:

- run/conversation start and terminal status;
- assistant reasoning or progress messages when the runtime exposes them;
- tool-call start with tool name and summary;
- safe tool observations, file operations, and shell command activity;
- validation warnings, retries, cancellation, and max-turn exits.

One-shot runs and streaming sessions use the same progress envelopes. The
difference is lifecycle: one-shot sends one user prompt and terminates after one
result; streaming sessions keep the conversation open for additional user
messages and app-owned user-question turns.

## One-Shot Runs

A one-shot run is an autonomous request:

1. The caller submits one request.
2. The runtime streams progress, reasoning, tool-call, and display events.
3. The runtime emits exactly one terminal `run_result`.
4. The runtime is done.

One-shot runs are appropriate for workflow steps, skill tests, evaluation
subruns, description optimization subruns, and background analysis. Workflow
steps are one-shot by contract and must not expose `AskUserQuestion` or require
mid-run user input.

The existing `runAgentRequest` path is the closest current implementation of
this mode. It should become the Claude-backed `runOnce` implementation first.

## Streaming Sessions

A streaming session is an app-owned interactive loop:

1. The caller starts a session.
2. The UI can send more user messages.
3. The agent can request app-owned user input.
4. The app can answer, cancel, resume, or close the session.
5. The session emits terminal run summaries for persistence.

Streaming sessions are appropriate for refine chat and other app-owned
interactive loops that may ask the user structured questions. The existing
`StreamSession` class is the closest current implementation of this mode.

## AskUserQuestion Contract

`AskUserQuestion` is not a Claude-specific product feature. It is the app-owned
interaction contract for structured mid-run user input.

In the Claude adapter, this contract is implemented with the Claude SDK
`canUseTool` callback for the `AskUserQuestion` tool.

In the OpenHands adapter, the same contract should be implemented as a custom
tool or action:

```text
OpenHands agent requests app user input
  -> OpenHands runtime adapter emits refine_question
  -> Tauri/React renders the existing UX
  -> user submits an answer
  -> runtime adapter returns an observation to OpenHands
  -> agent continues
```

The app-level semantics stay the same across adapters:

- only one pending question per streaming session unless the contract is
  deliberately expanded;
- cancellation rejects or resolves any pending question consistently;
- submitted answers are correlated by tool-use ID;
- unanswered questions cannot leave the session permanently stuck.

## Claude Adapter

The first adapter should wrap existing behavior rather than rewriting it.

Responsibilities:

- move `query()` calls behind `ClaudeRuntime.runOnce` and
  `ClaudeRuntime.startStreamingSession`;
- keep Claude option construction in a Claude-specific module;
- keep Claude plugin discovery and `.claude/plugins` wiring inside the Claude
  adapter until plugin layout is generalized;
- keep `MessageProcessor` and `RunMetadataAccumulator` behavior stable unless
  a boundary test proves a change is required;
- keep `MOCK_AGENTS=true` behavior available for tests.

This adapter is the parity reference for the OpenHands port.

## OpenHands Adapter

OpenHands should be introduced only after the Claude adapter passes behind the
runtime boundary.

Responsibilities:

- start or connect to the OpenHands runtime required by the SDK;
- translate Skill Builder runtime requests into OpenHands session/run inputs;
- map OpenHands events, actions, observations, tool calls, usage data, and
  terminal status into the existing sink;
- implement the app-owned user-question tool for streaming sessions;
- provide cancellation and close behavior compatible with the sidecar pool;
- report enough model/session metadata for usage and run-history persistence.

The OpenHands adapter should not force React or Rust to consume OpenHands event
shapes directly.

## Configuration

`SidecarConfig` currently mixes app context, Claude SDK options, and persistence
context. The boundary should split those concerns:

- app request context: prompt, cwd, workspace paths, skill and plugin identity;
- runtime selection: Claude or OpenHands;
- model/provider config: model ID, provider credentials, base URL or runtime
  endpoint as needed;
- mode-specific controls: one-shot versus streaming, question capability,
  prompt suggestions, max turns;
- persistence context: skill name, step ID, workflow session ID, usage session
  ID, run source, transcript log directory.

Claude-only fields such as `pathToClaudeCodeExecutable`, Claude betas, and
Claude-specific permission modes belong in the Claude adapter config, not in
the common request shape.

## Structured Output Contract

`outputFormat` in `SidecarConfig` is the app-owned signal that a one-shot run
must return parseable JSON. It is **not** a provider instruction and must not be
forwarded to any runtime SDK.

### Signal only, not a provider instruction

When `outputFormat` is present in a `SidecarConfig`, the sidecar interprets it
as: "I expect the result text to contain valid JSON." The runtime adapter runs
the agent normally — no schema or format hint is sent to the underlying model or
SDK. The app already instructs the agent to produce JSON through its system
prompt and agent instructions.

The `outputFormat` field was previously forwarded to the Claude SDK
(`options.ts`) to request native structured output. That forwarding is removed.
The Claude SDK's native structured-output feature is unreliable and the app
already uses text-based JSON extraction as the de facto path. Making text
extraction the explicit primary mechanism removes the divergence.

### Extraction responsibility

The Python runner is not responsible for JSON extraction. It runs OpenHands and
emits the final assistant text in terminal `conversation_state.result_text`.

App code that owns a JSON-contract task extracts one JSON object from that
terminal text and then passes the object to Rust typed validation. The older
Claude adapter still uses `MessageProcessor.processResultMessage` for this same
text-extraction contract on Claude SDK result messages.

### Failure contract

If `outputFormat` is set and no parseable JSON is found in the result text after
all extraction attempts, the run fails with `structured_output_missing` or the
equivalent terminal `conversation_state` error. No artifacts are materialized.

### What this means for callers

Rust callers that set `outputFormat` in `SidecarConfig` use it as an app-owned
contract signal. The field may travel through the Rust -> Node boundary for
compatibility, but callers must not expect the model or SDK to receive schema
constraints from it.

## State And Transitions

One-shot run states:

```text
created -> running -> completed
created -> running -> failed
created -> running -> canceled
```

Streaming session states:

```text
created -> active -> waiting_for_user -> active
created -> active -> completed
created -> active -> canceled
created -> active -> failed
created -> active -> closed
```

`waiting_for_user` is valid only for streaming sessions.

## Relationship To Existing Design Specs

| Spec | Relationship |
|---|---|
| `docs/design/sdk-agent-options/README.md` | Describes current Claude SDK option wiring that should move behind the Claude adapter. |
| `docs/design/backend-design/agent-event-contracts.md` | Defines the app-facing event contract that runtime adapters should preserve. |
| `docs/design/agent-specs/README.md` | Describes workflow step and artifact contracts that runtime migration should not change. |
| `docs/design/write-eval-test-refine-loop/README.md` | Contains flows that should explicitly choose one-shot or streaming runtime mode. |
| `docs/design/workflow-state/README.md` | Contains workflow state behavior that should remain app-owned, not runtime-owned. |

## Key Source Files

| File | Purpose |
|---|---|
| `app/sidecar/runtime/types.ts` | Runtime request, sink, and session boundary types plus one-shot user-question guards. |
| `app/sidecar/runtime/sink.ts` | Adapter from runtime sink methods to the existing JSONL sidecar message envelopes. |
| `app/sidecar/runtime/claude-runtime.ts` | Claude runtime adapter for one-shot execution behind the boundary. |
| `app/sidecar/run-agent.ts` | Compatibility wrapper for existing one-shot callers. |
| `app/sidecar/stream-session.ts` | Streaming Claude SDK session path, runtime session methods, and `AskUserQuestion` bridge. |
| `app/sidecar/options.ts` | Claude SDK option builder. Does not forward `outputFormat` to the SDK. |
| `app/sidecar/config.ts` | Sidecar request validation shape, including optional runtime mode and `outputFormat` signal. |
| `app/sidecar/message-processor.ts` | Claude SDK-message to app-protocol mapper. Extracts JSON from result text when `outputFormat` is set. |
| `app/sidecar/openhands/runner.py` | Python spike runner — reads one JSON request from stdin, emits raw JSONL events on stdout. |
| `app/sidecar/openhands-event-processor.ts` | OpenHands event forwarder. Tracks terminal `conversation_state`; JSON-contract parsing happens in app task code after terminal state. |
| `app/sidecar/runtime/openhands-runtime.ts` | OpenHands one-shot runtime adapter behind `AgentRuntime`. |
| `app/sidecar/run-metadata-accumulator.ts` | Current `run_result` summary construction. |
| `app/sidecar/persistent-mode.ts` | Sidecar request demultiplexer that rejects mode mismatches and routes one-shot requests through the runtime boundary. |
| `app/src-tauri/src/agents/sidecar.rs` | Rust `SidecarConfig`, runtime mode serialization, and sidecar spawn path. |
| `app/src-tauri/src/agents/sidecar_pool/dispatch.rs` | Rust request dispatch, streaming, shutdown, and answer routing. |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Workflow one-shot request dispatch, cancellation, and question rejection. |
| `app/src-tauri/src/commands/refine/protocol.rs` | Refine chat protocol that should remain streaming. |
| `app/src-tauri/src/commands/workflow/step_config.rs` | Workflow step tool configuration with one-shot-safe tool sets. |
| `app/src/hooks/use-agent-stream.ts` | Frontend listener for normalized agent events. |
| `app/src/stores/workflow-store.ts` | Frontend pending-question state. |

## Open Questions

None for VU-1145. The clean-break OpenHands migration makes OpenHands the
workflow runtime and moves workflow runtime artifacts to `.agents/**`; remaining
marketplace or imported-skill compatibility questions are outside this runtime
boundary.

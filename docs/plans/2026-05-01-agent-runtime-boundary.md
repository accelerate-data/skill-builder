# Agent Runtime Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Skill Builder-owned sidecar runtime boundary with explicit one-shot and streaming modes while keeping the current Claude Agent SDK behavior unchanged.

**Architecture:** Introduce focused runtime types under `app/sidecar/runtime/`, wrap the existing Claude one-shot path behind `ClaudeRuntime.runOnce`, and make the existing streaming session satisfy the runtime session contract. Keep the sidecar JSONL protocol stable so Rust and React continue consuming `display_item`, `agent_event`, `refine_question`, and `run_result` without OpenHands-specific changes.

**Tech Stack:** TypeScript sidecar, Vitest, Claude Agent SDK, existing Node sidecar JSONL protocol, Tauri/Rust callers.

---

## Scope

This plan implements the first migration milestone from
`docs/design/agent-runtime-boundary/README.md`:

- add the runtime boundary;
- keep Claude behind the boundary;
- enforce that one-shot runs cannot use `AskUserQuestion`;
- make callers and tests distinguish one-shot requests from streaming sessions.

This plan does not add the OpenHands SDK. OpenHands should be implemented after
this plan lands and the Claude adapter provides a passing parity baseline.

## File Structure

- Create `app/sidecar/runtime/types.ts`
  - Runtime request/session/sink interfaces.
  - `isUserQuestionToolName` and `assertOneShotHasNoUserQuestions` helpers.
- Create `app/sidecar/runtime/sink.ts`
  - Converts existing `onMessage(record)` callbacks into a typed `RuntimeSink`.
- Create `app/sidecar/runtime/claude-runtime.ts`
  - Claude runtime adapter that owns `runOnce`.
  - Reuses current `runAgentRequest` internals with minimal movement.
- Modify `app/sidecar/run-agent.ts`
  - Keep the existing exported `runAgentRequest` compatibility function.
  - Delegate to `ClaudeRuntime.runOnce`.
  - Keep plugin discovery helpers exported for streaming until they move later.
- Modify `app/sidecar/stream-session.ts`
  - Implement the runtime `RuntimeSession` interface.
  - Keep `AskUserQuestion` only in the streaming path.
- Modify `app/sidecar/persistent-mode.ts`
  - Continue routing `agent_request` to one-shot and `stream_*` messages to streaming.
  - This file should not call Claude SDK APIs directly.
- Modify `app/sidecar/config.ts`
  - Add optional `mode` validation for explicit sidecar configs.
  - Preserve compatibility when Rust does not send `mode` yet.
- Add/modify tests under `app/sidecar/__tests__/`
  - `runtime-types.test.ts`
  - `runtime-sink.test.ts`
  - update `run-agent.test.ts`
  - update `stream-session.test.ts`
  - update `persistent-mode.test.ts`
  - update `config.test.ts`
- Update docs if the implemented shape differs from
  `docs/design/agent-runtime-boundary/README.md`.

## Task 1: Runtime Types And One-Shot Guard

**Files:**

- Create: `app/sidecar/runtime/types.ts`
- Create: `app/sidecar/__tests__/runtime-types.test.ts`
- Modify: `app/sidecar/config.ts`
- Test: `app/sidecar/__tests__/runtime-types.test.ts`
- Test: `app/sidecar/__tests__/config.test.ts`

- [ ] **Step 1: Write failing tests for runtime request invariants**

Create `app/sidecar/__tests__/runtime-types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assertOneShotHasNoUserQuestions,
  isUserQuestionToolName,
  type OneShotRunRequest,
  type StreamingSessionRequest,
} from "../runtime/types.js";

const baseContext = {
  skillName: "demo-skill",
  pluginSlug: "demo-plugin",
  stepId: 0,
  runSource: "workflow" as const,
};

describe("runtime request types", () => {
  it("recognizes Claude and runtime-neutral user question tool names", () => {
    expect(isUserQuestionToolName("AskUserQuestion")).toBe(true);
    expect(isUserQuestionToolName("ask_user_question")).toBe(true);
    expect(isUserQuestionToolName("Read")).toBe(false);
  });

  it("allows one-shot requests without user-question tools", () => {
    const request: OneShotRunRequest = {
      mode: "one-shot",
      allowUserQuestions: false,
      prompt: "Generate the skill.",
      apiKey: "sk-test",
      workspaceRootDir: "/workspace",
      workspaceSkillDir: "/workspace/plugin/skill",
      allowedTools: ["Read", "Write", "Edit"],
      context: baseContext,
    };

    expect(() => assertOneShotHasNoUserQuestions(request)).not.toThrow();
  });

  it("rejects one-shot requests that include AskUserQuestion", () => {
    const request: OneShotRunRequest = {
      mode: "one-shot",
      allowUserQuestions: false,
      prompt: "Ask before continuing.",
      apiKey: "sk-test",
      workspaceRootDir: "/workspace",
      workspaceSkillDir: "/workspace/plugin/skill",
      allowedTools: ["Read", "AskUserQuestion"],
      context: baseContext,
    };

    expect(() => assertOneShotHasNoUserQuestions(request)).toThrow(
      "one-shot runtime requests cannot include user-question tools: AskUserQuestion",
    );
  });

  it("keeps user questions valid for streaming requests", () => {
    const request: StreamingSessionRequest = {
      mode: "streaming",
      allowUserQuestions: true,
      prompt: "Refine this skill.",
      apiKey: "sk-test",
      workspaceRootDir: "/workspace",
      workspaceSkillDir: "/workspace/plugin/skill",
      allowedTools: ["Read", "AskUserQuestion"],
      context: baseContext,
    };

    expect(request.allowUserQuestions).toBe(true);
    expect(request.mode).toBe("streaming");
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
cd app/sidecar && npx vitest run __tests__/runtime-types.test.ts
```

Expected: FAIL because `../runtime/types.js` does not exist.

- [ ] **Step 3: Add runtime type definitions and guard**

Create `app/sidecar/runtime/types.ts`:

```ts
import type { AgentEvent } from "../agent-events.js";
import type { DisplayItem } from "../display-types.js";

export type RuntimeMode = "one-shot" | "streaming";

export interface RunPersistenceContext {
  skillName?: string;
  stepId?: number;
  workflowSessionId?: string;
  usageSessionId?: string;
  runSource?: "workflow" | "refine" | "test" | "gate-eval";
  workspaceSkillDir?: string;
  pluginSlug: string;
}

export interface RuntimeRequestBase {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  agentName?: string;
  apiKey: string;
  workspaceRootDir: string;
  workspaceSkillDir: string;
  requiredPlugins?: string[];
  allowedTools?: string[];
  settingSources?: ("user" | "project")[];
  maxTurns?: number;
  outputFormat?: {
    type: "json_schema";
    schema: Record<string, unknown>;
  };
  promptSuggestions?: boolean;
  context: RunPersistenceContext;
}

export interface OneShotRunRequest extends RuntimeRequestBase {
  mode: "one-shot";
  allowUserQuestions: false;
}

export interface StreamingSessionRequest extends RuntimeRequestBase {
  mode: "streaming";
  allowUserQuestions: true;
}

export type RuntimeRequest = OneShotRunRequest | StreamingSessionRequest;

export interface RefineQuestion {
  tool_use_id: string;
  questions: unknown[];
  timestamp: number;
}

export interface RuntimeSink {
  emit(message: Record<string, unknown>): void;
  emitDisplayItem(item: DisplayItem): void;
  emitAgentEvent(event: AgentEvent, timestamp?: number): void;
  emitRefineQuestion(question: RefineQuestion): void;
  emitRaw(message: Record<string, unknown>): void;
}

export interface RuntimeSession {
  readonly queryDone: Promise<void>;
  sendUserMessage(requestId: string, message: string): Promise<void> | void;
  answerQuestion(
    requestId: string,
    toolUseId: string,
    questions: unknown[],
    answers: Record<string, unknown>,
  ): Promise<void> | void;
  cancel(): Promise<void> | void;
  close(): Promise<void> | void;
}

export interface AgentRuntime {
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

const USER_QUESTION_TOOL_NAMES = new Set([
  "AskUserQuestion",
  "ask_user_question",
]);

export function isUserQuestionToolName(toolName: string): boolean {
  return USER_QUESTION_TOOL_NAMES.has(toolName);
}

export function assertOneShotHasNoUserQuestions(request: OneShotRunRequest): void {
  const forbiddenTools = (request.allowedTools ?? []).filter(isUserQuestionToolName);
  if (forbiddenTools.length > 0) {
    throw new Error(
      `one-shot runtime requests cannot include user-question tools: ${forbiddenTools.join(", ")}`,
    );
  }
}
```

- [ ] **Step 4: Extend `SidecarConfig` mode validation without requiring Rust changes**

Modify `app/sidecar/config.ts`:

```ts
export interface SidecarConfig {
  mode?: "one-shot" | "streaming";
  prompt: string;
  systemPrompt?: string;
  model?: string;
  agentName?: string;
  apiKey: string;
  workspaceRootDir: string;
  workspaceSkillDir: string;
  requiredPlugins?: string[];
  allowedTools?: string[];
  settingSources?: ('user' | 'project')[];
  maxTurns?: number;
  permissionMode?: string;
  betas?: string[];
  thinking?: { type: "disabled" | "adaptive" | "enabled"; budgetTokens?: number };
  effort?: "low" | "medium" | "high" | "max";
  fallbackModel?: string;
  outputFormat?: {
    type: "json_schema";
    schema: Record<string, unknown>;
  };
  promptSuggestions?: boolean;
  pathToClaudeCodeExecutable?: string;
  skillName?: string;
  stepId?: number;
  workflowSessionId?: string;
  usageSessionId?: string;
  runSource?: "workflow" | "refine" | "test" | "gate-eval";
  pluginSlug: string;
}
```

In `parseSidecarConfig`, add this enum validation beside the existing enum
fields:

```ts
  assertOptStringIn(c, "mode", ["one-shot", "streaming"]);
```

- [ ] **Step 5: Add config validation tests for mode**

In `app/sidecar/__tests__/config.test.ts`, add:

```ts
  it("accepts explicit one-shot mode", () => {
    const result = parseSidecarConfig({
      prompt: "hello",
      apiKey: "key",
      workspaceRootDir: TEST_CWD,
      workspaceSkillDir: TEST_CWD,
      pluginSlug: "demo",
      mode: "one-shot",
    });

    expect(result.mode).toBe("one-shot");
  });

  it("throws when mode is invalid", () => {
    expect(() =>
      parseSidecarConfig({
        prompt: "hello",
        apiKey: "key",
        workspaceRootDir: TEST_CWD,
        workspaceSkillDir: TEST_CWD,
        pluginSlug: "demo",
        mode: "interactive",
      }),
    ).toThrow("mode must be one of");
  });
```

- [ ] **Step 6: Run tests for Task 1**

Run:

```bash
cd app/sidecar && npx vitest run __tests__/runtime-types.test.ts __tests__/config.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add app/sidecar/runtime/types.ts app/sidecar/__tests__/runtime-types.test.ts app/sidecar/config.ts app/sidecar/__tests__/config.test.ts
git commit -m "Add sidecar runtime request types"
```

## Task 2: Runtime Sink Adapter

**Files:**

- Create: `app/sidecar/runtime/sink.ts`
- Create: `app/sidecar/__tests__/runtime-sink.test.ts`
- Test: `app/sidecar/__tests__/runtime-sink.test.ts`

- [ ] **Step 1: Write failing tests for record sink behavior**

Create `app/sidecar/__tests__/runtime-sink.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createRecordRuntimeSink } from "../runtime/sink.js";
import type { DisplayItem } from "../display-types.js";

describe("createRecordRuntimeSink", () => {
  it("emits display items in the existing sidecar envelope", () => {
    const messages: Record<string, unknown>[] = [];
    const sink = createRecordRuntimeSink((message) => messages.push(message));

    const item: DisplayItem = {
      id: "di-1",
      type: "output",
      content: "hello",
      timestamp: 123,
    };

    sink.emitDisplayItem(item);

    expect(messages).toEqual([{ type: "display_item", item }]);
  });

  it("emits agent events in the existing sidecar envelope", () => {
    const messages: Record<string, unknown>[] = [];
    const sink = createRecordRuntimeSink((message) => messages.push(message));

    sink.emitAgentEvent({ type: "turn_complete", turn: 1, streaming: false }, 456);

    expect(messages).toEqual([
      {
        type: "agent_event",
        event: { type: "turn_complete", turn: 1, streaming: false },
        timestamp: 456,
      },
    ]);
  });

  it("emits refine questions in the existing sidecar envelope", () => {
    const messages: Record<string, unknown>[] = [];
    const sink = createRecordRuntimeSink((message) => messages.push(message));

    sink.emitRefineQuestion({
      tool_use_id: "toolu-1",
      questions: [{ id: "q1", question: "Pick one" }],
      timestamp: 789,
    });

    expect(messages).toEqual([
      {
        type: "refine_question",
        tool_use_id: "toolu-1",
        questions: [{ id: "q1", question: "Pick one" }],
        timestamp: 789,
      },
    ]);
  });

  it("passes raw messages through unchanged", () => {
    const messages: Record<string, unknown>[] = [];
    const sink = createRecordRuntimeSink((message) => messages.push(message));

    sink.emitRaw({ type: "system", subtype: "init_start" });

    expect(messages).toEqual([{ type: "system", subtype: "init_start" }]);
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
cd app/sidecar && npx vitest run __tests__/runtime-sink.test.ts
```

Expected: FAIL because `../runtime/sink.js` does not exist.

- [ ] **Step 3: Implement the sink adapter**

Create `app/sidecar/runtime/sink.ts`:

```ts
import type { AgentEvent } from "../agent-events.js";
import type { DisplayItem } from "../display-types.js";
import type { RefineQuestion, RuntimeSink } from "./types.js";

export function createRecordRuntimeSink(
  emit: (message: Record<string, unknown>) => void,
): RuntimeSink {
  return {
    emit(message) {
      emit(message);
    },

    emitDisplayItem(item: DisplayItem) {
      emit({ type: "display_item", item });
    },

    emitAgentEvent(event: AgentEvent, timestamp = Date.now()) {
      emit({ type: "agent_event", event, timestamp });
    },

    emitRefineQuestion(question: RefineQuestion) {
      emit({
        type: "refine_question",
        tool_use_id: question.tool_use_id,
        questions: question.questions,
        timestamp: question.timestamp,
      });
    },

    emitRaw(message: Record<string, unknown>) {
      emit(message);
    },
  };
}
```

- [ ] **Step 4: Run tests for Task 2**

Run:

```bash
cd app/sidecar && npx vitest run __tests__/runtime-sink.test.ts __tests__/runtime-types.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add app/sidecar/runtime/sink.ts app/sidecar/__tests__/runtime-sink.test.ts
git commit -m "Add sidecar runtime sink adapter"
```

## Task 3: Claude One-Shot Runtime Adapter

**Files:**

- Create: `app/sidecar/runtime/claude-runtime.ts`
- Modify: `app/sidecar/run-agent.ts`
- Modify: `app/sidecar/__tests__/run-agent.test.ts`
- Create or modify: `app/sidecar/__tests__/claude-runtime.test.ts`
- Test: `app/sidecar/__tests__/run-agent.test.ts`
- Test: `app/sidecar/__tests__/claude-runtime.test.ts`

- [ ] **Step 1: Write failing tests for one-shot guard through `runAgentRequest`**

Add to `app/sidecar/__tests__/run-agent.test.ts`:

```ts
  it("rejects one-shot requests that include AskUserQuestion", async () => {
    const messages: Record<string, unknown>[] = [];

    await runAgentRequest(
      {
        ...baseConfig,
        mode: "one-shot",
        allowedTools: ["Read", "AskUserQuestion"],
      },
      (message) => messages.push(message),
    );

    const runResult = messages.find(
      (message) =>
        message.type === "agent_event" &&
        (message.event as Record<string, unknown> | undefined)?.type === "run_result",
    );

    expect(query).not.toHaveBeenCalled();
    expect(runResult).toBeDefined();
    expect((runResult!.event as Record<string, unknown>).status).toBe("error");
    expect(JSON.stringify(runResult)).toContain(
      "one-shot runtime requests cannot include user-question tools",
    );
  });
```

If `baseConfig` is not visible in the test file, create it near the other test
fixtures with the same fields existing tests already use:

```ts
const baseConfig: SidecarConfig = {
  prompt: "hello",
  apiKey: "sk-test",
  workspaceRootDir: "/workspace",
  workspaceSkillDir: "/workspace/demo-plugin/demo-skill",
  pluginSlug: "demo-plugin",
};
```

- [ ] **Step 2: Run the one-shot guard test and verify it fails**

Run:

```bash
cd app/sidecar && npx vitest run __tests__/run-agent.test.ts -t "rejects one-shot requests"
```

Expected: FAIL because `runAgentRequest` does not enforce the new runtime
boundary invariant.

- [ ] **Step 3: Add `ClaudeRuntime.runOnce`**

Create `app/sidecar/runtime/claude-runtime.ts` by moving the current body of
`runAgentRequest` into a runtime adapter. Keep imports exactly focused on the
Claude implementation:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SidecarConfig } from "../config.js";
import { runMockAgent } from "../mock-agent.js";
import { buildQueryOptions } from "../options.js";
import { createAbortState, linkExternalSignal } from "../shutdown.js";
import { MessageProcessor } from "../message-processor.js";
import { ResultGate } from "../result-gate.js";
import {
  assertOneShotHasNoUserQuestions,
  type AgentRuntime,
  type OneShotRunRequest,
  type RuntimeSink,
  type StreamingSessionRequest,
  type RuntimeSession,
} from "./types.js";
import { StreamSession } from "../stream-session.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function discoverInstalledPlugins(rootDir: string): Promise<string[]> {
  const pluginsDir = path.join(rootDir, ".claude", "plugins");
  try {
    const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(pluginsDir, entry.name));
  } catch {
    return [];
  }
}

export function selectPluginPaths(
  discoveredPluginPaths: string[],
  requiredPlugins?: string[],
): string[] {
  if (!requiredPlugins || requiredPlugins.length === 0) {
    return [];
  }

  const discoveredByName = new Map(
    discoveredPluginPaths.map((pluginPath) => [path.basename(pluginPath), pluginPath] as const),
  );

  return requiredPlugins
    .map((pluginName) => discoveredByName.get(pluginName))
    .filter((pluginPath): pluginPath is string => typeof pluginPath === "string");
}

export function emitSystemEvent(
  sink: RuntimeSink,
  subtype: string,
): void {
  sink.emitRaw({ type: "system", subtype, timestamp: Date.now() });
}

export function toOneShotRunRequest(config: SidecarConfig): OneShotRunRequest {
  return {
    mode: "one-shot",
    allowUserQuestions: false,
    prompt: config.prompt,
    systemPrompt: config.systemPrompt,
    model: config.model,
    agentName: config.agentName,
    apiKey: config.apiKey,
    workspaceRootDir: config.workspaceRootDir,
    workspaceSkillDir: config.workspaceSkillDir,
    requiredPlugins: config.requiredPlugins,
    allowedTools: config.allowedTools,
    settingSources: config.settingSources,
    maxTurns: config.maxTurns,
    outputFormat: config.outputFormat,
    promptSuggestions: config.promptSuggestions,
    context: {
      skillName: config.skillName,
      stepId: config.stepId,
      workflowSessionId: config.workflowSessionId,
      usageSessionId: config.usageSessionId,
      runSource: config.runSource,
      workspaceSkillDir: config.workspaceSkillDir,
      pluginSlug: config.pluginSlug,
    },
  };
}

export function toClaudeSidecarConfig(request: OneShotRunRequest | StreamingSessionRequest): SidecarConfig {
  return {
    prompt: request.prompt,
    systemPrompt: request.systemPrompt,
    model: request.model,
    agentName: request.agentName,
    apiKey: request.apiKey,
    workspaceRootDir: request.workspaceRootDir,
    workspaceSkillDir: request.workspaceSkillDir,
    requiredPlugins: request.requiredPlugins,
    allowedTools: request.allowedTools,
    settingSources: request.settingSources,
    maxTurns: request.maxTurns,
    outputFormat: request.outputFormat,
    promptSuggestions: request.promptSuggestions,
    skillName: request.context.skillName,
    stepId: request.context.stepId,
    workflowSessionId: request.context.workflowSessionId,
    usageSessionId: request.context.usageSessionId,
    runSource: request.context.runSource,
    pluginSlug: request.context.pluginSlug,
  };
}

export class ClaudeRuntime implements AgentRuntime {
  async runOnce(
    request: OneShotRunRequest,
    sink: RuntimeSink,
    externalSignal?: AbortSignal,
  ): Promise<void> {
    assertOneShotHasNoUserQuestions(request);
    const config = toClaudeSidecarConfig(request);

    if (process.env.MOCK_AGENTS === "true") {
      process.stderr.write("[sidecar] Mock agent mode\n");
      return runMockAgent(config, (message) => sink.emitRaw(message), externalSignal);
    }

    const state = createAbortState();
    if (externalSignal) {
      linkExternalSignal(state, externalSignal);
    }

    const discoveredPluginPaths = await discoverInstalledPlugins(config.workspaceRootDir);
    const pluginPaths = selectPluginPaths(discoveredPluginPaths, config.requiredPlugins);

    const stderrHandler = (data: string) => {
      sink.emitRaw({
        type: "system",
        subtype: "sdk_stderr",
        data: data.trimEnd(),
        timestamp: Date.now(),
      });
    };

    const processorRef: { current: MessageProcessor | null } = { current: null };
    const processor = new MessageProcessor({
      skillName: config.skillName,
      stepId: config.stepId,
      workflowSessionId: config.workflowSessionId,
      usageSessionId: config.usageSessionId,
      runSource: config.runSource,
      workspaceSkillDir: config.workspaceSkillDir,
      pluginSlug: config.pluginSlug,
      hasOutputFormat: config.outputFormat != null,
    });
    processorRef.current = processor;

    const options = buildQueryOptions(config, state.abortController, pluginPaths, stderrHandler, processorRef);
    const gate = new ResultGate(processor);

    const pluginsToLog = (options as Record<string, unknown>).plugins as unknown[] | undefined;
    sink.emitRaw({
      type: "system",
      subtype: "sdk_plugins_debug",
      plugins: pluginsToLog ?? [],
      timestamp: Date.now(),
    });

    emitSystemEvent(sink, "init_start");

    try {
      process.stderr.write("[sidecar] Starting SDK query\n");
      const conversation = query({
        prompt: config.prompt,
        options,
      });

      let sdkReadyEmitted = false;
      for await (const message of conversation) {
        if (state.abortController.signal.aborted) break;

        if (!sdkReadyEmitted) {
          emitSystemEvent(sink, "sdk_ready");
          sdkReadyEmitted = true;
        }

        const raw = message as Record<string, unknown>;

        if (raw.type === "prompt_suggestion" && typeof raw.suggestion === "string") {
          sink.emitAgentEvent({
            type: "prompt_suggestion",
            suggestion: raw.suggestion,
          });
          continue;
        }

        const items = processor.process(raw);
        for (const item of items) {
          gate.emit(item as Record<string, unknown>, (message) => sink.emitRaw(message));
        }
        gate.tryFlush((message) => sink.emitRaw(message));
      }

      gate.flush((message) => sink.emitRaw(message));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (state.abortController.signal.aborted) {
        process.stderr.write("[sidecar] Query stream aborted during iteration\n");
      } else {
        process.stderr.write(`[sidecar] Query stream failed: ${errorMessage}\n`);

        const errorItems = processor.process({
          type: "error",
          message: errorMessage,
        });
        for (const item of errorItems) {
          sink.emitRaw(item as Record<string, unknown>);
        }

        const [errorSummary, orphanedErr] = processor.buildExecutionErrorSummary(errorMessage);
        for (const item of orphanedErr) {
          sink.emitRaw(item as Record<string, unknown>);
        }
        sink.emitAgentEvent(errorSummary);
        return;
      }
    }

    if (state.abortController.signal.aborted) {
      process.stderr.write("[sidecar] Run aborted — emitting shutdown run_result\n");
      const [shutdownSummary, orphanedAbort] = processor.buildShutdownSummary();
      for (const item of orphanedAbort) {
        sink.emitRaw(item as Record<string, unknown>);
      }
      sink.emitAgentEvent(shutdownSummary);
    }

    if (!processor.hasEmittedResult() && !state.abortController.signal.aborted) {
      process.stderr.write("[sidecar] SDK completed without result — emitting error run_result\n");
      const [errorSummary, orphanedNoResult] = processor.buildExecutionErrorSummary(
        "Agent ended without producing a result",
      );
      for (const item of orphanedNoResult) {
        sink.emitRaw(item as Record<string, unknown>);
      }
      sink.emitAgentEvent(errorSummary);
    }
  }

  startStreamingSession(
    request: StreamingSessionRequest,
    sink: RuntimeSink,
  ): RuntimeSession {
    const config = toClaudeSidecarConfig(request);
    return new StreamSession(
      request.context.workflowSessionId ?? "stream-session",
      "stream-start",
      config,
      (_requestId, message) => sink.emitRaw(message),
    );
  }
}
```

After adding this file, run TypeScript once before continuing. If the
`startStreamingSession` constructor mismatch causes a compile error, leave the
method unimplemented for this task:

```ts
  startStreamingSession(): RuntimeSession {
    throw new Error("Claude streaming sessions are wired through StreamSession until Task 4");
  }
```

Task 4 wires streaming cleanly.

- [ ] **Step 4: Make `runAgentRequest` delegate to `ClaudeRuntime.runOnce`**

Replace the implementation of `app/sidecar/run-agent.ts` with a thin
compatibility wrapper:

```ts
import type { SidecarConfig } from "./config.js";
import {
  ClaudeRuntime,
  discoverInstalledPlugins,
  emitSystemEvent,
  selectPluginPaths,
  toOneShotRunRequest,
} from "./runtime/claude-runtime.js";
import { createRecordRuntimeSink } from "./runtime/sink.js";

export { discoverInstalledPlugins, emitSystemEvent, selectPluginPaths };

export async function runAgentRequest(
  config: SidecarConfig,
  onMessage: (message: Record<string, unknown>) => void,
  externalSignal?: AbortSignal,
): Promise<void> {
  const runtime = new ClaudeRuntime();
  const sink = createRecordRuntimeSink(onMessage);

  try {
    await runtime.runOnce(toOneShotRunRequest(config), sink, externalSignal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sink.emitRaw({ type: "error", message });
    sink.emitAgentEvent({
      type: "run_result",
      status: "error",
      subtype: "execution_error",
      errorSubtype: "runtime_validation",
      errors: [message],
      result: "",
      sessionId: "unknown",
      model: config.model ?? "unknown",
      totalCostUsd: 0,
      durationMs: 0,
      durationApiMs: 0,
      numTurns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      toolUseCount: 0,
      compactionCount: 0,
      contextWindow: 0,
      modelUsageBreakdown: [],
    });
  }
}
```

If `RunResultEvent` has different required fields in
`app/sidecar/agent-events.ts`, use that type as the source of truth and include
all required fields in the synthetic error event.

- [ ] **Step 5: Run one-shot tests**

Run:

```bash
cd app/sidecar && npx vitest run __tests__/run-agent.test.ts __tests__/runtime-types.test.ts __tests__/runtime-sink.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run all sidecar tests**

Run:

```bash
cd app/sidecar && npx vitest run
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add app/sidecar/runtime/claude-runtime.ts app/sidecar/run-agent.ts app/sidecar/__tests__/run-agent.test.ts
git commit -m "Wrap Claude one-shot runtime"
```

## Task 4: Streaming Session Runtime Contract

**Files:**

- Modify: `app/sidecar/stream-session.ts`
- Modify: `app/sidecar/runtime/claude-runtime.ts`
- Modify: `app/sidecar/__tests__/stream-session.test.ts`
- Test: `app/sidecar/__tests__/stream-session.test.ts`
- Test: `app/sidecar/__tests__/persistent-mode.test.ts`

- [ ] **Step 1: Write failing test for runtime-session method aliases**

Add to `app/sidecar/__tests__/stream-session.test.ts`:

```ts
  it("exposes runtime session methods for message, answer, cancel, and close", () => {
    const session = new StreamSession(
      "session-runtime",
      "req-start",
      baseConfig,
      vi.fn(),
    );

    expect(typeof session.sendUserMessage).toBe("function");
    expect(typeof session.answerQuestion).toBe("function");
    expect(typeof session.cancel).toBe("function");
    expect(typeof session.close).toBe("function");

    session.close();
  });
```

If `baseConfig` does not exist in the file, define it using the same shape as
the existing stream-session fixtures:

```ts
const baseConfig: SidecarConfig = {
  prompt: "hello",
  apiKey: "sk-test",
  workspaceRootDir: "/workspace",
  workspaceSkillDir: "/workspace/demo-plugin/demo-skill",
  pluginSlug: "demo-plugin",
};
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd app/sidecar && npx vitest run __tests__/stream-session.test.ts -t "exposes runtime session methods"
```

Expected: FAIL because `sendUserMessage` and `cancel` do not exist.

- [ ] **Step 3: Make `StreamSession` implement `RuntimeSession`**

Modify the imports and class declaration in `app/sidecar/stream-session.ts`:

```ts
import type { RuntimeSession } from "./runtime/types.js";

export class StreamSession implements RuntimeSession {
```

Add method aliases inside the class:

```ts
  sendUserMessage(requestId: string, message: string): void {
    this.pushMessage(requestId, message);
  }

  cancel(): void {
    this.cancelTurn();
  }
```

Keep the existing `answerQuestion` and `close` methods unchanged. They already
match the runtime-session behavior.

- [ ] **Step 4: Add a clean streaming factory to `ClaudeRuntime`**

In `app/sidecar/runtime/claude-runtime.ts`, replace any temporary
`startStreamingSession` implementation with:

```ts
export function toStreamingSessionRequest(config: SidecarConfig): StreamingSessionRequest {
  return {
    mode: "streaming",
    allowUserQuestions: true,
    prompt: config.prompt,
    systemPrompt: config.systemPrompt,
    model: config.model,
    agentName: config.agentName,
    apiKey: config.apiKey,
    workspaceRootDir: config.workspaceRootDir,
    workspaceSkillDir: config.workspaceSkillDir,
    requiredPlugins: config.requiredPlugins,
    allowedTools: config.allowedTools,
    settingSources: config.settingSources,
    maxTurns: config.maxTurns,
    outputFormat: config.outputFormat,
    promptSuggestions: config.promptSuggestions,
    context: {
      skillName: config.skillName,
      stepId: config.stepId,
      workflowSessionId: config.workflowSessionId,
      usageSessionId: config.usageSessionId,
      runSource: config.runSource,
      workspaceSkillDir: config.workspaceSkillDir,
      pluginSlug: config.pluginSlug,
    },
  };
}

  startStreamingSession(
    request: StreamingSessionRequest,
    sink: RuntimeSink,
    sessionId = request.context.workflowSessionId ?? "stream-session",
    firstRequestId = "stream-start",
  ): RuntimeSession {
    const config = toClaudeSidecarConfig(request);
    return new StreamSession(
      sessionId,
      firstRequestId,
      config,
      (_requestId, message) => sink.emitRaw(message),
    );
  }
```

If the TypeScript class method cannot accept optional `sessionId` and
`firstRequestId` while satisfying `AgentRuntime`, add a second method instead:

```ts
  createStreamingSession(
    request: StreamingSessionRequest,
    sink: RuntimeSink,
    sessionId: string,
    firstRequestId: string,
  ): RuntimeSession {
    const config = toClaudeSidecarConfig(request);
    return new StreamSession(
      sessionId,
      firstRequestId,
      config,
      (_requestId, message) => sink.emitRaw(message),
    );
  }
```

Use `createStreamingSession` from `persistent-mode.ts` in Task 5.

- [ ] **Step 5: Run streaming tests**

Run:

```bash
cd app/sidecar && npx vitest run __tests__/stream-session.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add app/sidecar/stream-session.ts app/sidecar/runtime/claude-runtime.ts app/sidecar/__tests__/stream-session.test.ts
git commit -m "Expose streaming runtime session contract"
```

## Task 5: Persistent Mode Chooses Runtime Mode Explicitly

**Files:**

- Modify: `app/sidecar/persistent-mode.ts`
- Modify: `app/sidecar/__tests__/persistent-mode.test.ts`
- Test: `app/sidecar/__tests__/persistent-mode.test.ts`

- [ ] **Step 1: Write failing tests for explicit mode defaults**

Add to `app/sidecar/__tests__/persistent-mode.test.ts`:

```ts
  it("treats agent_request as one-shot mode when mode is omitted", async () => {
    const input = makeInput([
      {
        type: "agent_request",
        request_id: "req-one-shot",
        config: {
          prompt: "hello",
          apiKey: "sk-test",
          workspaceRootDir: "/workspace",
          workspaceSkillDir: "/workspace/demo-plugin/demo-skill",
          pluginSlug: "demo-plugin",
        },
      },
      { type: "shutdown" },
    ]);

    const output = await runPersistentForTest(input);
    expect(output.some((line) => line.includes("req-one-shot"))).toBe(true);
  });

  it("rejects agent_request configs that explicitly ask for streaming mode", async () => {
    const input = makeInput([
      {
        type: "agent_request",
        request_id: "req-bad-mode",
        config: {
          mode: "streaming",
          prompt: "hello",
          apiKey: "sk-test",
          workspaceRootDir: "/workspace",
          workspaceSkillDir: "/workspace/demo-plugin/demo-skill",
          pluginSlug: "demo-plugin",
        },
      },
      { type: "shutdown" },
    ]);

    const output = await runPersistentForTest(input);
    expect(output.join("\n")).toContain("agent_request requires one-shot mode");
  });

  it("rejects stream_start configs that explicitly ask for one-shot mode", async () => {
    const input = makeInput([
      {
        type: "stream_start",
        request_id: "req-bad-stream-mode",
        session_id: "session-1",
        config: {
          mode: "one-shot",
          prompt: "hello",
          apiKey: "sk-test",
          workspaceRootDir: "/workspace",
          workspaceSkillDir: "/workspace/demo-plugin/demo-skill",
          pluginSlug: "demo-plugin",
        },
      },
      { type: "shutdown" },
    ]);

    const output = await runPersistentForTest(input);
    expect(output.join("\n")).toContain("stream_start requires streaming mode");
  });
```

If `makeInput` or `runPersistentForTest` helpers have different local names,
use the existing helper names in the file and keep the assertion strings the
same.

- [ ] **Step 2: Run tests and verify new mode tests fail**

Run:

```bash
cd app/sidecar && npx vitest run __tests__/persistent-mode.test.ts -t "mode"
```

Expected: at least the explicit-mode rejection tests FAIL because
`persistent-mode.ts` does not enforce mode-specific request types yet.

- [ ] **Step 3: Route through `ClaudeRuntime` in persistent mode**

Modify imports in `app/sidecar/persistent-mode.ts`:

```ts
import { type SidecarConfig, parseSidecarConfig } from "./config.js";
import {
  ClaudeRuntime,
  toOneShotRunRequest,
  toStreamingSessionRequest,
} from "./runtime/claude-runtime.js";
import { createRecordRuntimeSink } from "./runtime/sink.js";
import { StreamSession } from "./stream-session.js";
```

Add a runtime instance near the active request state:

```ts
  const runtime = new ClaudeRuntime();
```

In the `stream_start` branch, before creating a session:

```ts
      if (config.mode === "one-shot") {
        writeLine(
          wrapWithRequestId(request_id, {
            type: "error",
            message: "stream_start requires streaming mode",
          }),
        );
        continue;
      }
```

Keep the direct `new StreamSession(...)` for this task if the runtime streaming
factory would make the diff too large. The important invariant is that stream
requests are streaming-mode requests.

In the `agent_request` branch, before starting the request promise:

```ts
      if (config.mode === "streaming") {
        writeLine(
          wrapWithRequestId(request_id, {
            type: "error",
            message: "agent_request requires one-shot mode",
          }),
        );
        continue;
      }
```

Then replace the `runAgentRequest` call inside the request promise:

```ts
          await runtime.runOnce(
            toOneShotRunRequest({ ...config, mode: "one-shot" }),
            createRecordRuntimeSink((msg) => {
              writeLine(wrapWithRequestId(request_id, msg));
            }),
            abortController.signal,
          );
```

Remove the `runAgentRequest` import after this compiles.

- [ ] **Step 4: Run persistent-mode tests**

Run:

```bash
cd app/sidecar && npx vitest run __tests__/persistent-mode.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run sidecar tests**

Run:

```bash
cd app/sidecar && npx vitest run
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add app/sidecar/persistent-mode.ts app/sidecar/__tests__/persistent-mode.test.ts
git commit -m "Route persistent mode through runtime boundary"
```

## Task 6: Rust Config Carries Runtime Mode Deliberately

**Files:**

- Modify: `app/src-tauri/src/agents/sidecar.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/commands/refine/protocol.rs`
- Modify if needed: `app/src-tauri/src/commands/agent.rs`
- Test: Rust tests for `agents::sidecar`, `commands::workflow`, and `commands::refine`

- [ ] **Step 1: Write failing Rust serialization test for `mode`**

In `app/src-tauri/src/agents/sidecar.rs`, add or update a test so a serialized
one-shot config includes `"mode":"one-shot"`:

```rust
#[test]
fn serializes_sidecar_config_mode() {
    let config = SidecarConfig {
        mode: Some("one-shot".to_string()),
        prompt: "hello".to_string(),
        system_prompt: None,
        model: Some("claude-sonnet-4-6".to_string()),
        api_key: SecretString::new("sk-test".to_string()),
        workspace_root_dir: "/workspace".to_string(),
        workspace_skill_dir: "/workspace/demo-plugin/demo-skill".to_string(),
        allowed_tools: Some(vec!["Read".to_string()]),
        max_turns: Some(10),
        permission_mode: Some("bypassPermissions".to_string()),
        betas: None,
        thinking: None,
        fallback_model: None,
        effort: None,
        output_format: None,
        prompt_suggestions: None,
        path_to_claude_code_executable: None,
        agent_name: None,
        required_plugins: None,
        setting_sources: None,
        conversation_history: None,
        skill_name: Some("demo-skill".to_string()),
        step_id: Some(0),
        workflow_session_id: Some("workflow-1".to_string()),
        usage_session_id: None,
        run_source: Some("workflow".to_string()),
        transcript_log_dir: None,
        plugin_slug: "demo-plugin".to_string(),
    };

    let json = serde_json::to_value(&config).unwrap();
    assert_eq!(json["mode"], "one-shot");
}
```

If `SecretString::new` has a different constructor, use the constructor already
used by nearby tests in `sidecar.rs`.

- [ ] **Step 2: Run the Rust sidecar test and verify it fails**

Run:

```bash
cd app/src-tauri && cargo test agents::sidecar::serializes_sidecar_config_mode
```

Expected: FAIL because `SidecarConfig` does not have `mode`.

- [ ] **Step 3: Add `mode` to Rust `SidecarConfig`**

In `app/src-tauri/src/agents/sidecar.rs`, add:

```rust
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
```

Place it near `prompt` so JSON config readers see mode before runtime-specific
fields.

Update all `SidecarConfig` construction sites touched by compiler errors:

```rust
mode: Some("one-shot".to_string()),
```

for `agent_request` flows, and:

```rust
mode: Some("streaming".to_string()),
```

for `stream_start` flows.

Expected locations include:

- `app/src-tauri/src/commands/workflow/runtime.rs`
- `app/src-tauri/src/commands/refine/protocol.rs`
- `app/src-tauri/src/commands/agent.rs`
- `app/src-tauri/src/commands/description/eval.rs`
- tests that construct `SidecarConfig` directly.

- [ ] **Step 4: Classify workflow and refine calls**

Apply these mode rules:

- `stream_start` calls in workflow runtime: `mode: Some("streaming".to_string())`
- refine chat calls: `mode: Some("streaming".to_string())`
- direct `start_agent` calls: `mode: Some("one-shot".to_string())`
- description eval/improve subruns: `mode: Some("one-shot".to_string())`

Do not remove `AskUserQuestion` from workflow streaming step tool lists in this
task. That behavior remains valid for streaming.

- [ ] **Step 5: Run Rust tests for changed command areas**

Run:

```bash
cd app/src-tauri && cargo test agents::sidecar commands::workflow commands::refine commands::agent commands::description
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

Run:

```bash
git add app/src-tauri/src/agents/sidecar.rs app/src-tauri/src/commands/workflow/runtime.rs app/src-tauri/src/commands/refine/protocol.rs app/src-tauri/src/commands/agent.rs app/src-tauri/src/commands/description
git commit -m "Send explicit runtime modes from Rust"
```

## Task 7: Boundary Documentation And Repo Map Audit

**Files:**

- Modify: `docs/design/agent-runtime-boundary/README.md`
- Modify if needed: `docs/design/sdk-agent-options/README.md`
- Modify if needed: `repo-map.json`
- Test: markdownlint and repo-map audit checks from `AGENTS.md`

- [ ] **Step 1: Update design doc if implementation names differ**

If the implemented files use different names than the design doc, update
`docs/design/agent-runtime-boundary/README.md` so the `Key Source Files`
section names the real files. For example, keep this entry if the plan is
followed:

```markdown
| `app/sidecar/runtime/claude-runtime.ts` | Claude runtime adapter for one-shot and streaming-session boundary methods. |
```

- [ ] **Step 2: Update `repo-map.json` if the sidecar module description is stale**

If `repo-map.json` still describes the sidecar as directly calling SDK
`query()` from `run-agent.ts`, update the `app/sidecar` description to include:

```json
"runtime/ (runtime boundary types, sink adapter, and Claude runtime adapter)"
```

Keep the update surgical. Do not rewrite unrelated repo-map sections.

- [ ] **Step 3: Run markdownlint for changed docs**

Run:

```bash
npx markdownlint docs/design/agent-runtime-boundary/README.md docs/design/sdk-agent-options/README.md
```

Expected: PASS. If `sdk-agent-options/README.md` was not modified, omit it
from the command.

- [ ] **Step 4: Run repo-map audit commands from AGENTS.md**

Run:

```bash
find app/src-tauri/src/commands -maxdepth 1 -type f -name '*.rs' -print | sort
find app/src-tauri/src/commands/workflow -maxdepth 1 -type f -name '*.rs' -print | sort
find app/src-tauri/src/commands/imported_skills -maxdepth 1 -type f -name '*.rs' -print | sort
find app/src-tauri/src/commands/github_import -maxdepth 1 -type f -name '*.rs' -print | sort
find app/src/stores -maxdepth 1 -type f -name '*.ts' ! -name 'index.ts' -print | sort
find app/src/pages -maxdepth 1 -type f -print | sort
```

Expected: The listed files match `repo-map.json`. If they do not, update only
the stale entries caused or revealed by this work.

- [ ] **Step 5: Commit Task 7**

Run:

```bash
git add docs/design/agent-runtime-boundary/README.md docs/design/sdk-agent-options/README.md repo-map.json
git commit -m "Document sidecar runtime boundary implementation"
```

If only one or two files changed, stage only those paths.

## Task 8: Final Verification

**Files:**

- No new source files.
- Verify the whole boundary refactor.

- [ ] **Step 1: Run all sidecar tests**

Run:

```bash
cd app/sidecar && npx vitest run
```

Expected: PASS.

- [ ] **Step 2: Run structural agent tests because sidecar runtime behavior changed**

Run:

```bash
cd app && npm run test:agents:structural
```

Expected: PASS.

- [ ] **Step 3: Run frontend unit tests required by AGENTS.md for `app/src/**` only if frontend files changed**

If no `app/src/**` files changed, skip this step and record that it was not
applicable. If frontend files changed, run:

```bash
cd app && npm run test:unit
```

Expected: PASS.

- [ ] **Step 4: Run Rust tests for changed Rust modules**

Run:

```bash
cd app/src-tauri && cargo test agents::sidecar commands::workflow commands::refine commands::agent commands::description
```

Expected: PASS.

- [ ] **Step 5: Build the sidecar**

Run:

```bash
cd app && npm run sidecar:build
```

Expected: PASS and `app/sidecar/dist/` is rebuilt.

- [ ] **Step 6: Confirm no live API smoke test was run**

Do not run:

```bash
cd app && npm run test:agents:smoke
```

Expected: The final handoff tells the user that live agent smoke tests were not
run because repo guidance says not to run them autonomously.

- [ ] **Step 7: Check for verification-only changes**

Run:

```bash
git status --short
```

Expected: no uncommitted changes. If verification produced changes, stop and
inspect them before creating a follow-up commit with exact file paths.

## Follow-Up Plan Boundary

After this plan lands, write a separate OpenHands implementation plan that uses
the new `AgentRuntime` boundary. That follow-up should cover:

- adding the OpenHands SDK dependency;
- creating `app/sidecar/runtime/openhands-runtime.ts`;
- mapping OpenHands events into `RuntimeSink`;
- implementing the app-owned question tool for streaming sessions;
- replacing Claude-only settings and packaging behavior.

Do not add those changes to this first boundary refactor.

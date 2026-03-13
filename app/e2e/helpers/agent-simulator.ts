/**
 * Agent lifecycle simulator for Playwright E2E tests.
 *
 * Dispatches Tauri events through `window.__TAURI_EVENT_HANDLERS__`
 * so the UI reacts through its existing Zustand stores exactly as it
 * would with a real agent sidecar.
 *
 * All simulators emit DisplayItem-based events (type=display_item).
 * Legacy assistant-message format is not supported.
 */
import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Types — mirror the payload shapes from use-agent-stream.ts
// ---------------------------------------------------------------------------

interface AgentInitProgressPayload {
  agent_id: string;
  stage: string;
  timestamp: number;
}

interface AgentInitErrorPayload {
  error_type: string;
  message: string;
  fix_hint: string;
}

interface AgentExitPayload {
  agent_id: string;
  success: boolean;
}

// ---------------------------------------------------------------------------
// Low-level event emitter
// ---------------------------------------------------------------------------

/**
 * Dispatch a Tauri event into the browser context.
 * Calls all handlers registered under `eventName` in `window.__TAURI_EVENT_HANDLERS__`.
 */
export async function emitTauriEvent(
  page: Page,
  eventName: string,
  payload: unknown,
): Promise<void> {
  await page.evaluate(
    ({ eventName, payload }) => {
      const handlers = (
        window as unknown as { __TAURI_EVENT_HANDLERS__: Map<string, Set<(e: { payload: unknown }) => void>> }
      ).__TAURI_EVENT_HANDLERS__;
      if (!handlers) return;
      const set = handlers.get(eventName);
      if (!set) return;
      for (const handler of set) {
        handler({ payload });
      }
    },
    { eventName, payload },
  );
}

// ---------------------------------------------------------------------------
// DisplayItem payload type (mirrors sidecar display-types.ts)
// ---------------------------------------------------------------------------

interface DisplayItemPayload {
  id: string;
  type: string;
  timestamp: number;
  thinkingText?: string;
  outputText?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  toolStatus?: string;
  toolSummary?: string;
  toolDurationMs?: number;
  toolResult?: { content: string; isError: boolean };
  errorMessage?: string;
  outputText_result?: string;
  resultStatus?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// High-level simulators
// ---------------------------------------------------------------------------

interface SimulateAgentRunOptions {
  agentId: string;
  /** Text content for each output display item. Defaults to a single generic message. */
  messages?: string[];
  /** Result text for the final result display item. */
  result?: string;
  /** Delay in ms between events. Defaults to 50. */
  delays?: number;
}

/**
 * Simulate a complete happy-path agent run using DisplayItems:
 * 1. agent-init-progress (init_start)
 * 2. agent-init-progress (sdk_ready)
 * 3. N agent-message events (type=display_item, item.type=output)
 * 4. agent-message (type=display_item, item.type=result)
 * 5. agent-message (type=result) — pass-through for usage tracking
 * 6. agent-exit (success=true)
 */
export async function simulateAgentRun(
  page: Page,
  options: SimulateAgentRunOptions,
): Promise<void> {
  const {
    agentId,
    messages = ["Researching domain concepts..."],
    result = "Research complete.",
    delays = 50,
  } = options;

  const wait = (ms: number) => page.waitForTimeout(ms);

  // 1. Init progress: init_start
  await emitTauriEvent(page, "agent-init-progress", {
    agent_id: agentId,
    stage: "init_start",
    timestamp: Date.now(),
  } satisfies AgentInitProgressPayload);
  await wait(delays);

  // 2. Init progress: sdk_ready
  await emitTauriEvent(page, "agent-init-progress", {
    agent_id: agentId,
    stage: "sdk_ready",
    timestamp: Date.now(),
  } satisfies AgentInitProgressPayload);
  await wait(delays);

  // 3. Output display items for each message
  for (let i = 0; i < messages.length; i++) {
    await emitTauriEvent(page, "agent-message", {
      agent_id: agentId,
      message: {
        type: "display_item",
        item: {
          id: `di-output-${i}`,
          type: "output",
          timestamp: Date.now(),
          outputText: messages[i],
        },
      },
    });
    await wait(delays);
  }

  // 4. Result display item
  await emitTauriEvent(page, "agent-message", {
    agent_id: agentId,
    message: {
      type: "display_item",
      item: {
        id: "di-result",
        type: "result",
        timestamp: Date.now(),
        outputText_result: result,
        resultStatus: "success",
      },
    },
  });
  await wait(delays);

  // 5. Result message (pass-through for usage tracking)
  await emitTauriEvent(page, "agent-message", {
    agent_id: agentId,
    message: {
      type: "result",
      result,
      subtype: "success",
    },
  });
  await wait(delays);

  // 6. Exit with success
  await emitTauriEvent(page, "agent-exit", {
    agent_id: agentId,
    success: true,
  } satisfies AgentExitPayload);
}

interface SimulateAgentInitErrorOptions {
  errorType: string;
  message: string;
  fixHint: string;
}

/**
 * Simulate an agent-init-error event.
 * This is emitted when the sidecar fails to start (e.g. missing Node.js).
 */
export async function simulateAgentInitError(
  page: Page,
  options: SimulateAgentInitErrorOptions,
): Promise<void> {
  const payload: AgentInitErrorPayload = {
    error_type: options.errorType,
    message: options.message,
    fix_hint: options.fixHint,
  };
  await emitTauriEvent(page, "agent-init-error", payload);
}

interface SimulateDisplayItemRunOptions {
  agentId: string;
  /** DisplayItem payloads to emit. */
  items: DisplayItemPayload[];
  /** Result text for the final result message. */
  result?: string;
  /** Delay in ms between events. Defaults to 50. */
  delays?: number;
}

/**
 * Simulate a complete agent run using explicit DisplayItem payloads:
 * 1. agent-init-progress (init_start, sdk_ready)
 * 2. N agent-message events (type=display_item)
 * 3. agent-message (type=result) — pass-through for usage tracking
 * 4. agent-exit (success=true)
 */
export async function simulateAgentRunWithDisplayItems(
  page: Page,
  options: SimulateDisplayItemRunOptions,
): Promise<void> {
  const {
    agentId,
    items,
    result = "Agent completed.",
    delays = 50,
  } = options;

  const wait = (ms: number) => page.waitForTimeout(ms);

  // Init progress
  await emitTauriEvent(page, "agent-init-progress", {
    agent_id: agentId,
    stage: "init_start",
    timestamp: Date.now(),
  } satisfies AgentInitProgressPayload);
  await wait(delays);

  await emitTauriEvent(page, "agent-init-progress", {
    agent_id: agentId,
    stage: "sdk_ready",
    timestamp: Date.now(),
  } satisfies AgentInitProgressPayload);
  await wait(delays);

  // Display items
  for (const item of items) {
    await emitTauriEvent(page, "agent-message", {
      agent_id: agentId,
      message: {
        type: "display_item",
        item,
      },
    });
    await wait(delays);
  }

  // Result message (pass-through for usage tracking)
  await emitTauriEvent(page, "agent-message", {
    agent_id: agentId,
    message: {
      type: "result",
      result,
      subtype: "success",
    },
  });
  await wait(delays);

  // Exit
  await emitTauriEvent(page, "agent-exit", {
    agent_id: agentId,
    success: true,
  } satisfies AgentExitPayload);
}

/**
 * Simulate an agent that initializes but then exits with an error.
 * Emits the init sequence followed by agent-exit with success=false.
 */
export async function simulateAgentError(
  page: Page,
  agentId: string,
): Promise<void> {
  const delays = 50;
  const wait = (ms: number) => page.waitForTimeout(ms);

  // Init sequence
  await emitTauriEvent(page, "agent-init-progress", {
    agent_id: agentId,
    stage: "init_start",
    timestamp: Date.now(),
  } satisfies AgentInitProgressPayload);
  await wait(delays);

  await emitTauriEvent(page, "agent-init-progress", {
    agent_id: agentId,
    stage: "sdk_ready",
    timestamp: Date.now(),
  } satisfies AgentInitProgressPayload);
  await wait(delays);

  // Exit with failure
  await emitTauriEvent(page, "agent-exit", {
    agent_id: agentId,
    success: false,
  } satisfies AgentExitPayload);
}

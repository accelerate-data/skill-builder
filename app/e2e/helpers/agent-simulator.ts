/**
 * Agent lifecycle simulator for Playwright E2E tests.
 *
 * Dispatches Tauri events through `window.__TAURI_EVENT_HANDLERS__`
 * so the UI reacts through its existing Zustand stores exactly as it
 * would with a real agent sidecar.
 */
import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Types — mirror the payload shapes from use-agent-stream.ts
// ---------------------------------------------------------------------------

interface AgentInitProgressPayload {
  agent_id: string;
  subtype: string;
  timestamp: number;
}

interface AgentInitErrorPayload {
  error_type: string;
  message: string;
  fix_hint: string;
}

interface AgentMessagePayload {
  agent_id: string;
  message: {
    type: string;
    message?: {
      content?: Array<{ type: string; text?: string }>;
    };
    result?: string;
    error?: string;
    [key: string]: unknown;
  };
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
// High-level simulators
// ---------------------------------------------------------------------------

interface SimulateAgentRunOptions {
  agentId: string;
  /** Text content for each assistant message. Defaults to a single generic message. */
  messages?: string[];
  /** Result text for the final result message. */
  result?: string;
  /** Delay in ms between events. Defaults to 50. */
  delays?: number;
}

/**
 * Simulate a complete happy-path agent run:
 * 1. agent-init-progress (init_start)
 * 2. agent-init-progress (sdk_ready)
 * 3. N agent-message events (type=assistant)
 * 4. agent-message (type=result)
 * 5. agent-exit (success=true)
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
  const initStart: AgentInitProgressPayload = {
    agent_id: agentId,
    subtype: "init_start",
    timestamp: Date.now(),
  };
  await emitTauriEvent(page, "agent-init-progress", initStart);
  await wait(delays);

  // 2. Init progress: sdk_ready
  const sdkReady: AgentInitProgressPayload = {
    agent_id: agentId,
    subtype: "sdk_ready",
    timestamp: Date.now(),
  };
  await emitTauriEvent(page, "agent-init-progress", sdkReady);
  await wait(delays);

  // 3. Assistant messages
  for (const text of messages) {
    const msgPayload: AgentMessagePayload = {
      agent_id: agentId,
      message: {
        type: "assistant",
        message: {
          content: [{ type: "text", text }],
        },
      },
    };
    await emitTauriEvent(page, "agent-message", msgPayload);
    await wait(delays);
  }

  // 4. Result message
  const resultPayload: AgentMessagePayload = {
    agent_id: agentId,
    message: {
      type: "result",
      result,
    },
  };
  await emitTauriEvent(page, "agent-message", resultPayload);
  await wait(delays);

  // 5. Exit with success
  const exitPayload: AgentExitPayload = {
    agent_id: agentId,
    success: true,
  };
  await emitTauriEvent(page, "agent-exit", exitPayload);
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
    subtype: "init_start",
    timestamp: Date.now(),
  } satisfies AgentInitProgressPayload);
  await wait(delays);

  await emitTauriEvent(page, "agent-init-progress", {
    agent_id: agentId,
    subtype: "sdk_ready",
    timestamp: Date.now(),
  } satisfies AgentInitProgressPayload);
  await wait(delays);

  // Exit with failure
  await emitTauriEvent(page, "agent-exit", {
    agent_id: agentId,
    success: false,
  } satisfies AgentExitPayload);
}

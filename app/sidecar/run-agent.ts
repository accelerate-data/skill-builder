import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SidecarConfig } from "./config.js";
import { runMockAgent } from "./mock-agent.js";
import { buildQueryOptions } from "./options.js";
import { createAbortState } from "./shutdown.js";

/**
 * Emit a system-level progress event (not an SDK message).
 * These events let the UI show granular status during initialization.
 */
export function emitSystemEvent(
  onMessage: (message: Record<string, unknown>) => void,
  subtype: string,
): void {
  onMessage({ type: "system", subtype, timestamp: Date.now() });
}

/**
 * Format conversation history into a prompt for refine sessions.
 *
 * When history is present, prepends it as a "Conversation History" section
 * before the current request. Returns the prompt as-is when history is empty.
 */
export function buildRefinePrompt(
  prompt: string,
  history: { role: "user" | "assistant"; content: string }[],
): string {
  if (history.length === 0) return prompt;

  const formatted = history
    .map((msg) => {
      const label = msg.role === "user" ? "User" : "Assistant";
      return `**${label}**: ${msg.content}`;
    })
    .join("\n\n");

  return `## Conversation History\n\n${formatted}\n\n## Current Request\n\n${prompt}`;
}

/**
 * Run a single agent request using the SDK.
 *
 * Streams each SDK message to the provided `onMessage` callback.
 * The callback receives raw SDK message objects (the caller is responsible
 * for any wrapping, e.g., adding `request_id`).
 *
 * @param config          The sidecar config for this request
 * @param onMessage       Called for each message from the SDK conversation
 * @param externalSignal  Optional AbortSignal to cancel from outside (e.g., when persistent-mode
 *                        aborts a stuck request to start a new one)
 */
export async function runAgentRequest(
  config: SidecarConfig,
  onMessage: (message: Record<string, unknown>) => void,
  externalSignal?: AbortSignal,
): Promise<void> {
  if (process.env.MOCK_AGENTS === "true") {
    process.stderr.write("[sidecar] Mock agent mode\n");
    return runMockAgent(config, onMessage, externalSignal);
  }

  if (config.apiKey) {
    process.env.ANTHROPIC_API_KEY = config.apiKey;
  }

  const state = createAbortState();

  // Link external signal to internal abort so callers can cancel us
  if (externalSignal) {
    if (externalSignal.aborted) {
      state.aborted = true;
      state.abortController.abort();
    } else {
      externalSignal.addEventListener(
        "abort",
        () => {
          state.aborted = true;
          state.abortController.abort();
        },
        { once: true },
      );
    }
  }

  // Route SDK subprocess stderr through onMessage so it gets wrapped with
  // request_id and written to the JSONL transcript (not the app log).
  const stderrHandler = (data: string) => {
    onMessage({ type: "system", subtype: "sdk_stderr", data: data.trimEnd(), timestamp: Date.now() });
  };

  const options = buildQueryOptions(config, state.abortController, stderrHandler);

  // Build the effective prompt, prepending conversation history for refine sessions
  const history = config.conversationHistory ?? [];
  const effectivePrompt = history.length > 0
    ? buildRefinePrompt(config.prompt, history)
    : config.prompt;

  if (history.length > 0) {
    process.stderr.write(`[sidecar] Refine mode: ${history.length} history messages\n`);
  }

  // Notify the UI that we're about to initialize the SDK
  emitSystemEvent(onMessage, "init_start");

  process.stderr.write("[sidecar] Starting SDK query\n");
  const conversation = query({
    prompt: effectivePrompt,
    options,
  });

  // SDK is loaded and connected — ready to stream messages
  emitSystemEvent(onMessage, "sdk_ready");

  for await (const message of conversation) {
    if (state.aborted) break;
    onMessage(message as Record<string, unknown>);
  }
}

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SidecarConfig } from "./config.js";
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
 * Run a single agent request using the SDK.
 *
 * Streams each SDK message to the provided `onMessage` callback.
 * The callback receives raw SDK message objects (the caller is responsible
 * for any wrapping, e.g., adding `request_id`).
 *
 * @param config     The sidecar config for this request
 * @param onMessage  Called for each message from the SDK conversation
 */
export async function runAgentRequest(
  config: SidecarConfig,
  onMessage: (message: Record<string, unknown>) => void,
): Promise<void> {
  if (config.apiKey) {
    process.env.ANTHROPIC_API_KEY = config.apiKey;
  }

  const state = createAbortState();
  const options = buildQueryOptions(config, state.abortController);

  // Notify the UI that we're about to initialize the SDK
  emitSystemEvent(onMessage, "init_start");

  const conversation = query({
    prompt: config.prompt,
    options,
  });

  // SDK is loaded and connected — ready to stream messages
  emitSystemEvent(onMessage, "sdk_ready");

  for await (const message of conversation) {
    if (state.aborted) break;
    onMessage(message as Record<string, unknown>);
  }
}

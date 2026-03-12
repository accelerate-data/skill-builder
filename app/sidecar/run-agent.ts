import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SidecarConfig } from "./config.js";
import { runMockAgent } from "./mock-agent.js";
import { buildQueryOptions } from "./options.js";
import { createAbortState, linkExternalSignal } from "./shutdown.js";
import { MessageProcessor } from "./message-processor.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Discover all installed plugins under <cwd>/.claude/plugins/.
 * Returns an absolute path for each subdirectory found there.
 */
export async function discoverInstalledPlugins(cwd: string): Promise<string[]> {
  const pluginsDir = path.join(cwd, ".claude", "plugins");
  try {
    const entries = await fs.readdir(pluginsDir);
    return entries.map((entry) => path.join(pluginsDir, entry));
  } catch {
    return [];
  }
}

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

  const state = createAbortState();
  if (externalSignal) {
    linkExternalSignal(state, externalSignal);
  }

  // Discover all installed plugins so every plugin agent is available to the SDK.
  const pluginPaths = await discoverInstalledPlugins(config.cwd);

  // Route SDK subprocess stderr through onMessage so it gets wrapped with
  // request_id and written to the JSONL transcript (not the app log).
  const stderrHandler = (data: string) => {
    onMessage({ type: "system", subtype: "sdk_stderr", data: data.trimEnd(), timestamp: Date.now() });
  };

  const options = buildQueryOptions(config, state.abortController, pluginPaths, stderrHandler);

  // Emit plugins passed to the SDK as a system event so it appears in the JSONL transcript.
  const pluginsToLog = (options as Record<string, unknown>).plugins as unknown[] | undefined;
  onMessage({
    type: "system",
    subtype: "sdk_plugins_debug",
    plugins: pluginsToLog ?? [],
    timestamp: Date.now(),
  });

  // Notify the UI that we're about to initialize the SDK
  emitSystemEvent(onMessage, "init_start");

  process.stderr.write("[sidecar] Starting SDK query\n");
  const conversation = query({
    prompt: config.prompt,
    options,
  });

  // SDK is loaded and connected — ready to stream messages
  emitSystemEvent(onMessage, "sdk_ready");

  // Process raw SDK messages through MessageProcessor for structured display items
  const processor = new MessageProcessor({
    skillName: config.skillName,
    stepId: config.stepId,
    workflowSessionId: config.workflowSessionId,
    usageSessionId: config.usageSessionId,
    runSource: config.runSource,
  });

  try {
    for await (const message of conversation) {
      if (state.abortController.signal.aborted) break;

      const raw = message as Record<string, unknown>;
      // Log raw message to transcript (debugging) — the raw message is still
      // captured by persistent-mode's writeLine wrapping, so no separate log needed.
      // Process into display items + pass-through messages
      const items = processor.process(raw);
      for (const item of items) {
        onMessage(item as Record<string, unknown>);
      }
    }
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
        onMessage(item as Record<string, unknown>);
      }

      const errorSummary = processor.buildExecutionErrorSummary(errorMessage);
      onMessage({ type: "agent_event", event: errorSummary, timestamp: Date.now() } as Record<string, unknown>);
      return;
    }
  }

  // Emit a shutdown run_result for aborted runs so Rust can persist partial data
  if (state.abortController.signal.aborted) {
    process.stderr.write("[sidecar] Run aborted — emitting shutdown run_result\n");
    const shutdownSummary = processor.buildShutdownSummary();
    onMessage({ type: "agent_event", event: shutdownSummary, timestamp: Date.now() } as Record<string, unknown>);
  }
}

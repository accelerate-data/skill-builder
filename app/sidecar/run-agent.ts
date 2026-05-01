import type { SidecarConfig } from "./config.js";
import type { RunResultEvent } from "./agent-events.js";
import {
  ClaudeRuntime,
  discoverInstalledPlugins,
  emitSystemEvent,
  selectPluginPaths,
  toOneShotRunRequest,
} from "./runtime/claude-runtime.js";
import { OpenHandsRuntime } from "./runtime/openhands-runtime.js";
import { createRecordRuntimeSink } from "./runtime/sink.js";

export { discoverInstalledPlugins, emitSystemEvent, selectPluginPaths };

function buildRuntimeValidationResult(
  config: SidecarConfig,
  message: string,
): RunResultEvent {
  return {
    type: "run_result",
    skillName: config.skillName ?? "unknown",
    stepId: config.stepId ?? -1,
    workflowSessionId: config.workflowSessionId,
    usageSessionId: config.usageSessionId,
    runSource: config.runSource,
    sessionId: null,
    model: config.model ?? "unknown",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCostUsd: 0,
    modelUsageBreakdown: [],
    contextWindow: 0,
    resultSubtype: "runtime_validation",
    resultErrors: [message],
    stopReason: null,
    numTurns: 0,
    durationMs: 0,
    durationApiMs: 0,
    toolUseCount: 0,
    compactionCount: 0,
    status: "error",
    resultText: message,
    workspacePath: config.workspaceSkillDir,
    pluginSlug: config.pluginSlug ?? "unknown",
  };
}

/**
 * Compatibility entry point for existing one-shot sidecar callers.
 *
 * New runtime code should use ClaudeRuntime directly. This wrapper preserves
 * the historic function signature while routing through the one-shot runtime
 * boundary.
 */
export async function runAgentRequest(
  config: SidecarConfig,
  onMessage: (message: Record<string, unknown>) => void,
  externalSignal?: AbortSignal,
): Promise<void> {
  const runtime =
    config.runtimeProvider === "openhands"
      ? new OpenHandsRuntime()
      : new ClaudeRuntime();
  const sink = createRecordRuntimeSink(onMessage);

  try {
    await runtime.runOnce(toOneShotRunRequest(config), sink, externalSignal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sink.emitRaw({ type: "error", message });
    sink.emitAgentEvent(buildRuntimeValidationResult(config, message));
  }
}

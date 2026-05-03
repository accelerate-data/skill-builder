import type { SidecarConfig } from "./config.js";
import type { RunResultEvent } from "./agent-events.js";
import {
  ClaudeRuntime,
  discoverInstalledPlugins,
  emitSystemEvent,
  selectPluginPaths,
  toOneShotRunRequest,
} from "./runtime/claude-runtime.js";
import { createRecordRuntimeSink } from "./runtime/sink.js";
import { OPENHANDS_AGENT_SERVER_ONLY_ERROR } from "./openhands-rejection.js";

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
 * One-shot sidecar entry point.
 * Legacy non-workflow callers omit runtimeProvider and continue through Claude.
 * OpenHands now runs through the Rust-managed Agent Server path only.
 */
export async function runAgentRequest(
  config: SidecarConfig,
  onMessage: (message: Record<string, unknown>) => void,
  externalSignal?: AbortSignal,
): Promise<void> {
  const runtime = new ClaudeRuntime();
  const sink = createRecordRuntimeSink(onMessage);

  try {
    if (config.runtimeProvider === "openhands") {
      throw new Error(OPENHANDS_AGENT_SERVER_ONLY_ERROR);
    }
    await runtime.runOnce(toOneShotRunRequest(config), sink, externalSignal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sink.emitRaw({ type: "error", message });
    sink.emitAgentEvent(buildRuntimeValidationResult(config, message));
  }
}

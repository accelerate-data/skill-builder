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
  type RuntimeSession,
  type RuntimeSink,
  type StreamingSessionRequest,
} from "./types.js";
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
  onMessage: (message: Record<string, unknown>) => void,
  subtype: string,
): void {
  onMessage({ type: "system", subtype, timestamp: Date.now() });
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
    permissionMode: config.permissionMode,
    betas: config.betas,
    thinking: config.thinking,
    effort: config.effort,
    fallbackModel: config.fallbackModel,
    outputFormat: config.outputFormat,
    promptSuggestions: config.promptSuggestions,
    pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable,
    context: {
      skillName: config.skillName,
      stepId: config.stepId,
      workflowSessionId: config.workflowSessionId,
      usageSessionId: config.usageSessionId,
      runSource: config.runSource,
      workspaceSkillDir: config.workspaceSkillDir,
      pluginSlug: config.pluginSlug ?? "unknown",
    },
  };
}

export function toClaudeSidecarConfig(request: OneShotRunRequest | StreamingSessionRequest): SidecarConfig {
  return {
    mode: request.mode,
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
    permissionMode: request.permissionMode,
    betas: request.betas,
    thinking: request.thinking,
    effort: request.effort,
    fallbackModel: request.fallbackModel,
    outputFormat: request.outputFormat,
    promptSuggestions: request.promptSuggestions,
    pathToClaudeCodeExecutable: request.pathToClaudeCodeExecutable,
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
      sink.emitRaw({ type: "system", subtype: "sdk_stderr", data: data.trimEnd(), timestamp: Date.now() });
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

    emitSystemEvent((message) => sink.emitRaw(message), "init_start");

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
          emitSystemEvent((msg) => sink.emitRaw(msg), "sdk_ready");
          sdkReadyEmitted = true;
        }

        const raw = message as Record<string, unknown>;

        if (raw.type === "prompt_suggestion" && typeof raw.suggestion === "string") {
          sink.emitRaw({
            type: "agent_event",
            event: {
              type: "prompt_suggestion",
              suggestion: raw.suggestion,
            },
            timestamp: Date.now(),
          });
          continue;
        }

        const items = processor.process(raw);
        for (const item of items) {
          gate.emit(item as Record<string, unknown>, (msg) => sink.emitRaw(msg));
        }
        gate.tryFlush((msg) => sink.emitRaw(msg));
      }

      gate.flush((msg) => sink.emitRaw(msg));
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
    _request: StreamingSessionRequest,
    _sink: RuntimeSink,
  ): RuntimeSession {
    throw new Error("Claude streaming sessions are wired through StreamSession");
  }
}

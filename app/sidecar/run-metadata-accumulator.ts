/**
 * Run-level metadata accumulator.
 *
 * Tracks turns, tool use, compaction, and session info across SDK messages
 * to build the self-contained `run_result` event on completion.
 *
 * @module run-metadata-accumulator
 */

import type {
  ModelUsageEntry,
  RunResultEvent,
} from "./agent-events.js";

// ---------------------------------------------------------------------------
// RequestContext — carries persistence context for run_result building
// ---------------------------------------------------------------------------

export interface RequestContext {
  skillName?: string;
  stepId?: number;
  workflowSessionId?: string;
  usageSessionId?: string;
  runSource?: "workflow" | "refine" | "test";
  /** Whether this processor is being used in a streaming session (refine chat).
   * Controls the `streaming` flag on TurnCompleteEvent — Rust uses it to decide
   * whether turn_complete is a per-turn terminal (streaming) or informational only
   * (one-shot). Defaults to false. */
  streaming?: boolean;
}

// ---------------------------------------------------------------------------
// RunMetadataAccumulator — accumulates state across SDK messages
// ---------------------------------------------------------------------------

/**
 * Accumulates run-level metadata across SDK messages.
 * Used to construct the self-contained run_result event on result.
 */
export class RunMetadataAccumulator {
  private startTime = Date.now();
  private turnCount = 0;
  private toolUseCount = 0;
  private compactionCount = 0;
  private sessionId?: string;
  private model = "unknown";
  private thinkingEnabled = false;
  private agentName?: string;

  constructor(private context: RequestContext) {}

  get currentTurnCount(): number {
    return this.turnCount;
  }

  getContext(): RequestContext {
    return this.context;
  }

  recordTurn(): void {
    this.turnCount++;
  }

  recordToolUse(): void {
    this.toolUseCount++;
  }

  recordCompaction(): void {
    this.compactionCount++;
  }

  recordSessionInit(sessionId: string, model: string): void {
    this.sessionId = sessionId;
    this.model = model;
    process.stderr.write(
      `[accumulator] event=session_init session_id=${sessionId} model=${model}\n`,
    );
  }

  recordConfig(thinkingEnabled: boolean, agentName?: string): void {
    this.thinkingEnabled = thinkingEnabled;
    if (agentName) this.agentName = agentName;
    process.stderr.write(
      `[accumulator] event=config thinking=${thinkingEnabled} agent=${agentName ?? "none"}\n`,
    );
  }

  buildShutdownSummary(): RunResultEvent {
    return {
      type: "run_result",
      skillName: this.context.skillName ?? "unknown",
      stepId: this.context.stepId ?? -1,
      workflowSessionId: this.context.workflowSessionId,
      usageSessionId: this.context.usageSessionId,
      runSource: this.context.runSource,
      sessionId: this.sessionId,
      model: this.model,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCostUsd: 0,
      modelUsageBreakdown: [],
      contextWindow: 0,
      numTurns: this.turnCount,
      durationMs: Date.now() - this.startTime,
      toolUseCount: this.toolUseCount,
      compactionCount: this.compactionCount,
      status: "shutdown",
    };
  }

  buildExecutionErrorSummary(errorMessage: string): RunResultEvent {
    return this.buildRunSummary({
      subtype: "error_during_execution",
      is_error: true,
      errors: [errorMessage],
      stop_reason: "error",
    });
  }

  buildRunSummary(raw: Record<string, unknown>): RunResultEvent {
    const usage = raw.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    const modelUsage = raw.modelUsage as
      | Record<string, {
          inputTokens?: number; outputTokens?: number;
          cacheReadInputTokens?: number; cacheCreationInputTokens?: number;
          cost?: number; costUSD?: number; contextWindow?: number;
        }>
      | undefined;

    let inputTokens = usage?.input_tokens ?? 0;
    let outputTokens = usage?.output_tokens ?? 0;
    let totalCostUsd = (raw.total_cost_usd as number | undefined) ?? 0;
    let contextWindow = 0;
    const breakdown: ModelUsageEntry[] = [];
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;

    if (modelUsage) {
      for (const [modelId, mu] of Object.entries(modelUsage)) {
        const entryContextWindow = mu.contextWindow ?? 0;
        if (entryContextWindow > contextWindow) contextWindow = entryContextWindow;
        breakdown.push({
          model: modelId,
          inputTokens: mu.inputTokens ?? 0,
          outputTokens: mu.outputTokens ?? 0,
          cacheReadTokens: mu.cacheReadInputTokens ?? 0,
          cacheWriteTokens: mu.cacheCreationInputTokens ?? 0,
          cost: mu.costUSD ?? mu.cost ?? 0,
        });
      }
      if (breakdown.length > 0) {
        inputTokens = breakdown.reduce((s, e) => s + e.inputTokens, 0);
        outputTokens = breakdown.reduce((s, e) => s + e.outputTokens, 0);
        cacheReadTokens = breakdown.reduce((s, e) => s + e.cacheReadTokens, 0);
        cacheWriteTokens = breakdown.reduce((s, e) => s + e.cacheWriteTokens, 0);
        totalCostUsd = breakdown.reduce((s, e) => s + e.cost, 0);
      }
    }

    const subtype = raw.subtype as string | undefined;
    const isError = raw.is_error === true;
    const status: RunResultEvent["status"] =
      isError || (subtype && subtype.startsWith("error_")) ? "error" : "completed";

    const summary: RunResultEvent = {
      type: "run_result",
      skillName: this.context.skillName ?? "unknown",
      stepId: this.context.stepId ?? -1,
      workflowSessionId: this.context.workflowSessionId,
      usageSessionId: this.context.usageSessionId,
      runSource: this.context.runSource,
      sessionId: this.sessionId,
      model: this.model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalCostUsd,
      modelUsageBreakdown: breakdown,
      contextWindow,
      resultSubtype: subtype,
      resultErrors: Array.isArray(raw.errors) ? (raw.errors as string[]) : undefined,
      stopReason: typeof raw.stop_reason === "string" ? raw.stop_reason : undefined,
      numTurns: typeof raw.num_turns === "number" ? raw.num_turns : this.turnCount,
      durationMs: Date.now() - this.startTime,
      durationApiMs: typeof raw.duration_api_ms === "number" ? raw.duration_api_ms : undefined,
      toolUseCount: this.toolUseCount,
      compactionCount: this.compactionCount,
      status,
    };

    process.stderr.write(
      `[accumulator] event=build_run_result skill=${summary.skillName} step=${summary.stepId} status=${status} turns=${summary.numTurns} tool_use=${summary.toolUseCount} compaction=${summary.compactionCount} cost=${totalCostUsd.toFixed(4)}\n`,
    );

    return summary;
  }
}

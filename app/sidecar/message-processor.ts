/**
 * Stateful SDK message processor.
 *
 * Transforms raw SDK messages into structured DisplayItem objects.
 * Maintains state for tool call → result linking and subagent grouping.
 * Accumulates run-level metadata for structured run_summary emission.
 *
 * @module message-processor
 */

import type { DisplayItem, DisplayItemEnvelope, ToolStatus, RunMetadata, RunSummary, ModelUsageEntry } from "./display-types.js";
import { classifyRawMessage } from "./message-classifier.js";

// ---------------------------------------------------------------------------
// Result markdown extraction
// ---------------------------------------------------------------------------

/**
 * Extracts display-ready markdown from a structured output payload.
 * Joins all `*_markdown` string fields with a divider so the frontend
 * never needs to inspect structuredOutput directly.
 */
export function extractResultMarkdown(structuredOutput: unknown): string | undefined {
  if (typeof structuredOutput !== "object" || structuredOutput === null) return undefined;
  const obj = structuredOutput as Record<string, unknown>;
  const sections = Object.entries(obj)
    .filter(([key, val]) => key.endsWith("_markdown") && typeof val === "string" && val.length > 0)
    .map(([, val]) => val as string);
  return sections.length > 0 ? sections.join("\n\n---\n\n") : undefined;
}

/**
 * Attempts to parse a text block as JSON, stripping markdown code fences
 * (```json ... ``` or ``` ... ```) if present.
 * Returns the parsed value or undefined if parsing fails.
 */
export function tryParseJsonFromText(text: string): unknown {
  const stripped = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Tool summary helpers (moved from frontend agent-output-panel.tsx)
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function computeToolSummary(
  name: string,
  input: Record<string, unknown> | undefined,
): string {
  if (!input) return name;

  if (name === "Read" && input.file_path) {
    const path = String(input.file_path).split("/").pop();
    return `Reading ${path}`;
  }
  if (name === "Write" && input.file_path) {
    const path = String(input.file_path).split("/").pop();
    return `Writing ${path}`;
  }
  if (name === "Edit" && input.file_path) {
    const path = String(input.file_path).split("/").pop();
    return `Editing ${path}`;
  }
  if (name === "Bash" && input.command) {
    return `Running: ${truncate(String(input.command), 80)}`;
  }
  if (name === "Grep" && input.pattern) {
    const pattern = truncate(String(input.pattern), 40);
    const p = input.path ? ` in ${String(input.path).split("/").pop()}` : "";
    return `Grep: "${pattern}"${p}`;
  }
  if (name === "Glob" && input.pattern) {
    return `Glob: ${truncate(String(input.pattern), 50)}`;
  }
  if (name === "WebSearch" && input.query) {
    return `Web search: "${truncate(String(input.query), 60)}"`;
  }
  if (name === "WebFetch" && input.url) {
    return `Fetching: ${truncate(String(input.url), 70)}`;
  }
  if ((name === "Task" || name === "Agent") && input.description) {
    return `Agent: ${truncate(String(input.description), 60)}`;
  }
  if (name === "NotebookEdit" && input.notebook_path) {
    const path = String(input.notebook_path).split("/").pop();
    return `Editing notebook ${path}`;
  }
  if (name === "LS" && input.path) {
    return `Listing ${truncate(String(input.path), 50)}`;
  }

  // Fallback: tool name + first string value
  for (const val of Object.values(input)) {
    if (typeof val === "string" && val.length > 0) {
      return `${name}: ${truncate(val, 60)}`;
    }
  }
  return name;
}

// ---------------------------------------------------------------------------
// Result error labels (moved from frontend agent-output-panel.tsx)
// ---------------------------------------------------------------------------

const RESULT_ERROR_LABELS: Record<string, string> = {
  error_max_turns: "Agent reached the maximum number of turns allowed.",
  error_max_budget_usd: "Agent exceeded the maximum cost budget.",
  error_during_execution: "An error occurred during agent execution.",
  error_max_structured_output_retries:
    "Agent failed to produce valid structured output after multiple retries.",
};

// ---------------------------------------------------------------------------
// RequestContext — carries persistence context for run_summary building
// ---------------------------------------------------------------------------

export interface RequestContext {
  skillName?: string;
  stepId?: number;
  workflowSessionId?: string;
  usageSessionId?: string;
  runSource?: "workflow" | "refine" | "test";
}

// ---------------------------------------------------------------------------
// RunMetadataAccumulator — accumulates state across SDK messages
// ---------------------------------------------------------------------------

/**
 * Accumulates run-level metadata across SDK messages.
 * Used to construct the self-contained run_summary on result.
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

  buildShutdownSummary(): RunSummary {
    return {
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

  buildExecutionErrorSummary(errorMessage: string): RunSummary {
    return this.buildRunSummary({
      subtype: "error_during_execution",
      is_error: true,
      errors: [errorMessage],
      stop_reason: "error",
    });
  }

  buildRunSummary(raw: Record<string, unknown>): RunSummary {
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
    const status: RunSummary["status"] =
      isError || (subtype && subtype.startsWith("error_")) ? "error" : "completed";

    const summary: RunSummary = {
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
      `[accumulator] event=build_run_summary skill=${summary.skillName} step=${summary.stepId} status=${status} turns=${summary.numTurns} tool_use=${summary.toolUseCount} compaction=${summary.compactionCount} cost=${totalCostUsd.toFixed(4)}\n`,
    );

    return summary;
  }
}

// ---------------------------------------------------------------------------
// MessageProcessor
// ---------------------------------------------------------------------------

/** A processed output item — either a display_item envelope, metadata, run_summary, or a pass-through raw message. */
export type ProcessedMessage = Record<string, unknown>;

export class MessageProcessor {
  /** Counter for generating unique display item IDs. */
  private idCounter = 0;

  /** Last top-level output text block — used as fallback for structured output extraction. */
  private lastOutputText: string | undefined;

  /** Map from toolUseId → DisplayItem for pending tool calls. */
  private toolCallMap = new Map<string, DisplayItem>();

  /** Map from toolUseId → timestamp when tool call was emitted (for duration). */
  private toolCallTimestamps = new Map<string, number>();

  /** Map from parent_tool_use_id → child display items (subagent grouping). */
  private subagentMap = new Map<string, DisplayItem[]>();

  /** Map from toolUseId → subagent DisplayItem (Task tool calls). */
  private subagentByToolUseId = new Map<string, DisplayItem>();

  /** Accumulates run-level state for run_summary. */
  private accumulator: RunMetadataAccumulator;

  constructor(context?: RequestContext) {
    this.accumulator = new RunMetadataAccumulator(context ?? {});
  }

  private generateId(): string {
    return `di-${++this.idCounter}`;
  }

  private makeEnvelope(item: DisplayItem): DisplayItemEnvelope {
    return { type: "display_item", item };
  }

  /**
   * Process one raw SDK message into 0 or more output messages.
   *
   * Returns an array of JSONL-ready objects:
   * - `{ type: "display_item", item: DisplayItem }` for rendering
   * - `{ type: "metadata", data: RunMetadata }` for context/config tracking
   * - `{ type: "run_summary", data: RunSummary }` on result (intercepted by Rust, not forwarded to frontend)
   * - Raw pass-through messages for error handling
   */
  process(raw: Record<string, unknown>): ProcessedMessage[] {
    const category = classifyRawMessage(raw);
    const now = Date.now();

    process.stderr.write(
      `[message-processor] event=classify category=${category} raw_type=${raw.type ?? "unknown"}\n`,
    );

    switch (category) {
      case "hardNoise":
        // Filtered out — not emitted
        process.stderr.write(
          `[message-processor] event=filter_noise raw_type=${raw.type ?? "unknown"} subtype=${(raw as Record<string, unknown>).subtype ?? "none"}\n`,
        );
        return [];

      case "compact":
        return this.processCompactBoundary(raw, now);

      case "system":
        return this.processSystemMessage(raw, now);

      case "user":
        return this.processUserMessage(raw, now);

      case "ai":
        return this.processAiMessage(raw, now);

      default:
        return [];
    }
  }

  // -------------------------------------------------------------------------
  // System messages
  // -------------------------------------------------------------------------

  private processSystemMessage(raw: Record<string, unknown>, now: number): ProcessedMessage[] {
    const rawType = raw.type as string;
    const subtype = raw.subtype as string | undefined;

    // config messages → extract thinkingEnabled and agentName
    if (rawType === "config") {
      return this.processConfigMessage(raw, now);
    }

    // system/init → extract sessionId and model
    if (subtype === "init") {
      return this.processSystemInit(raw, now);
    }

    // init_start, sdk_ready → forward for Rust init-progress routing
    if (subtype === "init_start" || subtype === "sdk_ready") {
      process.stderr.write(
        `[message-processor] event=forward_init_progress subtype=${subtype}\n`,
      );
      return [raw];
    }

    // Other system messages → forward
    process.stderr.write(
      `[message-processor] event=forward_system subtype=${subtype ?? "unknown"}\n`,
    );
    return [raw];
  }

  private processConfigMessage(raw: Record<string, unknown>, now: number): ProcessedMessage[] {
    const configObj = raw.config as
      | { thinking?: { type?: string; budgetTokens?: number }; agentName?: string }
      | undefined;

    const thinkingEnabled =
      configObj?.thinking?.type === "enabled" &&
      typeof configObj.thinking.budgetTokens === "number" &&
      configObj.thinking.budgetTokens > 0;
    const agentName = configObj?.agentName;

    this.accumulator.recordConfig(thinkingEnabled, agentName);

    const metadata: RunMetadata = {
      config: {
        thinkingEnabled,
        agentName,
      },
    };

    process.stderr.write(
      `[message-processor] event=emit_metadata subtype=config thinking=${thinkingEnabled} agent=${agentName ?? "none"}\n`,
    );

    return [{ type: "metadata", data: metadata, timestamp: now } as ProcessedMessage];
  }

  private processSystemInit(raw: Record<string, unknown>, now: number): ProcessedMessage[] {
    const sid = raw.session_id;
    const initModel = raw.model;

    if (typeof sid === "string" && sid.length > 0) {
      const model = typeof initModel === "string" && initModel.length > 0 ? initModel : "unknown";
      this.accumulator.recordSessionInit(sid, model);

      const metadata: RunMetadata = {
        sessionInit: { sessionId: sid, model },
      };

      process.stderr.write(
        `[message-processor] event=emit_metadata subtype=session_init session_id=${sid} model=${model}\n`,
      );

      return [{ type: "metadata", data: metadata, timestamp: now } as ProcessedMessage];
    }

    return [];
  }

  // -------------------------------------------------------------------------
  // Compact boundary
  // -------------------------------------------------------------------------

  private processCompactBoundary(
    raw: Record<string, unknown>,
    now: number,
  ): ProcessedMessage[] {
    const item: DisplayItem = {
      id: this.generateId(),
      type: "compact_boundary",
      timestamp: now,
    };

    const turn = this.accumulator.currentTurnCount;
    this.accumulator.recordCompaction();

    const compactionMetadata = raw.compact_metadata as { pre_tokens?: number } | undefined;
    const preTokens = compactionMetadata?.pre_tokens ?? 0;

    const metadata: RunMetadata = {
      compactionEvent: { turn, preTokens, timestamp: now },
    };

    process.stderr.write(
      `[message-processor] event=emit_display_item item_type=compact_boundary id=${item.id}\n`,
    );
    process.stderr.write(
      `[message-processor] event=emit_metadata subtype=compaction turn=${turn} pre_tokens=${preTokens}\n`,
    );

    return [
      this.makeEnvelope(item),
      { type: "metadata", data: metadata, timestamp: now } as ProcessedMessage,
    ];
  }

  // -------------------------------------------------------------------------
  // User messages (tool results)
  // -------------------------------------------------------------------------

  private processUserMessage(
    raw: Record<string, unknown>,
    now: number,
  ): ProcessedMessage[] {
    const results: ProcessedMessage[] = [];
    const message = raw.message as Record<string, unknown> | undefined;
    const content = message?.content;

    if (!Array.isArray(content)) return results;

    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;

      if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        const toolUseId = b.tool_use_id;
        const isError = b.is_error === true;
        const resultContent = typeof b.content === "string"
          ? b.content
          : JSON.stringify(b.content ?? "");

        const pendingItem = this.toolCallMap.get(toolUseId);
        if (pendingItem) {
          // Update the pending tool call with result
          const startTime = this.toolCallTimestamps.get(toolUseId);
          const durationMs = startTime ? now - startTime : undefined;

          const updatedItem: DisplayItem = {
            ...pendingItem,
            toolStatus: isError ? "error" : "ok",
            toolResult: {
              content: resultContent,
              isError,
            },
            toolDurationMs: durationMs,
          };

          this.toolCallMap.delete(toolUseId);
          this.toolCallTimestamps.delete(toolUseId);

          process.stderr.write(
            `[message-processor] event=link_tool_result tool_use_id=${toolUseId} status=${updatedItem.toolStatus} duration_ms=${durationMs ?? "n/a"}\n`,
          );

          // If tool belongs to a subagent, update child in-place and re-emit subagent
          if (updatedItem.parentToolUseId) {
            this.updateSubagentChild(updatedItem.parentToolUseId, updatedItem, results);
          } else {
            results.push(this.makeEnvelope(updatedItem));
          }

          // If this was a subagent (Task), update its status
          const subagentItem = this.subagentByToolUseId.get(toolUseId);
          if (subagentItem) {
            const childItems = this.subagentMap.get(toolUseId) ?? [];
            const updatedSubagent: DisplayItem = {
              ...subagentItem,
              subagentStatus: isError ? "error" : "complete",
              subagentItems: childItems.length > 0 ? childItems : undefined,
            };
            this.subagentByToolUseId.delete(toolUseId);
            this.subagentMap.delete(toolUseId);

            process.stderr.write(
              `[message-processor] event=complete_subagent tool_use_id=${toolUseId} status=${updatedSubagent.subagentStatus} child_items=${childItems.length}\n`,
            );

            results.push(this.makeEnvelope(updatedSubagent));
          }
        } else {
          process.stderr.write(
            `[message-processor] event=orphaned_tool_result tool_use_id=${toolUseId}\n`,
          );
        }
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // AI messages (assistant, result, error)
  // -------------------------------------------------------------------------

  private processAiMessage(
    raw: Record<string, unknown>,
    now: number,
  ): ProcessedMessage[] {
    const type = raw.type as string;

    if (type === "assistant") return this.processAssistantMessage(raw, now);
    if (type === "result") return this.processResultMessage(raw, now);
    if (type === "error") return this.processErrorMessage(raw, now);

    return [];
  }

  // -------------------------------------------------------------------------
  // Assistant messages — decompose into per-block display items
  // -------------------------------------------------------------------------

  private processAssistantMessage(
    raw: Record<string, unknown>,
    now: number,
  ): ProcessedMessage[] {
    const results: ProcessedMessage[] = [];
    const outerMessage = raw.message as Record<string, unknown> | undefined;
    const content = outerMessage?.content;
    const parentToolUseId = raw.parent_tool_use_id as string | undefined;

    if (!Array.isArray(content)) {
      // No content array — still increment turn count
      this.accumulator.recordTurn();
      process.stderr.write(
        `[message-processor] event=turn_no_content turn=${this.accumulator.currentTurnCount}\n`,
      );
      return results;
    }

    process.stderr.write(
      `[message-processor] event=process_assistant blocks=${content.length} parent_tool_use_id=${parentToolUseId ?? "none"}\n`,
    );

    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;

      if (b.type === "thinking" && typeof b.thinking === "string") {
        const item: DisplayItem = {
          id: this.generateId(),
          type: "thinking",
          timestamp: now,
          thinkingText: b.thinking,
          parentToolUseId,
        };
        process.stderr.write(
          `[message-processor] event=emit_display_item item_type=thinking id=${item.id} len=${b.thinking.length}\n`,
        );

        if (parentToolUseId) {
          this.addToSubagentAndEmitUpdate(parentToolUseId, item, results);
        } else {
          results.push(this.makeEnvelope(item));
        }
      } else if (b.type === "text" && typeof b.text === "string") {
        const item: DisplayItem = {
          id: this.generateId(),
          type: "output",
          timestamp: now,
          outputText: b.text,
          parentToolUseId,
        };
        process.stderr.write(
          `[message-processor] event=emit_display_item item_type=output id=${item.id} len=${b.text.length}\n`,
        );

        if (parentToolUseId) {
          this.addToSubagentAndEmitUpdate(parentToolUseId, item, results);
        } else {
          this.lastOutputText = b.text;
          results.push(this.makeEnvelope(item));
        }
      } else if (b.type === "tool_use") {
        const toolName = (b.name as string) ?? "unknown";
        const toolUseId = (b.id as string) ?? this.generateId();
        const toolInput = (b.input as Record<string, unknown>) ?? {};

        if (toolName === "Task" || toolName === "Agent") {
          // Subagent tool call
          const description = typeof toolInput.description === "string"
            ? toolInput.description
            : typeof toolInput.prompt === "string"
              ? truncate(toolInput.prompt, 80)
              : "Sub-agent";
          const subagentType = typeof toolInput.subagent_type === "string"
            ? toolInput.subagent_type
            : undefined;

          const item: DisplayItem = {
            id: this.generateId(),
            type: "subagent",
            timestamp: now,
            toolUseId,
            subagentDescription: description,
            subagentType,
            subagentStatus: "running",
            parentToolUseId,
          };

          this.subagentByToolUseId.set(toolUseId, item);
          this.subagentMap.set(toolUseId, []);

          // Also track as a tool call for linking
          this.toolCallMap.set(toolUseId, {
            ...item,
            type: "tool_call",
            toolName,
            toolInput,
            toolStatus: "pending",
            toolSummary: computeToolSummary(toolName, toolInput),
          });
          this.toolCallTimestamps.set(toolUseId, now);

          // Count Task/Agent tool uses
          this.accumulator.recordToolUse();

          process.stderr.write(
            `[message-processor] event=emit_display_item item_type=subagent id=${item.id} tool_use_id=${toolUseId} description="${truncate(description, 40)}"\n`,
          );

          if (parentToolUseId) {
            this.addToSubagentAndEmitUpdate(parentToolUseId, item, results);
          } else {
            results.push(this.makeEnvelope(item));
          }
        } else {
          // Regular tool call
          this.accumulator.recordToolUse();

          const item: DisplayItem = {
            id: this.generateId(),
            type: "tool_call",
            timestamp: now,
            toolName,
            toolUseId,
            toolInput,
            toolStatus: "pending",
            toolSummary: computeToolSummary(toolName, toolInput),
            parentToolUseId,
          };

          this.toolCallMap.set(toolUseId, item);
          this.toolCallTimestamps.set(toolUseId, now);

          process.stderr.write(
            `[message-processor] event=emit_display_item item_type=tool_call id=${item.id} tool=${toolName} tool_use_id=${toolUseId}\n`,
          );

          if (parentToolUseId) {
            this.addToSubagentAndEmitUpdate(parentToolUseId, item, results);
          } else {
            results.push(this.makeEnvelope(item));
          }
        }
      }
    }

    // Extract per-turn context usage and emit as metadata
    const outerUsage = outerMessage?.usage as
      | { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
      | undefined;

    if (outerUsage) {
      const totalInput = (outerUsage.input_tokens ?? 0)
        + (outerUsage.cache_read_input_tokens ?? 0)
        + (outerUsage.cache_creation_input_tokens ?? 0);

      this.accumulator.recordTurn();
      const metadata: RunMetadata = {
        contextSnapshot: {
          turn: this.accumulator.currentTurnCount,
          inputTokens: totalInput,
          outputTokens: outerUsage.output_tokens ?? 0,
        },
      };

      process.stderr.write(
        `[message-processor] event=emit_metadata subtype=context_snapshot turn=${this.accumulator.currentTurnCount} input=${totalInput}\n`,
      );

      results.push({ type: "metadata", data: metadata, timestamp: now } as ProcessedMessage);
    } else {
      // No usage data available — still increment turn count
      this.accumulator.recordTurn();
      process.stderr.write(
        `[message-processor] event=turn_no_usage turn=${this.accumulator.currentTurnCount}\n`,
      );
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Result messages — emit display_item + run_summary
  // -------------------------------------------------------------------------

  private processResultMessage(
    raw: Record<string, unknown>,
    now: number,
  ): ProcessedMessage[] {
    const subtype = raw.subtype as string | undefined;
    const isError = raw.is_error === true;
    const errors = raw.errors as string[] | undefined;
    const stopReason = raw.stop_reason as string | undefined;

    let resultStatus: "success" | "error" | "refusal" = "success";
    let outputText = "Agent completed";
    let errorSubtype: string | undefined;

    if (stopReason === "refusal") {
      resultStatus = "refusal";
      outputText = "Agent declined this request due to safety constraints.";
    } else if (isError || (subtype && subtype.startsWith("error_"))) {
      resultStatus = "error";
      errorSubtype = subtype;
      outputText = RESULT_ERROR_LABELS[subtype ?? ""]
        ?? errors?.join("; ")
        ?? "Agent ended with an error";
    }

    // Extract structured output from SDK result for artifact materialization.
    // When outputFormat is configured, the SDK returns the parsed JSON in
    // structured_output and a text summary in result. Fall back to result
    // if it's already an object (older SDK versions).
    let structuredOutput: unknown = undefined;
    if ("structured_output" in raw && raw.structured_output != null) {
      structuredOutput = raw.structured_output;
    } else if ("result" in raw && raw.result != null && typeof raw.result !== "string") {
      structuredOutput = raw.result;
    }

    // Extract display-ready markdown from structured output so the frontend
    // never needs to inspect structuredOutput directly.
    // Fallback: if structuredOutput is absent (e.g. agent returned JSON as a
    // text block via the Skill tool), try parsing the last output text as JSON.
    if (structuredOutput == null && this.lastOutputText) {
      const parsed = tryParseJsonFromText(this.lastOutputText);
      if (parsed != null && typeof parsed === "object") {
        structuredOutput = parsed;
      }
    }
    const resultMarkdown = extractResultMarkdown(structuredOutput);

    // Mark any remaining pending tool calls as orphaned
    const orphanedItems = this.markOrphanedToolCalls(now);

    const item: DisplayItem = {
      id: this.generateId(),
      type: "result",
      timestamp: now,
      outputText_result: outputText,
      resultStatus,
      errorSubtype,
      structuredOutput,
      ...(resultMarkdown != null && { resultMarkdown }),
    };

    process.stderr.write(
      `[message-processor] event=emit_display_item item_type=result id=${item.id} status=${resultStatus} subtype=${subtype ?? "none"} orphaned_tools=${orphanedItems.length}\n`,
    );

    // Build run_summary from accumulated state
    const runSummary = this.accumulator.buildRunSummary(raw);
    process.stderr.write(
      `[message-processor] event=emit_run_summary skill=${runSummary.skillName} status=${runSummary.status}\n`,
    );

    const results: ProcessedMessage[] = [
      ...orphanedItems,
      this.makeEnvelope(item),
    ];

    // Forward contextWindow to frontend via metadata so context utilization displays correctly
    if (runSummary.contextWindow > 0) {
      results.push({ type: "metadata", data: { contextWindow: runSummary.contextWindow } as RunMetadata, timestamp: now } as ProcessedMessage);
    }

    results.push({ type: "run_summary", data: runSummary, timestamp: now } as ProcessedMessage);

    return results;
  }

  // -------------------------------------------------------------------------
  // Error messages
  // -------------------------------------------------------------------------

  private processErrorMessage(
    raw: Record<string, unknown>,
    now: number,
  ): ProcessedMessage[] {
    const errorMsg = (raw.error as string) ?? (raw.message as string) ?? "Unknown error";

    const item: DisplayItem = {
      id: this.generateId(),
      type: "error",
      timestamp: now,
      errorMessage: errorMsg,
    };

    process.stderr.write(
      `[message-processor] event=emit_display_item item_type=error id=${item.id} message="${truncate(errorMsg, 60)}"\n`,
    );

    return [this.makeEnvelope(item)];
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Add a child item to a subagent's children list and emit an updated
   * subagent envelope so the frontend can replace it in-place with the
   * new child included. This gives live streaming of subagent activity
   * nested under the parent subagent item.
   */
  private addToSubagentAndEmitUpdate(
    parentToolUseId: string,
    item: DisplayItem,
    results: ProcessedMessage[],
  ): void {
    const children = this.subagentMap.get(parentToolUseId);
    if (!children) {
      // No known subagent — emit as top-level fallback
      results.push(this.makeEnvelope(item));
      return;
    }
    children.push(item);

    // Re-emit the parent subagent item with updated children
    const subagentItem = this.subagentByToolUseId.get(parentToolUseId);
    if (subagentItem) {
      const updatedSubagent: DisplayItem = {
        ...subagentItem,
        subagentItems: [...children],
      };
      // Update stored reference so future updates carry all children
      this.subagentByToolUseId.set(parentToolUseId, updatedSubagent);
      process.stderr.write(
        `[message-processor] event=update_subagent tool_use_id=${parentToolUseId} child_count=${children.length}\n`,
      );
      results.push(this.makeEnvelope(updatedSubagent));
    } else {
      // Orphaned child — emit as top-level
      results.push(this.makeEnvelope(item));
    }
  }

  /**
   * Update a child item inside a subagent (e.g. tool result arriving for a
   * tool that was emitted as a subagent child). Replaces the child by id
   * in the subagent's children array and re-emits the subagent envelope.
   */
  private updateSubagentChild(
    parentToolUseId: string,
    updatedChild: DisplayItem,
    results: ProcessedMessage[],
  ): void {
    const children = this.subagentMap.get(parentToolUseId);
    if (!children) {
      // No subagent tracking — emit top-level
      results.push(this.makeEnvelope(updatedChild));
      return;
    }

    // Replace child by id
    const idx = children.findIndex((c) => c.id === updatedChild.id);
    if (idx >= 0) {
      children[idx] = updatedChild;
    } else {
      children.push(updatedChild);
    }

    // Re-emit parent subagent with updated children
    const subagentItem = this.subagentByToolUseId.get(parentToolUseId);
    if (subagentItem) {
      const updated: DisplayItem = {
        ...subagentItem,
        subagentItems: [...children],
      };
      this.subagentByToolUseId.set(parentToolUseId, updated);
      results.push(this.makeEnvelope(updated));
    } else {
      results.push(this.makeEnvelope(updatedChild));
    }
  }

  /**
   * Mark all remaining pending tool calls as orphaned.
   * Called when result message arrives — any tool calls still pending
   * will never receive a result.
   *
   * @returns Array of orphaned tool call display item envelopes
   */
  private markOrphanedToolCalls(now: number): ProcessedMessage[] {
    const orphanedUpdates: ProcessedMessage[] = [];
    for (const [toolUseId, pendingItem] of this.toolCallMap) {
      const updatedItem: DisplayItem = {
        ...pendingItem,
        toolStatus: "orphaned" as ToolStatus,
      };
      process.stderr.write(
        `[message-processor] event=orphan_tool_call tool_use_id=${toolUseId}\n`,
      );
      orphanedUpdates.push(this.makeEnvelope(updatedItem));
    }
    this.toolCallMap.clear();
    this.toolCallTimestamps.clear();
    return orphanedUpdates;
  }

  /**
   * Reset processor state. Useful for tests.
   */
  reset(): void {
    this.idCounter = 0;
    this.lastOutputText = undefined;
    this.toolCallMap.clear();
    this.toolCallTimestamps.clear();
    this.subagentMap.clear();
    this.subagentByToolUseId.clear();
    this.accumulator = new RunMetadataAccumulator({});
  }

  /** Build a shutdown run_summary for aborted/cancelled runs. */
  buildShutdownSummary(): RunSummary {
    return this.accumulator.buildShutdownSummary();
  }

  /** Build an error run_summary for iterator failures after SDK startup. */
  buildExecutionErrorSummary(errorMessage: string): RunSummary {
    return this.accumulator.buildExecutionErrorSummary(errorMessage);
  }

  /** Get count of pending (unresolved) tool calls. For testing. */
  get pendingToolCallCount(): number {
    return this.toolCallMap.size;
  }

  /** Get count of active subagent groups. For testing. */
  get activeSubagentCount(): number {
    return this.subagentByToolUseId.size;
  }
}

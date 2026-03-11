/**
 * Stateful SDK message processor.
 *
 * Transforms raw SDK messages into structured DisplayItem objects.
 * Maintains state for tool call → result linking and subagent grouping.
 *
 * @module message-processor
 */

import type { DisplayItem, DisplayItemEnvelope, ToolStatus } from "./display-types.js";
import { classifyRawMessage } from "./message-classifier.js";

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
// MessageProcessor
// ---------------------------------------------------------------------------

/** A processed output item — either a display_item envelope or a pass-through raw message. */
export type ProcessedMessage = Record<string, unknown>;

export class MessageProcessor {
  /** Counter for generating unique display item IDs. */
  private idCounter = 0;

  /** Map from toolUseId → DisplayItem for pending tool calls. */
  private toolCallMap = new Map<string, DisplayItem>();

  /** Map from toolUseId → timestamp when tool call was emitted (for duration). */
  private toolCallTimestamps = new Map<string, number>();

  /** Map from parent_tool_use_id → child display items (subagent grouping). */
  private subagentMap = new Map<string, DisplayItem[]>();

  /** Map from toolUseId → subagent DisplayItem (Task tool calls). */
  private subagentByToolUseId = new Map<string, DisplayItem>();

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
   * - Raw pass-through messages for result/system/error handling
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
        // Forward system messages as-is (Rust routes init-progress)
        process.stderr.write(
          `[message-processor] event=forward_system subtype=${(raw as Record<string, unknown>).subtype ?? "unknown"}\n`,
        );
        return [raw];

      case "user":
        return this.processUserMessage(raw, now);

      case "ai":
        return this.processAiMessage(raw, now);

      default:
        return [];
    }
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
    process.stderr.write(
      `[message-processor] event=emit_display_item item_type=compact_boundary id=${item.id}\n`,
    );
    // Forward the raw system message so agent-store can track compaction events
    return [this.makeEnvelope(item), raw];
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
      // Forward the raw message so agent-store can extract usage/context tokens
      results.push(raw);
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

    // Always forward the raw assistant message so agent-store can extract
    // per-turn context tokens and usage data
    results.push(raw);

    return results;
  }

  // -------------------------------------------------------------------------
  // Result messages — dual-emit
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

    // Mark any remaining pending tool calls as orphaned
    const orphanedItems = this.markOrphanedToolCalls(now);

    const item: DisplayItem = {
      id: this.generateId(),
      type: "result",
      timestamp: now,
      outputText_result: outputText,
      resultStatus,
      errorSubtype,
    };

    process.stderr.write(
      `[message-processor] event=emit_display_item item_type=result id=${item.id} status=${resultStatus} subtype=${subtype ?? "none"} orphaned_tools=${orphanedItems.length}\n`,
    );

    // Emit orphaned tool updates first, then display item + raw result
    return [...orphanedItems, this.makeEnvelope(item), raw];
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

    // Forward error for existing error handling in agent-store
    return [this.makeEnvelope(item), raw];
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
    this.toolCallMap.clear();
    this.toolCallTimestamps.clear();
    this.subagentMap.clear();
    this.subagentByToolUseId.clear();
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

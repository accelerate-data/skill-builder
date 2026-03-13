/**
 * Canonical DisplayItem type definitions.
 *
 * The sidecar owns these types. The frontend mirrors them in
 * `app/src/lib/display-types.ts` (read-only, kept in sync via structural tests).
 *
 * @module display-types
 */

// ---------------------------------------------------------------------------
// DisplayItem — the structured unit of agent output for rendering
// ---------------------------------------------------------------------------

export type DisplayItemType =
  | "thinking"
  | "output"
  | "tool_call"
  | "subagent"
  | "result"
  | "compact_boundary"
  | "error";

export type ToolStatus = "ok" | "error" | "orphaned" | "pending";
export type SubagentStatus = "running" | "complete" | "error";
export type ResultStatus = "success" | "error" | "refusal";

export interface ToolResult {
  content: string;
  isError: boolean;
}

export interface SubagentMetrics {
  outputTokens: number;
  turns: number;
}

export interface DisplayItem {
  /** Unique identifier for this display item. */
  id: string;
  /** Discriminant for rendering. */
  type: DisplayItemType;
  /** When this item was created (epoch ms). */
  timestamp: number;
  /** Token count associated with this item (if available). */
  tokenCount?: number;

  // --- thinking ---
  thinkingText?: string;

  // --- output (text blocks) ---
  outputText?: string;

  // --- tool_call (linked: call → result) ---
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  toolResult?: ToolResult;
  toolStatus?: ToolStatus;
  toolDurationMs?: number;
  /** Pre-computed summary (e.g. "Reading foo.ts"). */
  toolSummary?: string;

  // --- subagent (Task tool calls with nested execution) ---
  subagentDescription?: string;
  subagentType?: string;
  parentToolUseId?: string;
  subagentItems?: DisplayItem[];
  subagentMetrics?: SubagentMetrics;
  subagentStatus?: SubagentStatus;

  // --- result (completion/error display) ---
  outputText_result?: string;
  resultStatus?: ResultStatus;
  errorSubtype?: string;
  /** Structured output from the SDK result (JSON object), used for artifact materialization. */
  structuredOutput?: unknown;
  /** Display-ready markdown extracted by the sidecar from structured output fields. */
  resultMarkdown?: string;

  // --- error ---
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Message classification categories
// ---------------------------------------------------------------------------

export type MessageCategory = "hardNoise" | "compact" | "system" | "user" | "ai";

// ---------------------------------------------------------------------------
// JSONL protocol envelope for display items
// ---------------------------------------------------------------------------

export interface DisplayItemEnvelope {
  type: "display_item";
  item: DisplayItem;
}

// ---------------------------------------------------------------------------
// Version tag for structural sync tests
// ---------------------------------------------------------------------------

export const DISPLAY_TYPES_VERSION = 2;

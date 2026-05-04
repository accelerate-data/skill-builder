/**
 * Pure projection from OpenHands conversation events to DisplayItem mutations.
 *
 * Lossless contract: every input event yields at least one mutation
 * (add or update). Filtering is the renderer's job, not this module's.
 *
 * Pairing: ActionEvent registers a pending entry keyed by tool_call_id;
 * the matching ObservationEvent applies an update to that DisplayItem
 * and clears the pending entry. Dangling observations (no pending entry)
 * are surfaced as standalone tool_call items so nothing is dropped.
 *
 * @module openhands-event-projection
 */

import type { DisplayItem, ToolStatus } from "./display-types";
import {
  getCommandText,
  getErrorText,
  getMessageText,
  getObservationText,
  getToolCallId,
  getToolInput,
  getToolName,
  stringifyEventPayload,
  type OpenHandsConversationEvent,
} from "./openhands-conversation-events";

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface PendingActionEntry {
  /** id of the DisplayItem we already pushed when the ActionEvent arrived */
  displayItemId: string;
  /** tool_call_id from the action — the join key */
  toolCallId: string;
  /** action timestamp in ms (for duration calc when observation arrives) */
  actionTimestampMs: number;
}

export type PendingActions = Record<string, PendingActionEntry>;

export interface DisplayItemPatch {
  /** id of the DisplayItem to mutate */
  id: string;
  /** Shallow-merge fields to overlay onto the existing DisplayItem. */
  patch: Partial<DisplayItem>;
}

export interface ProjectionResult {
  /** New DisplayItems to push onto the run. */
  add: DisplayItem[];
  /** In-place updates to existing DisplayItems (matched by id). */
  update: DisplayItemPatch[];
  /** Mutations to apply to the per-run pending actions map. */
  pendingDelta: {
    set?: Array<{ key: string; value: PendingActionEntry }>;
    delete?: string[];
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newId(): string {
  // crypto.randomUUID is available in modern browsers + node >= 19
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Fallback (test environments without crypto):
  return `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function emptyResult(): ProjectionResult {
  return { add: [], update: [], pendingDelta: {} };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function basename(path: string): string {
  if (!path) return path;
  // Tolerate both POSIX and Windows separators in event payloads.
  const parts = path.split(/[\\/]/).filter((p) => p.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function firstLine(text: string, max = 60): string {
  const line = text.split(/\r?\n/)[0] ?? "";
  return line.length > max ? line.slice(0, max) : line;
}

function getEventSummary(
  event: OpenHandsConversationEvent,
): string | undefined {
  const value = event.event["summary"];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function getActionRecord(
  event: OpenHandsConversationEvent,
): Record<string, unknown> {
  return asRecord(event.event.action);
}

function getObservationRecord(
  event: OpenHandsConversationEvent,
): Record<string, unknown> {
  return asRecord(event.event.observation);
}

function isCondensationEventClass(eventClass: string): boolean {
  return eventClass.startsWith("Condensation");
}

function toolInputAsRecord(
  event: OpenHandsConversationEvent,
): Record<string, unknown> | undefined {
  const value = getToolInput(event);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function makeCollapsedToolCall(args: {
  id: string;
  timestamp: number;
  toolName: string;
  toolSummary: string;
  content: string;
  isError?: boolean;
}): DisplayItem {
  return {
    id: args.id,
    type: "tool_call",
    timestamp: args.timestamp,
    toolName: args.toolName,
    toolSummary: args.toolSummary,
    toolStatus: args.isError ? "error" : "ok",
    toolResult: {
      content: args.content,
      isError: Boolean(args.isError),
    },
  };
}

// ---------------------------------------------------------------------------
// Per-class projections
// ---------------------------------------------------------------------------

function projectMessageEvent(
  event: OpenHandsConversationEvent,
): ProjectionResult {
  const source =
    typeof event.event.source === "string" ? event.event.source : undefined;
  const text = getMessageText(event) ?? "";

  if (source === "user") {
    return {
      add: [
        makeCollapsedToolCall({
          id: newId(),
          timestamp: event.timestamp,
          toolName: "task_sent",
          toolSummary: "Task sent",
          content: text,
        }),
      ],
      update: [],
      pendingDelta: {},
    };
  }

  // agent (or unknown) → output item
  return {
    add: [
      {
        id: newId(),
        type: "output",
        timestamp: event.timestamp,
        outputText: text,
      },
    ],
    update: [],
    pendingDelta: {},
  };
}

interface ActionLabel {
  type: "tool_call" | "subagent" | "thinking";
  toolName: string;
  toolSummary: string;
  /** Optional subagent description when type is subagent */
  subagentDescription?: string;
  /** If true, do not project this event (e.g. FinishTool). */
  skip?: boolean;
}

function labelForActionEvent(
  event: OpenHandsConversationEvent,
): ActionLabel {
  const toolName = getToolName(event);
  const action = getActionRecord(event);
  const input = toolInputAsRecord(event) ?? {};
  const summary = getEventSummary(event);

  if (toolName === "FinishTool") {
    return {
      type: "tool_call",
      toolName: "FinishTool",
      toolSummary: "Finish",
      skip: true,
    };
  }

  if (toolName === "file_editor") {
    const command =
      (typeof action.command === "string" ? action.command : undefined) ??
      (typeof input.command === "string" ? input.command : undefined);
    const path =
      (typeof action.path === "string" ? action.path : undefined) ??
      (typeof input.path === "string" ? input.path : undefined) ??
      "";
    const base = basename(path);

    if (command === "view") {
      return {
        type: "tool_call",
        toolName: "file_editor",
        toolSummary: `Read file: ${base}`,
      };
    }
    if (command === "create") {
      return {
        type: "tool_call",
        toolName: "file_editor",
        toolSummary: `Create file: ${base}`,
      };
    }
    if (command === "str_replace") {
      return {
        type: "tool_call",
        toolName: "file_editor",
        toolSummary: `Edit file: ${base}`,
      };
    }
    if (command === "insert") {
      const insertLine =
        action.insert_line ?? input.insert_line ?? action.insertLine ?? "";
      return {
        type: "tool_call",
        toolName: "file_editor",
        toolSummary: `Insert into ${base}:${insertLine}`,
      };
    }
    return {
      type: "tool_call",
      toolName: "file_editor",
      toolSummary: command
        ? `file_editor: ${command}${base ? ` ${base}` : ""}`
        : `file_editor${base ? `: ${base}` : ""}`,
    };
  }

  if (toolName === "terminal") {
    if (summary) {
      return {
        type: "tool_call",
        toolName: "terminal",
        toolSummary: summary,
      };
    }
    const command = getCommandText(event) ?? "";
    return {
      type: "tool_call",
      toolName: "terminal",
      toolSummary: command
        ? `Ran command: ${command.length > 60 ? command.slice(0, 60) : command}`
        : "Ran command",
    };
  }

  if (toolName === "invoke_skill") {
    const name =
      (typeof action.name === "string" ? action.name : undefined) ??
      (typeof input.name === "string" ? input.name : undefined) ??
      "skill";
    return {
      type: "subagent",
      toolName: "invoke_skill",
      toolSummary: `Using skill: ${name}`,
      subagentDescription: summary,
    };
  }

  if (toolName === "think") {
    const thought =
      (typeof action.thought === "string" ? action.thought : undefined) ??
      (typeof input.thought === "string" ? input.thought : undefined) ??
      "";
    const trimmed = thought.trim();
    const isPlanning =
      trimmed.startsWith("##") ||
      trimmed.startsWith("Plan") ||
      trimmed.startsWith("Step");
    return {
      type: "thinking",
      toolName: "think",
      toolSummary: isPlanning ? "Planning checkpoint" : "Reasoning step",
    };
  }

  // Generic fallback
  const fallbackTool = toolName ?? "tool";
  if (summary) {
    return {
      type: "tool_call",
      toolName: fallbackTool,
      toolSummary: summary,
    };
  }
  let argsHint = "";
  try {
    const inputKeys = Object.keys(input);
    if (inputKeys.length > 0) {
      argsHint = firstLine(JSON.stringify(input), 60);
    }
  } catch {
    argsHint = "";
  }
  return {
    type: "tool_call",
    toolName: fallbackTool,
    toolSummary: argsHint
      ? `${fallbackTool}: ${argsHint}`
      : fallbackTool,
  };
}

function projectActionEvent(
  event: OpenHandsConversationEvent,
): ProjectionResult {
  const label = labelForActionEvent(event);
  if (label.skip) {
    return emptyResult();
  }

  const toolCallId = getToolCallId(event);
  const id = newId();
  const toolInput = toolInputAsRecord(event);

  let item: DisplayItem;
  if (label.type === "subagent") {
    item = {
      id,
      type: "subagent",
      timestamp: event.timestamp,
      toolName: label.toolName,
      toolSummary: label.toolSummary,
      toolStatus: "pending",
      toolUseId: toolCallId,
      toolInput,
      subagentDescription: label.subagentDescription,
      subagentStatus: "running",
    };
  } else if (label.type === "thinking") {
    const action = getActionRecord(event);
    const input = toolInputAsRecord(event) ?? {};
    const thought =
      (typeof action.thought === "string" ? action.thought : undefined) ??
      (typeof input.thought === "string" ? input.thought : undefined) ??
      "";
    item = {
      id,
      type: "thinking",
      timestamp: event.timestamp,
      thinkingText: thought,
      toolName: label.toolName,
      toolSummary: label.toolSummary,
      toolStatus: "pending",
      toolUseId: toolCallId,
      toolInput,
    };
  } else {
    item = {
      id,
      type: "tool_call",
      timestamp: event.timestamp,
      toolName: label.toolName,
      toolSummary: label.toolSummary,
      toolStatus: "pending",
      toolUseId: toolCallId,
      toolInput,
    };
  }

  const result: ProjectionResult = {
    add: [item],
    update: [],
    pendingDelta: {},
  };

  if (toolCallId) {
    result.pendingDelta.set = [
      {
        key: toolCallId,
        value: {
          displayItemId: id,
          toolCallId,
          actionTimestampMs: event.timestamp,
        },
      },
    ];
  }

  return result;
}

function isObservationError(event: OpenHandsConversationEvent): boolean {
  const observation = getObservationRecord(event);
  const directError =
    event.event.is_error ?? event.event.isError ?? observation.is_error ??
    observation.isError;
  if (typeof directError === "boolean" && directError) return true;

  const exitCode =
    event.event.exit_code ??
    event.event.exitCode ??
    observation.exit_code ??
    observation.exitCode;
  if (typeof exitCode === "number" && exitCode !== 0) return true;

  return false;
}

function projectObservationEvent(
  event: OpenHandsConversationEvent,
  pending: PendingActions,
): ProjectionResult {
  const toolCallId = getToolCallId(event);
  const isError = isObservationError(event);
  const observationText =
    getObservationText(event) ?? stringifyEventPayload(event.event.observation ?? event.event);
  const status: ToolStatus = isError ? "error" : "ok";

  if (toolCallId && pending[toolCallId]) {
    const entry = pending[toolCallId];
    const durationMs = Math.max(0, event.timestamp - entry.actionTimestampMs);

    const patch: Partial<DisplayItem> = {
      toolStatus: status,
      toolResult: { content: observationText, isError },
      toolDurationMs: durationMs,
    };

    // For subagent items (invoke_skill), add subagent-shaped fields too.
    // We don't know the prior type here, but shallow-merge is harmless if absent.
    patch.subagentStatus = isError ? "error" : "complete";
    const conclusion =
      observationText.length > 200
        ? `${observationText.slice(0, 200)}…`
        : observationText;
    patch.subagentConclusion = conclusion;

    return {
      add: [],
      update: [{ id: entry.displayItemId, patch }],
      pendingDelta: { delete: [toolCallId] },
    };
  }

  // Dangling observation — surface as a standalone tool_call so nothing is lost.
  const toolName = getToolName(event) ?? "unknown";
  return {
    add: [
      makeCollapsedToolCall({
        id: newId(),
        timestamp: event.timestamp,
        toolName,
        toolSummary: "Observation",
        content: observationText,
        isError,
      }),
    ],
    update: [],
    pendingDelta: {},
  };
}

function projectSystemPromptEvent(
  event: OpenHandsConversationEvent,
): ProjectionResult {
  const sysPrompt = asRecord(event.event.system_prompt);
  const text =
    (typeof sysPrompt.text === "string" ? sysPrompt.text : undefined) ??
    (typeof event.event.system_prompt === "string"
      ? (event.event.system_prompt as string)
      : undefined) ??
    stringifyEventPayload(event.event);

  return {
    add: [
      makeCollapsedToolCall({
        id: newId(),
        timestamp: event.timestamp,
        toolName: "system_prompt",
        toolSummary: "Runtime setup",
        content: text,
      }),
    ],
    update: [],
    pendingDelta: {},
  };
}

function projectCondensationEvent(
  event: OpenHandsConversationEvent,
): ProjectionResult {
  const summary = getEventSummary(event) ?? stringifyEventPayload(event.event);

  return {
    add: [
      makeCollapsedToolCall({
        id: newId(),
        timestamp: event.timestamp,
        toolName: "condensation",
        toolSummary: "Context condensed",
        content: summary,
      }),
    ],
    update: [],
    pendingDelta: {},
  };
}

function projectStateUpdateEvent(
  _event: OpenHandsConversationEvent,
): ProjectionResult {
  // ConversationStateUpdateEvent is hidden from the chat surface — it's pure
  // internal counter/state churn (token deltas, execution_status flips,
  // agent_state). The lifecycle chip in the chat header already represents
  // the user-facing transitions semantically; rendering each intermediate
  // state diff as a row is noise.
  //
  // The event still lands in run.conversationEvents (audit trail preserved);
  // only the projected DisplayItem is suppressed.
  return { add: [], update: [], pendingDelta: {} };
}

function projectErrorEvent(
  event: OpenHandsConversationEvent,
): ProjectionResult {
  const message = getErrorText(event) ?? stringifyEventPayload(event.event);

  return {
    add: [
      {
        id: newId(),
        type: "error",
        timestamp: event.timestamp,
        errorMessage: message,
      },
    ],
    update: [],
    pendingDelta: {},
  };
}

function projectPauseEvent(
  event: OpenHandsConversationEvent,
): ProjectionResult {
  const reason =
    typeof event.event.reason === "string" && event.event.reason.trim().length > 0
      ? event.event.reason
      : "Conversation paused.";

  return {
    add: [
      makeCollapsedToolCall({
        id: newId(),
        timestamp: event.timestamp,
        toolName: "pause",
        toolSummary: "Paused by user",
        content: reason,
      }),
    ],
    update: [],
    pendingDelta: {},
  };
}

function projectUnknownEvent(
  event: OpenHandsConversationEvent,
): ProjectionResult {
  return {
    add: [
      makeCollapsedToolCall({
        id: newId(),
        timestamp: event.timestamp,
        toolName: "unknown_event",
        toolSummary: `Unknown OpenHands event: ${event.eventClass}`,
        content: stringifyEventPayload(event.event),
      }),
    ],
    update: [],
    pendingDelta: {},
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function projectConversationEvent(
  event: OpenHandsConversationEvent,
  pending: PendingActions,
): ProjectionResult {
  switch (event.eventClass) {
    case "MessageEvent":
      return projectMessageEvent(event);
    case "ActionEvent":
      return projectActionEvent(event);
    case "ObservationEvent":
    case "UserRejectObservation":
      return projectObservationEvent(event, pending);
    case "SystemPromptEvent":
      return projectSystemPromptEvent(event);
    case "ConversationStateUpdateEvent":
      return projectStateUpdateEvent(event);
    case "AgentErrorEvent":
    case "ConversationErrorEvent":
      return projectErrorEvent(event);
    case "PauseEvent":
      return projectPauseEvent(event);
    default:
      if (isCondensationEventClass(event.eventClass)) {
        return projectCondensationEvent(event);
      }
      return projectUnknownEvent(event);
  }
}

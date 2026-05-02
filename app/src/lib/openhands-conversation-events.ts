export type OpenHandsConversationStatus =
  | "starting"
  | "running"
  | "completed"
  | "error"
  | "cancelled";

export interface OpenHandsConversationEvent {
  type: "conversation_event";
  runtime: "openhands";
  conversationId?: string;
  agentId?: string;
  eventClass: string;
  event: Record<string, unknown>;
  timestamp: number;
}

export interface OpenHandsConversationState {
  type: "conversation_state";
  runtime: "openhands";
  conversationId?: string;
  agentId?: string;
  status: OpenHandsConversationStatus;
  errorDetail?: string;
  timestamp: number;
}

export function isTerminalConversationStatus(
  status: OpenHandsConversationStatus,
): boolean {
  return status === "completed" || status === "error" || status === "cancelled";
}

export function normalizeConversationEventMessage(
  message: Record<string, unknown>,
): OpenHandsConversationEvent | null {
  if (message.type !== "conversation_event") return null;
  const event = asRecord(message.event);
  const eventClass =
    getString(message, "event_class", "eventClass") ??
    getString(event, "event_class", "eventClass", "event_type", "eventType", "type") ??
    "UnknownEvent";

  return {
    type: "conversation_event",
    runtime: "openhands",
    conversationId: getString(message, "conversation_id", "conversationId"),
    agentId: getString(message, "agent_id", "agentId"),
    eventClass,
    event,
    timestamp: getNumber(message, "timestamp") ?? Date.now(),
  };
}

export function normalizeConversationStateMessage(
  message: Record<string, unknown>,
): OpenHandsConversationState | null {
  if (message.type !== "conversation_state") return null;
  const status = getString(message, "status");
  if (!isConversationStatus(status)) return null;

  return {
    type: "conversation_state",
    runtime: "openhands",
    conversationId: getString(message, "conversation_id", "conversationId"),
    agentId: getString(message, "agent_id", "agentId"),
    status,
    errorDetail: getString(message, "error_detail", "errorDetail"),
    timestamp: getNumber(message, "timestamp") ?? Date.now(),
  };
}

export function getEventText(event: OpenHandsConversationEvent): string | undefined {
  return getString(event.event, "message", "content", "text");
}

export function getReasoningText(event: OpenHandsConversationEvent): string | undefined {
  const values = [
    getString(event.event, "thought"),
    getString(event.event, "reasoning", "reasoning_content", "reasoningContent"),
  ].filter((value): value is string => Boolean(value));
  return values.length > 0 ? values.join("\n\n") : undefined;
}

export function getToolName(event: OpenHandsConversationEvent): string | undefined {
  const action = asRecord(event.event.action);
  return (
    getString(event.event, "tool_name", "toolName", "tool") ??
    getString(action, "tool_name", "toolName", "tool") ??
    getString(event.event, "action")
  );
}

export function getObservationText(event: OpenHandsConversationEvent): string | undefined {
  return getString(
    event.event,
    "content",
    "observation",
    "result",
    "output",
    "message",
    "error",
  );
}

export function getErrorText(event: OpenHandsConversationEvent): string | undefined {
  return getString(event.event, "error", "message", "content", "exception");
}

export function getToolInput(event: OpenHandsConversationEvent): unknown {
  const action = asRecord(event.event.action);
  return (
    event.event.tool_input ??
    event.event.toolInput ??
    event.event.input ??
    event.event.args ??
    action.tool_input ??
    action.toolInput ??
    action.input ??
    action.args
  );
}

export function getCommandText(event: OpenHandsConversationEvent): string | undefined {
  const action = asRecord(event.event.action);
  return getString(event.event, "command", "cmd") ?? getString(action, "command", "cmd");
}

export function stringifyEventPayload(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isConversationStatus(value: unknown): value is OpenHandsConversationStatus {
  return (
    value === "starting" ||
    value === "running" ||
    value === "completed" ||
    value === "error" ||
    value === "cancelled"
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getString(
  record: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function getNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

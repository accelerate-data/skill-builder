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
  toolCallId?: string;
  parentToolCallId?: string;
}

export interface OpenHandsConversationState {
  type: "conversation_state";
  runtime: "openhands";
  conversationId?: string;
  agentId?: string;
  status: OpenHandsConversationStatus;
  errorDetail?: string;
  resultText?: string;
  structuredOutput?: unknown;
  timestamp: number;
}

export type ConversationActionEventProjection =
  | {
      type: "event";
      event: OpenHandsConversationEvent;
    }
  | {
      type: "parallel_action_group";
      llmResponseId: string;
      events: OpenHandsConversationEvent[];
      reasoningText?: string;
    };

export function isTerminalConversationStatus(
  status: OpenHandsConversationStatus,
): boolean {
  return status === "completed" || status === "error" || status === "cancelled";
}

export function normalizeConversationEventMessage(
  message: Record<string, unknown>,
): OpenHandsConversationEvent | null {
  if (message.type !== "conversation_event") return null;
  const event = asEventRecord(message.event);
  const eventClass =
    getString(message, "event_class", "eventClass", "kind") ??
    getString(
      event,
      "event_class",
      "eventClass",
      "kind",
      "event_type",
      "eventType",
      "type",
    ) ??
    "UnknownEvent";

  return {
    type: "conversation_event",
    runtime: "openhands",
    conversationId: getString(message, "conversation_id", "conversationId"),
    agentId: getString(message, "agent_id", "agentId"),
    eventClass,
    event,
    timestamp: getNumber(message, "timestamp") ?? Date.now(),
    toolCallId:
      getString(message, "tool_call_id", "toolCallId") ??
      extractToolCallId(event),
    parentToolCallId:
      getString(message, "parent_tool_call_id", "parentToolCallId") ??
      getString(event, "parent_tool_call_id", "parentToolCallId"),
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
    resultText: getString(message, "result_text", "resultText"),
    structuredOutput: message.structured_output ?? message.structuredOutput,
    timestamp: getNumber(message, "timestamp") ?? Date.now(),
  };
}

export function getMessageText(
  event: OpenHandsConversationEvent,
): string | undefined {
  return firstText(
    getString(event.event, "message", "text"),
    collectContentText(event.event.content),
    collectLlmMessageText(event.event.llm_message),
  );
}

export function getEventText(
  event: OpenHandsConversationEvent,
): string | undefined {
  return getMessageText(event);
}

export function getReasoningText(
  event: OpenHandsConversationEvent,
): string | undefined {
  const llmMessage = asRecord(event.event.llm_message);
  const values = [
    getString(
      event.event,
      "thought",
      "reasoning",
      "reasoning_content",
      "reasoningContent",
    ),
    getString(llmMessage, "reasoning", "reasoning_content", "reasoningContent"),
    collectReasoningFromContent(event.event.content),
    collectReasoningFromContent(llmMessage.content),
    collectThinkingBlocks(
      event.event.thinking_blocks ?? event.event.thinkingBlocks,
    ),
    collectThinkingBlocks(
      llmMessage.thinking_blocks ?? llmMessage.thinkingBlocks,
    ),
  ].filter(isNonEmptyString);

  return values.length > 0 ? values.join("\n\n") : undefined;
}

export function getToolName(
  event: OpenHandsConversationEvent,
): string | undefined {
  const action = asRecord(event.event.action);
  const toolCall = findToolCall(event.event, action);
  const toolFunction = asRecord(toolCall.function);

  return (
    getString(event.event, "tool_name", "toolName", "tool") ??
    getString(action, "tool_name", "toolName", "tool") ??
    getString(toolCall, "name", "tool_name", "toolName", "tool") ??
    getString(toolFunction, "name") ??
    getString(event.event, "action")
  );
}

export function getToolCallId(
  event: OpenHandsConversationEvent,
): string | undefined {
  if (typeof event.toolCallId === "string" && event.toolCallId.trim().length > 0) {
    return event.toolCallId;
  }
  return extractToolCallId(event.event);
}

export function getParentToolCallId(
  event: OpenHandsConversationEvent,
): string | undefined {
  if (
    typeof event.parentToolCallId === "string" &&
    event.parentToolCallId.trim().length > 0
  ) {
    return event.parentToolCallId;
  }
  return getString(event.event, "parent_tool_call_id", "parentToolCallId");
}

function extractToolCallId(
  value: Record<string, unknown>,
): string | undefined {
  const action = asRecord(value.action);
  const observation = asRecord(value.observation);
  const toolCall = findToolCall(value, action);

  return (
    getString(value, "tool_call_id", "toolCallId") ??
    getString(action, "tool_call_id", "toolCallId") ??
    getString(observation, "tool_call_id", "toolCallId") ??
    getString(toolCall, "id", "tool_call_id", "toolCallId")
  );
}

export function getLlmResponseId(
  event: OpenHandsConversationEvent,
): string | undefined {
  const action = asRecord(event.event.action);
  const llmMessage = asRecord(event.event.llm_message);

  return (
    getString(event.event, "llm_response_id", "llmResponseId") ??
    getString(action, "llm_response_id", "llmResponseId") ??
    getString(llmMessage, "llm_response_id", "llmResponseId", "id")
  );
}

export function getObservationText(
  event: OpenHandsConversationEvent,
): string | undefined {
  const observation = asRecord(event.event.observation);
  const result = asRecord(event.event.result);
  const output = asRecord(event.event.output);

  return firstText(
    getString(event.event, "content", "observation", "message", "error"),
    getString(observation, "content", "message", "result", "output", "error"),
    getString(result, "content", "message", "result", "output", "error"),
    getString(output, "content", "message", "result", "output", "error"),
    collectContentText(event.event.content),
    collectContentText(observation.content),
  );
}

export function getErrorText(
  event: OpenHandsConversationEvent,
): string | undefined {
  const error = asRecord(event.event.error);
  const errorDetail = asRecord(
    event.event.error_detail ?? event.event.errorDetail,
  );
  const exception = asRecord(event.event.exception);

  return firstText(
    getString(
      event.event,
      "error",
      "message",
      "content",
      "exception",
      "error_detail",
      "errorDetail",
    ),
    getString(error, "message", "content", "detail", "error"),
    getString(errorDetail, "message", "content", "detail", "error"),
    getString(exception, "message", "content", "detail", "error"),
  );
}

export function getToolInput(event: OpenHandsConversationEvent): unknown {
  const action = asRecord(event.event.action);
  const toolCall = findToolCall(event.event, action);
  const toolFunction = asRecord(toolCall.function);
  const value =
    event.event.tool_input ??
    event.event.toolInput ??
    event.event.input ??
    event.event.args ??
    event.event.arguments ??
    action.tool_input ??
    action.toolInput ??
    action.input ??
    action.args ??
    action.arguments ??
    toolCall.input ??
    toolCall.args ??
    toolCall.arguments ??
    toolFunction.arguments;

  return parseJsonIfPossible(value);
}

export function getCommandText(
  event: OpenHandsConversationEvent,
): string | undefined {
  const action = asRecord(event.event.action);
  const input = asRecord(getToolInput(event));

  return (
    getString(event.event, "command", "cmd") ??
    getString(action, "command", "cmd") ??
    getString(input, "command", "cmd")
  );
}

export function getInternalEventSummary(
  event: OpenHandsConversationEvent,
): string | undefined {
  if (event.eventClass === "SystemPromptEvent") {
    return "System prompt prepared.";
  }

  if (isCondensationEventClass(event.eventClass)) {
    return (
      getString(event.event, "summary", "message", "content") ??
      "Conversation context condensed."
    );
  }

  if (event.eventClass === "ConversationStateUpdateEvent") {
    const state = event.event.state ?? event.event.conversation_state;
    if (state !== undefined)
      return `State updated: ${stringifyEventPayloadCompact(state)}`;
    return "Conversation state updated.";
  }

  if (event.eventClass === "PauseEvent") {
    const reason = getString(event.event, "reason", "message");
    return reason ? `Paused: ${reason}` : "Conversation paused.";
  }

  return undefined;
}

export function isInternalOpenHandsEventClass(eventClass: string): boolean {
  return (
    eventClass === "SystemPromptEvent" ||
    isCondensationEventClass(eventClass) ||
    eventClass === "ConversationStateUpdateEvent" ||
    eventClass === "PauseEvent"
  );
}

export function groupConversationActionEvents(
  events: OpenHandsConversationEvent[],
): ConversationActionEventProjection[] {
  const groups: ConversationActionEventProjection[] = [];
  let index = 0;

  while (index < events.length) {
    const event = events[index];
    const llmResponseId = getGroupableActionResponseId(event);

    if (!llmResponseId) {
      groups.push({ type: "event", event });
      index += 1;
      continue;
    }

    const actionEvents = [event];
    let nextIndex = index + 1;
    while (
      nextIndex < events.length &&
      getGroupableActionResponseId(events[nextIndex]) === llmResponseId
    ) {
      actionEvents.push(events[nextIndex]);
      nextIndex += 1;
    }

    if (actionEvents.length > 1) {
      groups.push({
        type: "parallel_action_group",
        llmResponseId,
        events: actionEvents,
        reasoningText: actionEvents
          .map(getReasoningText)
          .find(isNonEmptyString),
      });
    } else {
      groups.push({ type: "event", event });
    }

    index = nextIndex;
  }

  return groups;
}

export function stringifyEventPayload(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, createJsonReplacer(), 2);
  } catch {
    return String(value);
  }
}

function stringifyEventPayloadCompact(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, createJsonReplacer());
  } catch {
    return String(value);
  }
}

function isConversationStatus(
  value: unknown,
): value is OpenHandsConversationStatus {
  return (
    value === "starting" ||
    value === "running" ||
    value === "completed" ||
    value === "error" ||
    value === "cancelled"
  );
}

function getGroupableActionResponseId(
  event: OpenHandsConversationEvent,
): string | undefined {
  if (event.eventClass !== "ActionEvent") return undefined;
  return getLlmResponseId(event);
}

function isCondensationEventClass(eventClass: string): boolean {
  return eventClass.startsWith("Condensation");
}

function collectLlmMessageText(value: unknown): string | undefined {
  const llmMessage = asRecord(value);
  return firstText(
    getString(llmMessage, "message", "text", "content"),
    collectContentText(llmMessage.content),
  );
}

function collectContentText(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return trimToUndefined(value);
  if (Array.isArray(value)) {
    return joinText(value.map(collectContentBlockText));
  }
  if (!isPlainRecord(value)) return undefined;

  return collectContentBlockText(value);
}

function collectContentBlockText(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return trimToUndefined(value);
  if (!isPlainRecord(value)) return undefined;
  const block = asRecord(value);
  return firstText(
    getString(block, "text", "content", "message"),
    collectContentText(block.content),
  );
}

function collectReasoningFromContent(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) return collectReasoningFromContentBlock(value);
  return joinText(value.map(collectReasoningFromContentBlock));
}

function collectReasoningFromContentBlock(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return undefined;
  if (!isPlainRecord(value)) return undefined;
  const block = asRecord(value);
  return firstText(
    getString(
      block,
      "reasoning",
      "reasoning_content",
      "reasoningContent",
      "thinking",
    ),
    collectThinkingBlocks(block.thinking_blocks ?? block.thinkingBlocks),
  );
}

function collectThinkingBlocks(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return trimToUndefined(value);
  if (!Array.isArray(value)) return collectThinkingBlock(value);
  return joinText(value.map(collectThinkingBlock));
}

function collectThinkingBlock(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return trimToUndefined(value);
  if (!isPlainRecord(value)) return undefined;
  const block = asRecord(value);
  return firstText(
    getString(
      block,
      "text",
      "content",
      "message",
      "thinking",
      "reasoning_content",
      "reasoningContent",
    ),
    collectThinkingBlocks(block.thinking_blocks ?? block.thinkingBlocks),
  );
}

function findToolCall(
  event: Record<string, unknown>,
  action: Record<string, unknown>,
): Record<string, unknown> {
  const directToolCall = asRecord(event.tool_call ?? event.toolCall);
  if (Object.keys(directToolCall).length > 0) return directToolCall;

  const actionToolCall = asRecord(action.tool_call ?? action.toolCall);
  if (Object.keys(actionToolCall).length > 0) return actionToolCall;

  const toolCalls =
    event.tool_calls ??
    event.toolCalls ??
    action.tool_calls ??
    action.toolCalls;
  if (Array.isArray(toolCalls)) {
    return asRecord(toolCalls[0]);
  }

  return {};
}

function parseJsonIfPossible(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (isPlainRecord(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asEventRecord(value: unknown): Record<string, unknown> {
  if (isPlainRecord(value)) {
    return value as Record<string, unknown>;
  }
  if (value !== undefined) {
    return { raw: value };
  }
  return {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function firstText(...values: Array<string | undefined>): string | undefined {
  return values.find(isNonEmptyString);
}

function joinText(values: Array<string | undefined>): string | undefined {
  const text = values.filter(isNonEmptyString).join("\n\n");
  return trimToUndefined(text);
}

function trimToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function createJsonReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();

  return (_key: string, value: unknown) => {
    if (typeof value === "bigint") return value.toString();
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value;
  };
}

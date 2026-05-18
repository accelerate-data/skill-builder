import type {
  ActionEvent,
  BaseOpenHandsEvent,
  ConversationDisplayKind,
  ConversationEventEnvelope,
  MessageEvent,
  MessageContent,
  OpenHandsConversationEvent,
} from "./conversation-event-types";
export type { OpenHandsConversationEvent } from "./conversation-event-types";

export type ConversationActionEventProjection =
  | {
      type: "event";
      event: OpenHandsConversationEvent;
    }
  | {
      type: "parallel_action_group";
      llmResponseId: string;
      events: ActionEvent[];
      reasoningText?: string;
    };

let canonicalConversationEventSequence = 0;

export function normalizeConversationEventMessage(
  message: Record<string, unknown>,
): OpenHandsConversationEvent | null {
  if (message.type === "conversation_event" && isPlainRecord(message.event)) {
    const eventRecord = normalizeWrappedEventRecord(message);
    return normalizeOpenHandsEventRecord(eventRecord, {
      conversationId: getAnyString(message, "conversation_id", "conversationId"),
      parentToolCallId: getAnyString(message, "parent_tool_call_id", "parentToolCallId"),
    });
  }

  if (message.type === "conversation_state") {
    return normalizeLegacyConversationStateEvent(message);
  }

  return normalizeOpenHandsEventRecord(message);
}

export function normalizeConversationStateMessage(
  message: Record<string, unknown>,
): {
  type: "conversation_state";
  runtime: "openhands";
  conversationId?: string;
  status?: string;
  resultText?: string | null;
  errorDetail?: string | null;
  timestamp: number;
} | null {
  if (message.type !== "conversation_state") {
    return null;
  }

  return {
    type: "conversation_state",
    runtime: "openhands",
    conversationId: getAnyString(message, "conversation_id", "conversationId"),
    status: getString(message, "status"),
    resultText: getNullableString(message, "result_text", "resultText"),
    errorDetail: getNullableString(message, "error_detail", "errorDetail"),
    timestamp: parseTimestampMs(normalizeTimestampString(message.timestamp)),
  };
}

export function normalizeOpenHandsEventRecord(
  value: unknown,
  _diagnostics?: {
    conversationId?: string | null;
    parentToolCallId?: string | null;
  },
): OpenHandsConversationEvent | null {
  const record = asRecord(value);
  if (record.type === "conversation_state") {
    return normalizeLegacyConversationStateEvent(record);
  }

  if (!getAnyString(record, "kind", "event_class", "eventClass") && isPlainRecord(record.event)) {
    return normalizeOpenHandsEventRecord(normalizeWrappedEventRecord(record), _diagnostics);
  }

  const kind = normalizeKind(getAnyString(record, "kind", "event_class", "eventClass"));
  if (!kind) return null;

  const base = buildBaseEvent(record, kind);
  switch (kind) {
    case "MessageEvent":
      return {
        ...base,
        kind,
        llm_message: normalizeMessage(record),
        activated_skills: readStringArray(record.activated_skills),
        sender: getString(record, "sender"),
      };
    case "ActionEvent":
      const actionFromRecord = asRecord(record.action);
      const toolCallFunction = asRecord(asRecord(record.tool_call).function);
      return {
        ...base,
        kind,
        tool_name:
          getAnyString(record, "tool_name", "toolName") ??
          getString(toolCallFunction, "name") ??
          "unknown",
        tool_call_id: extractToolCallId(record) ?? "",
        action:
          Object.keys(actionFromRecord).length > 0
            ? actionFromRecord
            : {
                name: getString(toolCallFunction, "name"),
                arguments: toolCallFunction.arguments,
              },
        thought: joinText([
          getAnyString(record, "reasoning_content", "reasoningContent"),
          readThought(record),
          readThinkingBlocks(record),
        ]),
        llm_response_id: getAnyString(record, "llm_response_id", "llmResponseId"),
      };
    case "ObservationEvent":
      return {
        ...base,
        kind,
        tool_name: getAnyString(record, "tool_name", "toolName") ?? "unknown",
        tool_call_id: extractToolCallId(record) ?? "",
        observation: record.observation,
        action_id:
          getAnyString(record, "action_id", "actionId") ??
          extractToolCallId(record) ??
          "",
      };
    case "AgentErrorEvent":
      return {
        ...base,
        kind,
        tool_name: getAnyString(record, "tool_name", "toolName") ?? "unknown",
        tool_call_id: extractToolCallId(record) ?? "",
        error:
          getString(record, "error") ??
          getAnyString(asRecord(record.error), "message", "detail") ??
          getString(asRecord(record.observation), "content") ??
          "Tool call failed",
      };
    case "SystemPromptEvent":
      return {
        ...base,
        kind,
        system_prompt: record.system_prompt ?? record.systemPrompt ?? null,
        tools: Array.isArray(record.tools) ? record.tools : [],
      };
    case "PauseEvent":
      return { ...base, kind, reason: getString(record, "reason") };
    case "CondensationRequest":
      return { ...base, kind };
    case "CondensationSummaryEvent":
      return {
        ...base,
        kind,
        summary: getString(record, "summary") ?? "",
      };
    case "Condensation":
      return {
        ...base,
        kind,
        forgotten_event_ids: readStringArray(record.forgotten_event_ids) ?? [],
        summary:
          typeof record.summary === "string" || record.summary == null
            ? (record.summary as string | null | undefined)
            : undefined,
        summary_offset:
          typeof record.summary_offset === "number" || record.summary_offset == null
            ? (record.summary_offset as number | null | undefined)
            : undefined,
        llm_response_id: getAnyString(record, "llm_response_id", "llmResponseId") ?? "",
      };
    case "ConversationStateUpdateEvent":
      return {
        ...base,
        kind,
        key: getString(record, "key") ?? (record.state !== undefined ? "state" : ""),
        value: record.value ?? record.state,
        previous_value: record.previous_value ?? record.previousValue,
      };
    case "ConversationErrorEvent":
      return {
        ...base,
        kind,
        code: getString(record, "code") ?? "conversation_error",
        detail:
          getAnyString(record, "detail", "message") ??
          getAnyString(asRecord(record.error_detail), "message", "detail") ??
          "",
      };
    case "LLMCompletionLogEvent":
      return {
        ...base,
        kind,
        filename: getString(record, "filename") ?? "",
        log_data: getAnyString(record, "log_data", "logData") ?? "",
        model_name: getAnyString(record, "model_name", "modelName"),
        usage_id: getAnyString(record, "usage_id", "usageId"),
      };
    case "UserRejectObservation":
      return {
        ...base,
        kind,
        tool_name: getAnyString(record, "tool_name", "toolName") ?? "unknown",
        tool_call_id: extractToolCallId(record) ?? "",
        action_id: getAnyString(record, "action_id", "actionId") ?? "",
        rejection_reason:
          getAnyString(record, "rejection_reason", "rejectionReason") ??
          getAnyString(asRecord(record.observation), "message", "content") ??
          "",
        rejection_source:
          getAnyString(record, "rejection_source", "rejectionSource") === "system"
            ? "system"
            : "user",
      };
    case "ConfirmationRequestEvent":
      return {
        ...base,
        kind,
        action_id: getAnyString(record, "action_id", "actionId") ?? "",
        action:
          (normalizeOpenHandsEventRecord(asRecord(record.action)) as ActionEvent | null) ??
          {
            ...base,
            kind: "ActionEvent",
            tool_name: "unknown",
            tool_call_id: "",
            action: {},
          },
        risk_level:
          readRiskLevel(getAnyString(record, "risk_level", "riskLevel")) ?? undefined,
        risk_assessment: getAnyString(record, "risk_assessment", "riskAssessment"),
      };
    case "ConfirmationResponseEvent":
      return {
        ...base,
        kind,
        action_id: getAnyString(record, "action_id", "actionId") ?? "",
        accepted: Boolean(record.accepted),
        reason: getString(record, "reason"),
      };
    case "TokenEvent":
      return {
        ...base,
        kind,
        prompt_token_ids: readNumberArray(record.prompt_token_ids) ?? [],
        response_token_ids: readNumberArray(record.response_token_ids) ?? [],
      };
    case "StuckDetectionEvent":
      return {
        ...base,
        kind,
        pattern:
          readStuckPattern(getString(record, "pattern")) ?? "action_observation_loop",
        repetitions: getNumber(record, "repetitions") ?? 0,
        description: getString(record, "description") ?? "",
      };
    case "FinishEvent":
      return {
        ...base,
        kind,
        message: getString(record, "message") ?? "",
        success: typeof record.success === "boolean" ? record.success : undefined,
      };
    case "ThinkEvent":
      return {
        ...base,
        kind,
        thought: getString(record, "thought") ?? "",
      };
    case "HookExecutionEvent":
      return {
        ...base,
        kind,
        source: "hook",
        hook_event_type:
          readHookExecutionEventType(getAnyString(record, "hook_event_type", "hookEventType")) ??
          "Stop",
        hook_command: getAnyString(record, "hook_command", "hookCommand") ?? "",
        tool_name: getNullableString(record, "tool_name", "toolName"),
        success: Boolean(record.success),
        blocked: Boolean(record.blocked),
        exit_code: getNumber(record, "exit_code", "exitCode") ?? 0,
        stdout: getString(record, "stdout") ?? "",
        stderr: getString(record, "stderr") ?? "",
        reason: getNullableString(record, "reason"),
        additional_context: getNullableString(
          record,
          "additional_context",
          "additionalContext",
        ),
        error: getNullableString(record, "error"),
        action_id: getNullableString(record, "action_id", "actionId"),
        message_id: getNullableString(record, "message_id", "messageId"),
        hook_input: isPlainRecord(record.hook_input ?? record.hookInput)
          ? asRecord(record.hook_input ?? record.hookInput)
          : null,
      };
    default:
      return null;
  }
}

export function buildCanonicalConversationEventEnvelope(
  event: OpenHandsConversationEvent,
  fallbackConversationId?: string | null,
  diagnostics?: {
    conversationId?: string | null;
    parentToolCallId?: string | null;
    rawEvent?: unknown;
  },
): ConversationEventEnvelope {
  const conversationId = diagnostics?.conversationId ?? fallbackConversationId;
  if (!conversationId) {
    throw new Error("Unable to resolve a canonical conversation identity.");
  }
  canonicalConversationEventSequence += 1;

  return {
    eventId: `${conversationId}:${event.id}:${canonicalConversationEventSequence}`,
    conversationId,
    origin: "backend",
    status: "observed",
    createdAtMs: parseTimestampMs(event.timestamp),
    display: {
      kind: getConversationEventDisplayKind(event),
    },
    payload: {
      openHandsEvent: event,
      openHandsDiagnostics: {
        conversationId,
        toolCallId: getToolCallId(event),
        parentToolCallId:
          diagnostics?.parentToolCallId ??
          getAnyString(asRecord(diagnostics?.rawEvent), "parent_tool_call_id", "parentToolCallId"),
        rawEvent: diagnostics?.rawEvent ?? event,
      },
      rawOpenHandsEvent: diagnostics?.rawEvent ?? event,
    },
  };
}

function getConversationEventDisplayKind(
  event: OpenHandsConversationEvent,
): ConversationDisplayKind {
  switch (event.kind) {
    case "MessageEvent":
      return getMessageRole(event) === "user" ? "user_message" : "agent_message";
    case "ActionEvent":
      return "tool_call";
    case "ObservationEvent":
      return "tool_result";
    case "AgentErrorEvent":
    case "ConversationErrorEvent":
      return "error";
    case "PauseEvent":
    case "CondensationRequest":
    case "Condensation":
    case "ConversationStateUpdateEvent":
    case "LLMCompletionLogEvent":
    case "TokenEvent":
    case "StuckDetectionEvent":
    case "FinishEvent":
    case "HookExecutionEvent":
      return "state";
    default:
      return "system";
  }
}

export function getMessageText(
  event: OpenHandsConversationEvent,
): string | undefined {
  if (event.kind !== "MessageEvent") return undefined;
  return firstText(
    getAnyString(asRecord(event.llm_message), "message", "text"),
    collectContentText(event.llm_message.content),
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
  if (event.kind === "ThinkEvent") {
    return trimToUndefined(event.thought);
  }

  if (event.kind === "ActionEvent") {
    if (event.tool_name === "think" && isNonEmptyString(event.thought)) {
      return trimToUndefined(event.thought.split(/\n\s*\n/, 1)[0] ?? event.thought);
    }

    if (event.tool_name === "think") {
      return undefined;
    }

    return firstText(
      trimToUndefined(event.thought ?? ""),
      getString(event.action, "thought"),
      collectContentText(event.action.thought),
    );
  }

  return undefined;
}

export function getToolName(
  event: OpenHandsConversationEvent,
): string | undefined {
  switch (event.kind) {
    case "ActionEvent":
    case "ObservationEvent":
    case "AgentErrorEvent":
    case "UserRejectObservation":
      return event.tool_name;
    case "ConfirmationRequestEvent":
      return event.action.tool_name;
    default:
      return undefined;
  }
}

export function getToolCallId(
  event: OpenHandsConversationEvent,
): string | undefined {
  switch (event.kind) {
    case "ActionEvent":
    case "ObservationEvent":
    case "AgentErrorEvent":
    case "UserRejectObservation":
      return trimToUndefined(event.tool_call_id);
    case "ConfirmationRequestEvent":
      return trimToUndefined(event.action.tool_call_id);
    default:
      return undefined;
  }
}

export function getParentToolCallId(
  diagnostics: ConversationEventEnvelope["payload"]["openHandsDiagnostics"],
): string | undefined {
  return trimToUndefined(diagnostics?.parentToolCallId ?? "");
}

export function getLlmResponseId(
  event: OpenHandsConversationEvent,
): string | undefined {
  if (event.kind !== "ActionEvent") return undefined;
  return trimToUndefined(event.llm_response_id ?? "");
}

export function getObservationText(
  event: OpenHandsConversationEvent,
): string | undefined {
  if (event.kind !== "ObservationEvent" && event.kind !== "UserRejectObservation") {
    return undefined;
  }

  if (event.kind === "UserRejectObservation") {
    return trimToUndefined(event.rejection_reason);
  }

  return firstText(
    getAnyString(asRecord(event.observation), "content", "message", "result", "output", "error"),
    collectContentText(asRecord(event.observation).content),
    typeof event.observation === "string" ? trimToUndefined(event.observation) : undefined,
    stringifyEventPayload(event.observation),
  );
}

export function getErrorText(
  event: OpenHandsConversationEvent,
): string | undefined {
  switch (event.kind) {
    case "AgentErrorEvent":
      return trimToUndefined(event.error);
    case "ConversationErrorEvent":
      return trimToUndefined(event.detail);
    default:
      return undefined;
  }
}

export function getToolInput(event: OpenHandsConversationEvent): unknown {
  if (event.kind === "ActionEvent") {
    return parseJsonIfPossible(event.action.arguments ?? event.action.input ?? event.action.args);
  }
  if (event.kind === "ConfirmationRequestEvent") {
    return parseJsonIfPossible(
      event.action.action.arguments ??
        event.action.action.input ??
        event.action.action.args,
    );
  }
  return undefined;
}

export function getCommandText(
  event: OpenHandsConversationEvent,
): string | undefined {
  if (event.kind === "ActionEvent") {
    const input = asRecord(getToolInput(event));
    return getAnyString(event.action, "command", "cmd") ?? getAnyString(input, "command", "cmd");
  }
  if (event.kind === "ObservationEvent") {
    const observation = asRecord(event.observation);
    return getAnyString(observation, "command", "cmd");
  }
  return undefined;
}

export function getInternalEventSummary(
  event: OpenHandsConversationEvent,
): string | undefined {
  switch (event.kind) {
    case "SystemPromptEvent":
      return "System prompt prepared.";
    case "CondensationRequest":
      return "Conversation context condensed.";
    case "Condensation":
    case "CondensationSummaryEvent":
      return event.kind === "CondensationSummaryEvent"
        ? trimToUndefined(event.summary)
        : trimToUndefined(event.summary ?? "") ?? "Conversation context condensed.";
    case "ConversationStateUpdateEvent":
      if (event.key === "state") {
        return `State updated: ${stringifyEventPayloadCompact(event.value)}`;
      }
      return event.key
        ? `State updated: ${event.key} = ${stringifyEventPayloadCompact(event.value)}`
        : "Conversation state updated.";
    case "PauseEvent":
      return event.reason ? `Paused: ${event.reason}` : "Conversation paused.";
    case "FinishEvent":
      return event.message;
    default:
      return undefined;
  }
}

export function getSystemPromptText(
  event: OpenHandsConversationEvent,
): string | undefined {
  if (event.kind !== "SystemPromptEvent") {
    return undefined;
  }

  return firstText(
    getAnyString(asRecord(event.system_prompt), "text", "content", "prompt"),
    collectContentText(event.system_prompt),
  );
}

export function isInternalOpenHandsEventKind(kind: string): boolean {
  return [
    "PauseEvent",
    "CondensationRequest",
    "Condensation",
    "ConversationStateUpdateEvent",
    "LLMCompletionLogEvent",
    "TokenEvent",
    "StuckDetectionEvent",
    "FinishEvent",
    "HookExecutionEvent",
  ].includes(kind);
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

    if (event.kind !== "ActionEvent") {
      groups.push({ type: "event", event });
      index += 1;
      continue;
    }

    const actionEvents: ActionEvent[] = [event];
    let nextIndex = index + 1;
    while (
      nextIndex < events.length &&
      getGroupableActionResponseId(events[nextIndex]) === llmResponseId
    ) {
      const nextEvent = events[nextIndex];
      if (nextEvent.kind === "ActionEvent") {
        actionEvents.push(nextEvent);
      }
      nextIndex += 1;
    }

    if (actionEvents.length > 1) {
      groups.push({
        type: "parallel_action_group",
        llmResponseId,
        events: actionEvents,
        reasoningText: actionEvents.map(getReasoningText).find(isNonEmptyString),
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

function buildBaseEvent(
  record: Record<string, unknown>,
  kind: string,
): BaseOpenHandsEvent {
  return {
    id:
      getString(record, "id") ??
      `evt_${parseTimestampMs(normalizeTimestampString(record.timestamp))}_${kind}_${Math.random()
        .toString(16)
        .slice(2, 10)}`,
    kind,
    timestamp: normalizeTimestampString(record.timestamp),
    source: readEventSource(getString(record, "source")),
  };
}

function normalizeKind(kind?: string): string | undefined {
  switch (kind) {
    case "CondensationStartEvent":
      return "CondensationRequest";
    default:
      return kind;
  }
}

function normalizeWrappedEventRecord(
  wrapper: Record<string, unknown>,
): Record<string, unknown> {
  const nested = asRecord(wrapper.event);
  const nestedKind = normalizeKind(
    getAnyString(nested, "kind", "event_class", "eventClass"),
  );
  const wrapperKind = normalizeKind(
    getAnyString(wrapper, "kind", "event_class", "eventClass"),
  );
  const nestedType = getString(nested, "type");

  return {
    ...nested,
    kind:
      nestedKind ??
      (nestedType === "conversation_state" ? undefined : wrapperKind),
    source: getString(nested, "source") ?? getString(wrapper, "source"),
    timestamp: nested.timestamp ?? wrapper.timestamp,
    tool_call_id:
      nested.tool_call_id ??
      wrapper.tool_call_id ??
      extractToolCallId(nested) ??
      extractToolCallId(wrapper),
    parent_tool_call_id:
      nested.parent_tool_call_id ?? wrapper.parent_tool_call_id ?? wrapper.parentToolCallId,
  };
}

function normalizeLegacyConversationStateEvent(
  record: Record<string, unknown>,
): OpenHandsConversationEvent | null {
  const status = getString(record, "status");
  const timestamp = normalizeTimestampString(record.timestamp);
  const id =
    getString(record, "id") ??
    `legacy_state_${parseTimestampMs(timestamp)}_${Math.random().toString(16).slice(2, 10)}`;

  if (!status) return null;

  if (status === "completed" || status === "finished") {
    return {
      id,
      kind: "FinishEvent",
      timestamp,
      source: "environment",
      message: getNullableString(record, "result_text", "resultText") ?? "",
      success: true,
    };
  }

  if (status === "error") {
    return {
      id,
      kind: "ConversationErrorEvent",
      timestamp,
      source: "environment",
      code: "conversation_error",
      detail:
        getNullableString(record, "error_detail", "errorDetail") ??
        "OpenHands runtime run failed",
    };
  }

  if (status === "paused") {
    return {
      id,
      kind: "PauseEvent",
      timestamp,
      source: "user",
      reason: getNullableString(record, "error_detail", "errorDetail") ?? undefined,
    };
  }

  return {
    id,
    kind: "ConversationStateUpdateEvent",
    timestamp,
    source: "environment",
    key: "execution_status",
    value: status,
    previous_value: undefined,
  };
}

function normalizeMessage(record: Record<string, unknown>): MessageEvent["llm_message"] {
  if (isPlainRecord(record.llm_message)) {
    return record.llm_message as MessageEvent["llm_message"];
  }

  const source = getString(record, "source");
  const role =
    source === "user"
      ? "user"
      : source === "agent" || source === "assistant"
        ? "assistant"
        : undefined;
  const text =
    getAnyString(record, "message", "text") ??
    collectContentText(record.content) ??
    getString(record, "summary");

  return {
    role,
    content: text ? [{ type: "text", text }] : [],
  };
}

function normalizeTimestampString(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return new Date().toISOString();
}

function parseTimestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function getGroupableActionResponseId(
  event: OpenHandsConversationEvent,
): string | undefined {
  if (event.kind !== "ActionEvent") return undefined;
  return getLlmResponseId(event);
}

function getMessageRole(event: MessageEvent): string | undefined {
  const llmMessage = asRecord(event.llm_message);
  return getString(llmMessage, "role") ?? event.source;
}

function collectContentText(value: MessageContent): string | undefined {
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
    getAnyString(block, "text", "content", "message"),
    collectContentText(block.content),
  );
}

function extractToolCallId(raw: Record<string, unknown>): string | undefined {
  return (
    getAnyString(raw, "tool_call_id", "toolCallId") ??
    getAnyString(asRecord(raw.action), "tool_call_id", "toolCallId") ??
    getAnyString(asRecord(raw.observation), "tool_call_id", "toolCallId") ??
    getAnyString(asRecord(raw.tool_call), "id", "tool_call_id", "toolCallId")
  );
}

function getAnyString(
  value: unknown,
  ...keys: string[]
): string | undefined {
  const record = asRecord(value);
  for (const key of keys) {
    const found = getString(record, key);
    if (typeof found === "string") {
      return found;
    }
  }
  return undefined;
}

function readThought(record: Record<string, unknown>): string | undefined {
  return firstText(
    getString(record, "thought"),
    collectContentText(record.thought),
    getString(asRecord(record.action), "thought"),
  );
}

function readThinkingBlocks(record: Record<string, unknown>): string | undefined {
  const blocks = Array.isArray(record.thinking_blocks) ? record.thinking_blocks : [];
  return joinText(
    blocks.map((block) =>
      getAnyString(asRecord(block), "thinking", "text", "content", "message"),
    ),
  );
}

function parseJsonIfPossible(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function readNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is number => typeof item === "number");
}

function readRiskLevel(
  value?: string,
): "low" | "medium" | "high" | "unknown" | undefined {
  if (value === "low" || value === "medium" || value === "high" || value === "unknown") {
    return value;
  }
  return undefined;
}

function readStuckPattern(
  value?: string,
):
  | "action_observation_loop"
  | "action_error_loop"
  | "monologue"
  | "alternating_pattern"
  | "context_window_error"
  | undefined {
  if (
    value === "action_observation_loop" ||
    value === "action_error_loop" ||
    value === "monologue" ||
    value === "alternating_pattern" ||
    value === "context_window_error"
  ) {
    return value;
  }
  return undefined;
}

function readHookExecutionEventType(
  value?: string,
):
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionEnd"
  | "Stop"
  | undefined {
  if (
    value === "PreToolUse" ||
    value === "PostToolUse" ||
    value === "UserPromptSubmit" ||
    value === "SessionStart" ||
    value === "SessionEnd" ||
    value === "Stop"
  ) {
    return value;
  }
  return undefined;
}

function readEventSource(
  value?: string,
): BaseOpenHandsEvent["source"] | undefined {
  if (
    value === "agent" ||
    value === "user" ||
    value === "environment" ||
    value === "system" ||
    value === "hook"
  ) {
    return value;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? (value as Record<string, unknown>) : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function getNullableString(
  record: Record<string, unknown>,
  ...keys: string[]
): string | null | undefined {
  for (const key of keys) {
    const value = record[key];
    if (value == null) return null;
    if (typeof value === "string") return value;
  }
  return undefined;
}

function getNumber(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function firstText(...values: Array<string | undefined>): string | undefined {
  return values.find(isNonEmptyString);
}

function joinText(values: Array<string | undefined>): string | undefined {
  const uniqueValues: string[] = [];
  for (const value of values) {
    if (!isNonEmptyString(value) || uniqueValues.includes(value)) continue;
    uniqueValues.push(value);
  }
  const text = uniqueValues.join("\n\n");
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

import type {
  ConversationEventEnvelope,
  OpenHandsConversationEvent,
} from "./conversation-event-types";
import type {
  DisplayNode,
  DisplayNodeKind,
  DisplayNodeMember,
} from "./display-types";
import {
  getCommandText,
  getErrorText,
  getInternalEventSummary,
  getLlmResponseId,
  getMessageText,
  getObservationText,
  getReasoningText,
  getSystemPromptText,
  getToolCallId,
  getToolInput,
  getToolName,
} from "./openhands-conversation-events";

type TraceNodeKind = Extract<
  DisplayNodeKind,
  "tool_batch" | "terminal_activity" | "file_activity" | "reasoning" | "skill" | "subagent"
>;

type SemanticClassification =
  | { type: "suppress" }
  | { type: "standalone"; node: DisplayNode; mergeKey?: string }
  | {
      type: "trace_node";
      node: DisplayNode;
      toolCallId?: string;
      actionEventId?: string;
      actionId?: string;
      llmResponseId?: string;
    };

interface PendingTraceNode {
  node: DisplayNode;
  toolCallId?: string;
  actionEventId?: string;
  actionId?: string;
  llmResponseId?: string;
}

const TRACE_TITLES: Record<TraceNodeKind, string> = {
  tool_batch: "Tool calls",
  terminal_activity: "Terminal activity",
  file_activity: "File activity",
  reasoning: "Reasoning",
  skill: "Skill invocation",
  subagent: "Subagent invocation",
};

export function projectSemanticDisplayNodes(
  events: ConversationEventEnvelope[],
): DisplayNode[] {
  const semanticNodes: DisplayNode[] = [];
  let pendingSuppressedEventIds: string[] = [];

  const emitNode = (node: DisplayNode) => {
    if (pendingSuppressedEventIds.length > 0) {
      node.suppressedEventIds = [
        ...(node.suppressedEventIds ?? []),
        ...pendingSuppressedEventIds,
      ];
      pendingSuppressedEventIds = [];
    }
    semanticNodes.push(node);
  };
  let pendingTraceNodes: PendingTraceNode[] = [];

  const flushTrace = () => {
    for (const entry of pendingTraceNodes) {
      emitNode(entry.node);
    }
    pendingTraceNodes = [];
  };

  for (const event of events) {
    const classification = classifyEvent(event);
    if (classification.type === "suppress") {
      const lastNode = semanticNodes[semanticNodes.length - 1];
      if (lastNode) {
        lastNode.suppressedEventIds = [
          ...(lastNode.suppressedEventIds ?? []),
          event.eventId,
        ];
      } else {
        pendingSuppressedEventIds.push(event.eventId);
      }
      continue;
    }

    if (classification.type === "trace_node") {
      const existingIndex = findPendingTraceNodeIndex(pendingTraceNodes, classification);
      if (existingIndex >= 0) {
        const existing = pendingTraceNodes[existingIndex];
        pendingTraceNodes[existingIndex] = mergePendingTraceNode(existing, classification);
      } else {
        pendingTraceNodes.push({
          node: classification.node,
          toolCallId: classification.toolCallId,
          actionEventId: classification.actionEventId,
          actionId: classification.actionId,
          llmResponseId: classification.llmResponseId,
        });
      }
      continue;
    }

    if (classification.type === "standalone" && classification.mergeKey) {
      const lastNode = semanticNodes[semanticNodes.length - 1];
      if (lastNode && lastNode.id === classification.mergeKey) {
        lastNode.bodyText = combineDistinctText(lastNode.bodyText, classification.node.bodyText);
        lastNode.sourceEventIds = [
          ...lastNode.sourceEventIds,
          ...classification.node.sourceEventIds,
        ];
        continue;
      }
    }

    flushTrace();
    emitNode(classification.node);
  }

  flushTrace();
  return semanticNodes;
}


function classifyEvent(
  event: ConversationEventEnvelope,
): SemanticClassification {
  if (event.origin === "frontend" && event.payload.frontendCommand) {
    return {
      type: "standalone",
      node: {
        id: event.eventId,
        kind: "task_sent",
        status: event.status,
        createdAtMs: event.createdAtMs,
        label: "Task sent",
        bodyText: event.payload.frontendCommand.text,
        sourceEventIds: [event.eventId],
      },
    };
  }

  const openHandsEvent = event.payload.openHandsEvent;
  if (!openHandsEvent) {
    return fallbackDisplayKindNode(event);
  }

  if (openHandsEvent.kind === "MessageEvent") {
    const source = getMessageSource(openHandsEvent);

    return {
      type: "standalone",
      node: {
        id: event.eventId,
        kind: source === "user" ? "task_sent" : "agent_update",
        status: event.status,
        createdAtMs: event.createdAtMs,
        label: source === "user" ? "Task sent" : "Agent update",
        bodyText: getMessageText(openHandsEvent) ?? "Message captured",
        sourceEventIds: [event.eventId],
        rawPayload: event.payload.rawOpenHandsEvent,
      },
    };
  }

  if (openHandsEvent.kind === "SystemPromptEvent") {
    return {
      type: "standalone",
      node: {
        id: event.eventId,
        kind: "runtime_setup",
        status: event.status,
        createdAtMs: event.createdAtMs,
        label: "Runtime setup",
        bodyText:
          getSystemPromptText(openHandsEvent) ??
          getInternalEventSummary(openHandsEvent) ??
          "System prompt prepared.",
        collapsedByDefault: true,
        sourceEventIds: [event.eventId],
        rawPayload: event.payload.rawOpenHandsEvent,
      },
    };
  }

  if (openHandsEvent.kind === "CondensationSummaryEvent") {
    return {
      type: "standalone",
      node: {
        id: event.eventId,
        kind: "result",
        status: event.status,
        createdAtMs: event.createdAtMs,
        label: "Condensation summary",
        bodyText: getInternalEventSummary(openHandsEvent) ?? "Conversation summary updated.",
        sourceEventIds: [event.eventId],
        rawPayload: event.payload.rawOpenHandsEvent,
      },
    };
  }

  if (
    openHandsEvent.kind === "PauseEvent" ||
    openHandsEvent.kind === "ConversationStateUpdateEvent" ||
    openHandsEvent.kind === "LLMCompletionLogEvent" ||
    openHandsEvent.kind === "CondensationRequest" ||
    openHandsEvent.kind === "Condensation" ||
    openHandsEvent.kind === "TokenEvent" ||
    openHandsEvent.kind === "StuckDetectionEvent" ||
    openHandsEvent.kind === "FinishEvent" ||
    openHandsEvent.kind === "HookExecutionEvent" ||
    openHandsEvent.kind === "ConversationErrorEvent" ||
    openHandsEvent.kind === "UserRejectObservation" ||
    openHandsEvent.kind === "ConfirmationRequestEvent" ||
    openHandsEvent.kind === "ConfirmationResponseEvent"
  ) {
    return { type: "suppress" };
  }

  if (openHandsEvent.kind === "ThinkEvent") {
    return traceNode(event, buildReasoningNode(event, openHandsEvent));
  }

  if (
    openHandsEvent.kind === "ActionEvent" ||
    openHandsEvent.kind === "ObservationEvent" ||
    openHandsEvent.kind === "AgentErrorEvent"
  ) {
    const toolName = getToolName(openHandsEvent);
    if (toolName === "file_editor") {
      return traceNode(event, buildToolTraceNode(event, openHandsEvent, "file_activity"));
    }
    if (toolName === "terminal") {
      return traceNode(event, buildToolTraceNode(event, openHandsEvent, "terminal_activity"));
    }
    if (toolName === "invoke_skill") {
      return traceNode(event, buildToolTraceNode(event, openHandsEvent, "skill"));
    }
    if (toolName === "task") {
      return traceNode(event, buildToolTraceNode(event, openHandsEvent, "subagent"));
    }
    if (toolName === "finish") {
      return {
        type: "standalone",
        node: {
          id: event.eventId,
          kind: "result",
          status: event.status,
          createdAtMs: event.createdAtMs,
          label: "Result",
          bodyText:
            getActionSummary(openHandsEvent) ??
            "Result available",
          sourceEventIds: [event.eventId],
          rawPayload: event.payload.rawOpenHandsEvent,
        },
      };
    }
    return traceNode(event, buildToolTraceNode(event, openHandsEvent, "tool_batch"));
  }

  return unknownEventNode(event);
}

function traceNode(
  event: ConversationEventEnvelope,
  node: DisplayNode,
): SemanticClassification {
  const openHandsEvent = event.payload.openHandsEvent;

  return {
    type: "trace_node",
    node,
    toolCallId: openHandsEvent ? getToolCallId(openHandsEvent) : undefined,
    actionEventId: openHandsEvent?.kind === "ActionEvent" ? openHandsEvent.id : undefined,
    actionId: openHandsEvent?.kind === "ObservationEvent" ? openHandsEvent.action_id : undefined,
    llmResponseId: openHandsEvent?.kind === "ActionEvent" ? getLlmResponseId(openHandsEvent) : undefined,
  };
}

type ToolTraceKind = Extract<
  TraceNodeKind,
  "tool_batch" | "file_activity" | "terminal_activity" | "skill" | "subagent"
>;

function buildMemberForKind(
  event: ConversationEventEnvelope,
  openHandsEvent: OpenHandsConversationEvent,
  kind: ToolTraceKind,
): DisplayNodeMember {
  switch (kind) {
    case "tool_batch":
      return buildGenericToolActivityMember(event, openHandsEvent);
    case "file_activity":
      return buildFileActivityMember(event, openHandsEvent);
    case "terminal_activity":
      return buildTerminalActivityMember(event, openHandsEvent);
    case "skill":
      return buildSkillActivityMember(event, openHandsEvent);
    case "subagent":
      return buildSubagentActivityMember(event, openHandsEvent);
  }
}

function resolveMemberId(
  event: ConversationEventEnvelope,
  openHandsEvent: OpenHandsConversationEvent,
): string {
  if (openHandsEvent.kind === "ActionEvent") return openHandsEvent.id;
  if (openHandsEvent.kind === "ObservationEvent") return openHandsEvent.action_id;
  return getToolCallId(openHandsEvent) ?? event.eventId;
}

function resolveActionEventId(
  openHandsEvent: OpenHandsConversationEvent,
): string | undefined {
  if (openHandsEvent.kind === "ActionEvent") return openHandsEvent.id;
  if (openHandsEvent.kind === "ObservationEvent") return openHandsEvent.action_id;
  return undefined;
}

function buildToolTraceNode(
  event: ConversationEventEnvelope,
  openHandsEvent: OpenHandsConversationEvent,
  nodeKind: ToolTraceKind,
): DisplayNode {
  const member = buildMemberForKind(event, openHandsEvent, nodeKind);
  const normalizedMember = {
    ...member,
    id: resolveMemberId(event, openHandsEvent),
    toolName: getToolName(openHandsEvent),
    thoughtText:
      openHandsEvent.kind === "ActionEvent" && openHandsEvent.llm_response_id
        ? undefined
        : member.thoughtText,
    toolCallId: getToolCallId(openHandsEvent),
    actionEventId: resolveActionEventId(openHandsEvent),
  };

  return {
    id: buildTraceNodeId(event, openHandsEvent, nodeKind),
    kind: nodeKind,
    status: event.status,
    createdAtMs: event.createdAtMs,
    label: TRACE_TITLES[nodeKind],
    bodyText:
      normalizedMember.actionText ??
      normalizedMember.observationText ??
      normalizedMember.errorText ??
      normalizedMember.bodyText ??
      TRACE_TITLES[nodeKind],
    thoughtText: openHandsEvent.kind === "ActionEvent" ? getReasoningText(openHandsEvent) : undefined,
    sourceEventIds: [event.eventId],
    members: [normalizedMember],
    rawPayload: event.payload.rawOpenHandsEvent,
  };
}

function buildReasoningNode(
  event: ConversationEventEnvelope,
  openHandsEvent: Extract<OpenHandsConversationEvent, { kind: "ThinkEvent" }>,
): DisplayNode {
  const member = buildReasoningMember(event, openHandsEvent);
  const reasoningText = getReasoningText(openHandsEvent);
  return {
    id: buildTraceNodeId(event, openHandsEvent, "reasoning"),
    kind: "reasoning",
    status: event.status,
    createdAtMs: event.createdAtMs,
    label: "Think",
    bodyText: member.bodyText ?? "Reasoning captured",
    reasoningText,
    thoughtText: member.thoughtText,
    sourceEventIds: [event.eventId],
    members: [member],
    rawPayload: event.payload.rawOpenHandsEvent,
  };
}

interface ActivityMemberOptions {
  title: string;
  actionFallback?: string;
  bodyFallback: string;
}

function buildActivityMember(
  event: ConversationEventEnvelope,
  openHandsEvent: OpenHandsConversationEvent,
  options: ActivityMemberOptions,
): DisplayNodeMember {
  const actionText =
    openHandsEvent.kind === "ActionEvent"
      ? getActionSummary(openHandsEvent) ?? options.actionFallback
      : undefined;
  const observationText =
    openHandsEvent.kind === "ObservationEvent"
      ? getObservationText(openHandsEvent)
      : undefined;
  const errorText =
    openHandsEvent.kind === "AgentErrorEvent" ? getErrorText(openHandsEvent) : undefined;

  return {
    id: event.eventId,
    title: options.title,
    bodyText: actionText ?? observationText ?? errorText ?? options.bodyFallback,
    actionText,
    observationText,
    errorText,
    thoughtText: getReasoningText(openHandsEvent),
    sourceEventIds: [event.eventId],
  };
}

function buildGenericToolActivityMember(
  event: ConversationEventEnvelope,
  openHandsEvent: OpenHandsConversationEvent,
): DisplayNodeMember {
  const toolName = getToolName(openHandsEvent);
  return buildActivityMember(event, openHandsEvent, {
    title: toolName ? `${toolName} activity` : "Tool call",
    actionFallback: toolName ?? "Tool call",
    bodyFallback: "Tool activity captured",
  });
}

function buildTerminalActivityMember(
  event: ConversationEventEnvelope,
  openHandsEvent: OpenHandsConversationEvent,
): DisplayNodeMember {
  const actionText =
    openHandsEvent.kind === "ActionEvent" ? getCommandText(openHandsEvent) : undefined;
  const observationText =
    openHandsEvent.kind === "ObservationEvent"
      ? getObservationText(openHandsEvent)
      : undefined;
  const errorText =
    openHandsEvent.kind === "AgentErrorEvent" ? getErrorText(openHandsEvent) : undefined;

  return {
    id: event.eventId,
    title: openHandsEvent.kind === "ActionEvent" ? "Run command" : "Command output",
    bodyText: actionText ?? observationText ?? errorText ?? "Terminal activity captured",
    actionText,
    observationText,
    errorText,
    thoughtText: getReasoningText(openHandsEvent),
    sourceEventIds: [event.eventId],
  };
}

function buildFileActivityMember(
  event: ConversationEventEnvelope,
  openHandsEvent: OpenHandsConversationEvent,
): DisplayNodeMember {
  const input = getToolInput(openHandsEvent);
  const command =
    openHandsEvent.kind === "ActionEvent"
      ? getString(openHandsEvent.action, "command")
      : openHandsEvent.kind === "ObservationEvent"
        ? getString(openHandsEvent.observation, "command")
        : undefined;
  const observationText =
    openHandsEvent.kind === "ObservationEvent"
      ? getObservationText(openHandsEvent)
      : undefined;
  const errorText =
    openHandsEvent.kind === "AgentErrorEvent" ? getErrorText(openHandsEvent) : undefined;
  const path =
    (openHandsEvent.kind === "ActionEvent"
      ? getString(openHandsEvent.action, "path")
      : undefined) ??
    (openHandsEvent.kind === "ObservationEvent"
      ? getString(openHandsEvent.observation, "path")
      : undefined) ??
    (typeof input === "object" && input && "path" in input
      ? getString(input as Record<string, unknown>, "path")
      : undefined);
  const actionText =
    openHandsEvent.kind === "ActionEvent"
      ? [command ? `command: ${command}` : undefined, path ? `path: ${path}` : undefined]
          .filter((value): value is string => Boolean(value))
          .join(" ")
      : undefined;

  return {
    id: event.eventId,
    title: command ? capitalize(command) : "File activity",
    bodyText: path ?? observationText ?? errorText ?? "File activity captured",
    actionText: actionText || undefined,
    observationText,
    errorText,
    thoughtText: getReasoningText(openHandsEvent),
    sourceEventIds: [event.eventId],
  };
}

function buildReasoningMember(
  event: ConversationEventEnvelope,
  openHandsEvent: Extract<OpenHandsConversationEvent, { kind: "ThinkEvent" }>,
): DisplayNodeMember {
  const reasoningText = getReasoningText(openHandsEvent);
  const thoughtText = openHandsEvent.thought;

  return {
    id: event.eventId,
    title: "Think",
    bodyText: reasoningText ?? thoughtText,
    thoughtText,
    sourceEventIds: [event.eventId],
  };
}

function buildSkillActivityMember(
  event: ConversationEventEnvelope,
  openHandsEvent: OpenHandsConversationEvent,
): DisplayNodeMember {
  return buildActivityMember(event, openHandsEvent, {
    title: "Skill invocation",
    actionFallback: "Skill invoked",
    bodyFallback: "Skill invoked",
  });
}

function buildSubagentActivityMember(
  event: ConversationEventEnvelope,
  openHandsEvent: OpenHandsConversationEvent,
): DisplayNodeMember {
  return buildActivityMember(event, openHandsEvent, {
    title: "Subagent invocation",
    actionFallback: "Subagent launched",
    bodyFallback: "Subagent launched",
  });
}

function getMessageSource(event: OpenHandsConversationEvent): string | undefined {
  if (event.kind !== "MessageEvent") return undefined;
  const llmMessage = event.llm_message as { role?: unknown };
  if (llmMessage.role === "user") return "user";
  if (llmMessage.role === "assistant") return "agent";
  return event.source;
}

function getActionSummary(event: OpenHandsConversationEvent): string | undefined {
  if (event.kind === "ActionEvent") {
    if (event.tool_name === "invoke_skill") {
      const actionName = getString(event.action, "name");
      const actionKind = getString(event.action, "kind");
      const parts = [
        actionName ? `name: ${actionName}` : undefined,
        actionKind ? `action: ${actionKind}` : undefined,
      ].filter((value): value is string => Boolean(value));
      if (parts.length > 0) {
        return parts.join(" ");
      }
    }

    return (
      getFirstString(event.action, "description", "name", "message", "command", "path") ??
      getCommandText(event)
    );
  }

  if (event.kind === "ObservationEvent") {
    return (
      getFirstString(event.observation, "skill_name", "subagent", "command", "path") ??
      getString(event.observation, "message") ??
      getToolName(event)
    );
  }

  if (event.kind === "AgentErrorEvent") {
    return getToolName(event);
  }

  return undefined;
}

function unknownEventNode(event: ConversationEventEnvelope): SemanticClassification {
  return {
    type: "standalone",
    node: {
      id: event.eventId,
      kind: "unknown_event",
      status: event.status,
      createdAtMs: event.createdAtMs,
      label: "Unknown event",
      bodyText: "Event captured",
      sourceEventIds: [event.eventId],
      rawPayload: event.payload.rawOpenHandsEvent,
    },
  };
}

function fallbackDisplayKindNode(
  event: ConversationEventEnvelope,
): SemanticClassification {
  switch (event.display.kind) {
    case "user_message":
      return {
        type: "standalone",
        node: {
          id: event.eventId,
          kind: "task_sent",
          status: event.status,
          createdAtMs: event.createdAtMs,
          label: "Task sent",
          bodyText: event.payload.frontendCommand?.text ?? "Message captured",
          sourceEventIds: [event.eventId],
          rawPayload: event.payload.rawOpenHandsEvent,
        },
      };
    case "agent_message":
      return {
        type: "standalone",
        node: {
          id: event.eventId,
          kind: "agent_update",
          status: event.status,
          createdAtMs: event.createdAtMs,
          label: "Agent update",
          bodyText:
            getFirstString(event.payload.rawOpenHandsEvent, "text", "message", "content") ??
            "Message captured",
          sourceEventIds: [event.eventId],
          rawPayload: event.payload.rawOpenHandsEvent,
        },
      };
    default:
      return unknownEventNode(event);
  }
}

function findPendingTraceNodeIndex(
  list: PendingTraceNode[],
  classification: Extract<SemanticClassification, { type: "trace_node" }>,
): number {
  if (classification.node.kind === "reasoning") {
    return -1;
  }

  if (classification.llmResponseId) {
    const byResponseId = list.findIndex(
      (entry) => entry.llmResponseId === classification.llmResponseId,
    );
    if (byResponseId >= 0) return byResponseId;
  }

  if (classification.actionId) {
    const byActionId = list.findIndex((entry) =>
      entry.node.members?.some((member) => member.id === classification.actionId) ||
      entry.actionEventId === classification.actionId,
    );
    if (byActionId >= 0) return byActionId;
  }

  if (classification.toolCallId) {
    const byToolCallId = list.findIndex((entry) =>
      entry.node.members?.some((member) => member.id === classification.toolCallId) ||
      entry.toolCallId === classification.toolCallId,
    );
    if (byToolCallId >= 0) return byToolCallId;
  }

  return -1;
}


function mergePendingTraceNode(
  existing: PendingTraceNode,
  classification: Extract<SemanticClassification, { type: "trace_node" }>,
): PendingTraceNode {
  const incomingNode = classification.node;
  if (existing.node.kind === "reasoning" || incomingNode.kind === "reasoning") {
    return {
      ...existing,
      node: {
        ...existing.node,
        bodyText: combineDistinctText(existing.node.bodyText, incomingNode.bodyText),
        thoughtText: combineDistinctText(existing.node.thoughtText, incomingNode.thoughtText),
        sourceEventIds: [...existing.node.sourceEventIds, ...incomingNode.sourceEventIds],
      },
    };
  }

  const existingMembers = existing.node.members ?? [];
  const incomingMember = incomingNode.members?.[0];
  if (!incomingMember) {
    return existing;
  }
  const memberIndex = findExistingMemberIndex(existingMembers, classification);
  const nextMembers = [...existingMembers];
  if (memberIndex >= 0) {
    const current = nextMembers[memberIndex];
    nextMembers[memberIndex] = {
      ...current,
      bodyText: incomingMember.bodyText ?? current.bodyText,
      actionText: incomingMember.actionText ?? current.actionText,
      observationText: incomingMember.observationText ?? current.observationText,
      errorText: incomingMember.errorText ?? current.errorText,
      thoughtText: incomingMember.thoughtText ?? current.thoughtText,
      sourceEventIds: [...current.sourceEventIds, ...incomingMember.sourceEventIds],
    };
  } else {
    nextMembers.push(incomingMember);
  }

  const nextKind =
    existing.llmResponseId &&
    nextMembers.length > 1
      ? "tool_batch"
      : classification.node.kind;

  return {
    toolCallId: classification.toolCallId ?? existing.toolCallId,
    actionEventId: classification.actionEventId ?? existing.actionEventId,
    actionId: classification.actionId ?? existing.actionId,
    llmResponseId: classification.llmResponseId ?? existing.llmResponseId,
    node: {
      ...existing.node,
      kind: nextKind,
      label: TRACE_TITLES[nextKind as TraceNodeKind] ?? existing.node.label,
      bodyText:
        existing.node.bodyText ??
        incomingNode.bodyText,
      thoughtText: existing.node.thoughtText ?? incomingNode.thoughtText,
      sourceEventIds: [...existing.node.sourceEventIds, ...incomingNode.sourceEventIds],
      members: nextMembers,
    },
  };
}

function findExistingMemberIndex(
  members: DisplayNodeMember[],
  classification: Extract<SemanticClassification, { type: "trace_node" }>,
): number {
  if (classification.actionId) {
    const byActionId = members.findIndex(
      (member) => member.actionEventId === classification.actionId || member.id === classification.actionId,
    );
    if (byActionId >= 0) return byActionId;
  }
  if (classification.toolCallId) {
    const byToolCallId = members.findIndex(
      (member) => member.toolCallId === classification.toolCallId || member.id === classification.toolCallId,
    );
    if (byToolCallId >= 0) return byToolCallId;
  }
  return -1;
}

function buildTraceNodeId(
  event: ConversationEventEnvelope,
  openHandsEvent: OpenHandsConversationEvent,
  nodeKind: TraceNodeKind,
): string {
  if (openHandsEvent.kind === "ActionEvent" && openHandsEvent.llm_response_id) {
    return `trace-batch:${openHandsEvent.llm_response_id}`;
  }
  if (openHandsEvent.kind === "ObservationEvent") {
    return `trace-action:${openHandsEvent.action_id}`;
  }
  return `trace:${nodeKind}:${event.eventId}`;
}

function getString(
  value: unknown,
  ...path: string[]
): string | undefined {
  let current: unknown = value;

  for (const segment of path) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === "string" ? current : undefined;
}

function getFirstString(value: unknown, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const resolved = getString(value, key);
    if (resolved) return resolved;
  }
  return undefined;
}

function combineDistinctText(...values: Array<string | undefined>): string | undefined {
  const parts: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    if (parts.includes(trimmed)) continue;
    parts.push(trimmed);
  }

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

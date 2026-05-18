import type { ConversationEventEnvelope } from "./conversation-event-types";
import type {
  DisplayNode,
  DisplayNodeKind,
  DisplayNodeMember,
  DisplayTraceDrawerSection,
  DisplayTraceItem,
} from "./display-types";
import type { OpenHandsConversationEvent, OpenHandsConversationState } from "./openhands-conversation-events";
import {
  getCommandText,
  getErrorText,
  getInternalEventSummary,
  getMessageText,
  getObservationText,
  getReasoningText,
  getSystemPromptText,
  getToolCallId,
  getToolInput,
  getToolName,
} from "./openhands-conversation-events";

type GroupedKind = Extract<DisplayNodeKind, "terminal_activity" | "file_activity" | "reasoning">;

type SemanticClassification =
  | { type: "suppress" }
  | { type: "standalone"; node: DisplayNode; mergeKey?: string }
  | {
      type: "group_member";
      groupKind: GroupedKind;
      member: DisplayNodeMember;
    };

interface PendingGroupedMember {
  toolCallId?: string;
  member: DisplayNodeMember;
}

const GROUP_TITLES: Record<GroupedKind, string> = {
  terminal_activity: "Terminal activity",
  file_activity: "File activity",
  reasoning: "Reasoning",
};

const TRACE_ITEM_ORDER: GroupedKind[] = ["file_activity", "terminal_activity", "reasoning"];

export function projectSemanticDisplayNodes(
  events: ConversationEventEnvelope[],
): DisplayNode[] {
  const semanticNodes: DisplayNode[] = [];
  let pendingSuppressedEventIds: string[] = [];
  let lastLifecycleValue: string | undefined;

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

  const flushGroupedNodes = (
    groupedMembers: Partial<Record<GroupedKind, PendingGroupedMember[]>>,
    createdAtMs: number,
  ) => {
    for (const groupKind of TRACE_ITEM_ORDER) {
      const members = groupedMembers[groupKind];
      if (!members || members.length === 0) continue;

      const allEventIds = members.flatMap((entry) => entry.member.sourceEventIds);
      emitNode({
        id: `group:${groupKind}:${allEventIds[0]}`,
        kind: groupKind,
        status: "observed",
        createdAtMs,
        label: GROUP_TITLES[groupKind],
        collapsedByDefault: groupKind === "reasoning",
        sourceEventIds: allEventIds,
        groupedMemberEventIds: allEventIds,
        members: members.map((entry) => entry.member),
      });
    }
  };

  let pendingGroups: Partial<Record<GroupedKind, PendingGroupedMember[]>> = {};

  const flushGroups = (createdAtMs: number) => {
    flushGroupedNodes(pendingGroups, createdAtMs);
    pendingGroups = {};
  };

  for (const event of events) {
    const classification = classifyEvent(event, lastLifecycleValue);
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

    if (classification.type === "group_member") {
      const list = pendingGroups[classification.groupKind] ?? [];
      const toolCallId = getToolCallIdFromEnvelope(event);
      const existingIndex =
        toolCallId == null
          ? -1
          : list.findIndex((entry) => entry.toolCallId === toolCallId);

      if (existingIndex >= 0) {
        const existing = list[existingIndex];
        list[existingIndex] = {
          toolCallId,
          member: {
            ...existing.member,
            bodyText: classification.member.bodyText ?? existing.member.bodyText,
            actionText: classification.member.actionText ?? existing.member.actionText,
            observationText:
              classification.member.observationText ?? existing.member.observationText,
            sourceEventIds: [
              ...existing.member.sourceEventIds,
              ...classification.member.sourceEventIds,
            ],
          },
        };
      } else {
        list.push({
          toolCallId,
          member: classification.member,
        });
      }
      pendingGroups[classification.groupKind] = list;
      continue;
    }

    if (classification.type === "standalone" && classification.mergeKey) {
      const lastNode = semanticNodes[semanticNodes.length - 1];
      if (lastNode && lastNode.id === classification.mergeKey) {
        if (lastNode.kind === "subagent") {
          lastNode.actionText = lastNode.actionText ?? lastNode.bodyText;
          lastNode.observationText =
            classification.node.observationText ??
            classification.node.bodyText ??
            lastNode.observationText;
          lastNode.thoughtText =
            lastNode.thoughtText ?? classification.node.thoughtText;
          lastNode.bodyText =
            lastNode.observationText ??
            lastNode.actionText ??
            lastNode.bodyText;
        } else {
          lastNode.bodyText = combineDistinctText(
            lastNode.bodyText,
            classification.node.bodyText,
          );
        }
        lastNode.sourceEventIds = [
          ...lastNode.sourceEventIds,
          ...classification.node.sourceEventIds,
        ];
        continue;
      }
    }

    flushGroups(event.createdAtMs);
    if (classification.node.kind === "lifecycle") {
      lastLifecycleValue = classification.node.bodyText?.toLowerCase();
    } else if (classification.node.kind === "pause") {
      lastLifecycleValue = undefined;
    }
    emitNode(classification.node);
  }

  flushGroups(events.length > 0 ? events[events.length - 1].createdAtMs : Date.now());
  return collapseTraceNodes(semanticNodes);
}

function collapseTraceNodes(nodes: DisplayNode[]): DisplayNode[] {
  const collapsedNodes: DisplayNode[] = [];
  let pendingTraceNodes: DisplayNode[] = [];
  const standaloneBoundaryKinds = new Set<DisplayNodeKind>([
    "task_sent",
    "agent_update",
    "runtime_setup",
    "result",
    "error",
    "tool_error",
    "subagent_error",
    "unknown_event",
  ]);

  const flushTrace = (mode: "boundary" | "final" = "boundary") => {
    if (pendingTraceNodes.length === 0) return;

    const sourceEventIds = pendingTraceNodes.flatMap((node) => node.sourceEventIds);
    const suppressedEventIds = pendingTraceNodes.flatMap((node) => node.suppressedEventIds ?? []);
    const traceNode: DisplayNode = {
      id: `trace:${pendingTraceNodes[0].id}`,
      kind: "activity_trace",
      status: "observed",
      createdAtMs: pendingTraceNodes[0].createdAtMs,
      label: "Activity trace",
      collapsedByDefault: true,
      sourceEventIds,
      suppressedEventIds: suppressedEventIds.length > 0 ? suppressedEventIds : undefined,
      traceItems: pendingTraceNodes.map(buildTraceItem),
    };

    const previousNode = collapsedNodes[collapsedNodes.length - 1];
    const previousTraceNode = collapsedNodes[collapsedNodes.length - 2];
    if (
      mode === "final" &&
      previousNode?.kind === "agent_update" &&
      previousTraceNode?.kind === "activity_trace"
    ) {
      previousTraceNode.sourceEventIds = [
        ...previousTraceNode.sourceEventIds,
        ...traceNode.sourceEventIds,
      ];
      previousTraceNode.suppressedEventIds = [
        ...(previousTraceNode.suppressedEventIds ?? []),
        ...(traceNode.suppressedEventIds ?? []),
      ];
      previousTraceNode.traceItems = [
        ...(previousTraceNode.traceItems ?? []),
        ...(traceNode.traceItems ?? []),
      ];
    } else {
      collapsedNodes.push(traceNode);
    }

    pendingTraceNodes = [];
  };

  for (const node of nodes) {
    if (standaloneBoundaryKinds.has(node.kind)) {
      flushTrace();
      collapsedNodes.push(node);
      continue;
    }

    if (node.kind === "lifecycle" || node.kind === "pause") {
      continue;
    }

    pendingTraceNodes.push(node);
  }

  flushTrace("final");
  return collapsedNodes;
}

function buildTraceItem(node: DisplayNode): DisplayTraceItem {
  switch (node.kind) {
    case "runtime_setup":
      return buildSimpleTraceItem(node, {
        title: "Runtime setup",
        summary: node.bodyText ?? "System prompt prepared.",
        badgeLabel: "setup",
      });
    case "lifecycle": {
      const title = getLifecycleTitle(node.bodyText);
      return {
        id: node.id,
        kind: "lifecycle",
        title,
        summary: title,
        badgeLabel: "status",
        sourceEventIds: node.sourceEventIds,
      };
    }
    case "pause":
      return {
        id: node.id,
        kind: "pause",
        title: "Paused",
        summary: node.bodyText ?? "Conversation paused.",
        badgeLabel: "status",
        sourceEventIds: node.sourceEventIds,
      };
    case "skill":
      return buildSimpleTraceItem(node, {
        title: "Skill invocation",
        summary: node.bodyText ?? "Skill invoked",
        badgeLabel: "skill",
        drawerSubtitle: node.bodyText ?? "Skill invocation",
      });
    case "subagent":
      return buildSimpleTraceItem(node, {
        title: "Subagent invocation",
        summary: node.actionText ?? node.bodyText ?? "Subagent launched",
        badgeLabel: "subagent",
        drawerSubtitle: "1 items",
        extraSections: [
          ...(node.thoughtText
            ? [{ title: "Thought", body: node.thoughtText }]
            : []),
          {
            title: "Action",
            body: node.actionText ?? node.bodyText ?? "Subagent launched",
          },
          ...(node.observationText
            ? [{ title: "Observation", body: node.observationText }]
            : []),
        ],
      });
    case "result":
      return buildSimpleTraceItem(node, {
        title: "Result",
        summary: node.bodyText ?? "Result available",
        badgeLabel: "result",
      });
    case "tool_error":
      return buildSimpleTraceItem(node, {
        title: "Tool error",
        summary: node.bodyText ?? "Tool execution failed",
        badgeLabel: "error",
      });
    case "subagent_error":
      return buildSimpleTraceItem(node, {
        title: "Subagent error",
        summary: node.bodyText ?? "Subagent failed",
        badgeLabel: "error",
      });
    case "file_activity":
    case "terminal_activity":
    case "reasoning":
      return buildGroupedTraceItem(node);
    default:
      return buildSimpleTraceItem(node, {
        title: node.label ?? "Trace item",
        summary: node.bodyText ?? "Event captured",
        badgeLabel: "trace",
      });
  }
}

function buildSimpleTraceItem(
  node: DisplayNode,
  options: {
    title: string;
    summary: string;
    badgeLabel: string;
    drawerSubtitle?: string;
    extraSections?: DisplayTraceDrawerSection[];
  },
): DisplayTraceItem {
  const timelineSummary =
    node.kind === "skill" ? buildCompactTraceSummary(options.summary) : options.summary;
  const sections: DisplayTraceDrawerSection[] = [
    { title: "Summary", body: options.summary },
    ...(options.extraSections ?? []),
  ];

  return {
    id: node.id,
    kind: node.kind as DisplayTraceItem["kind"],
    title: options.title,
    summary: timelineSummary,
    badgeLabel: options.badgeLabel,
    sourceEventIds: node.sourceEventIds,
    interactive: true,
    drawerTitle: options.title,
    drawerSubtitle: options.drawerSubtitle ?? "1 items",
    drawerSections: sections,
  };
}

function buildGroupedTraceItem(node: DisplayNode): DisplayTraceItem {
  const members = node.members ?? [];
  const title = node.label ?? GROUP_TITLES[node.kind as GroupedKind];
  const firstMember = members[0];
  const fullSummary =
    firstMember?.observationText ??
    firstMember?.bodyText ??
    node.bodyText ??
    `${title} captured`;
  const summary =
    node.kind === "reasoning"
      ? buildTimelineReasoningSummary(fullSummary)
      : buildCompactTraceSummary(
          firstMember?.actionText ?? firstMember?.bodyText ?? fullSummary,
        );
  const drawerSections: DisplayTraceDrawerSection[] = [
    { title: "Summary", body: fullSummary },
    ...members.flatMap((member, index) => {
      if (
        (node.kind === "file_activity" || node.kind === "terminal_activity") &&
        (member.actionText || member.observationText)
      ) {
        return [
          {
            title: `Item ${index + 1}: Action`,
            body: member.actionText ?? member.title,
          },
          {
            title: `Item ${index + 1}: Observation`,
            body:
              member.observationText ??
              member.bodyText ??
              member.actionText ??
              member.title,
          },
        ];
      }

      return [
        {
          title: `Item ${index + 1}: ${member.title}`,
          body: member.bodyText ?? member.title,
        },
      ];
    }),
  ];

  return {
    id: node.id,
    kind: node.kind as DisplayTraceItem["kind"],
    title,
    summary,
    badgeLabel: node.kind.replace(/_/g, " "),
    sourceEventIds: node.sourceEventIds,
    interactive: true,
    drawerTitle: title,
    drawerSubtitle: `${members.length} items`,
    drawerSections,
  };
}

function buildTimelineReasoningSummary(value: string): string {
  const firstParagraph = value.split(/\n\s*\n/, 1)[0]?.replace(/\s+/g, " ").trim();
  const candidate = firstParagraph && firstParagraph.length > 0 ? firstParagraph : value.trim();

  if (candidate.length <= 160) {
    return candidate;
  }

  return `${candidate.slice(0, 157).trimEnd()}...`;
}

function buildCompactTraceSummary(value: string): string {
  const firstParagraph = value.split(/\n\s*\n/, 1)[0]?.replace(/\s+/g, " ").trim();
  const firstLine = firstParagraph?.split("\n", 1)[0]?.trim();
  const candidate =
    firstLine && firstLine.length > 0
      ? firstLine
      : value.replace(/\s+/g, " ").trim();

  if (candidate.length <= 140) {
    return candidate;
  }

  return `${candidate.slice(0, 137).trimEnd()}...`;
}

function getLifecycleTitle(value?: string): string {
  if (!value) return "Lifecycle update";
  return `Conversation ${value.toLowerCase()}`;
}

function classifyEvent(
  event: ConversationEventEnvelope,
  lastLifecycleValue?: string,
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

  const rawEvent = event.payload.rawOpenHandsEvent;
  if (!rawEvent || typeof rawEvent !== "object") {
    return fallbackDisplayKindNode(event);
  }

  const openHandsEvent = rawEvent as OpenHandsConversationEvent | OpenHandsConversationState;
  if (
    !("type" in openHandsEvent) ||
    typeof (openHandsEvent as { type?: unknown }).type !== "string"
  ) {
    return fallbackDisplayKindNode(event);
  }
  if (openHandsEvent.type === "conversation_state") {
    return lifecycleNode(event, openHandsEvent.status, lastLifecycleValue);
  }

  if (openHandsEvent.eventClass === "MessageEvent") {
    const source =
      typeof openHandsEvent.event.source === "string"
        ? openHandsEvent.event.source
        : undefined;

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
        rawPayload: rawEvent,
      },
    };
  }

  if (openHandsEvent.eventClass === "conversation_state") {
    const wrappedStatus =
      typeof openHandsEvent.event.status === "string"
        ? openHandsEvent.event.status
        : undefined;
    if (wrappedStatus) {
      return lifecycleNode(event, wrappedStatus, lastLifecycleValue);
    }
  }

  const nestedEventKind =
    typeof openHandsEvent.event.kind === "string"
      ? openHandsEvent.event.kind
      : typeof openHandsEvent.event.eventClass === "string"
        ? openHandsEvent.event.eventClass
        : typeof openHandsEvent.event.event_class === "string"
          ? openHandsEvent.event.event_class
          : undefined;
  if (nestedEventKind === "ConversationStateUpdateEvent") {
    const nestedKey =
      typeof openHandsEvent.event.key === "string" ? openHandsEvent.event.key : undefined;
    const nestedValue =
      typeof openHandsEvent.event.value === "string" ? openHandsEvent.event.value : undefined;

    if (nestedKey === "stats" || nestedKey === "last_user_message_id") {
      return { type: "suppress" };
    }
    if (nestedKey === "execution_status") {
      if (nestedValue === "paused") return { type: "suppress" };
      return lifecycleNode(event, nestedValue ?? "status", lastLifecycleValue);
    }
  }

  if (openHandsEvent.eventClass === "ConversationStateUpdateEvent") {
    const key =
      typeof openHandsEvent.event.key === "string" ? openHandsEvent.event.key : undefined;
    const value =
      typeof openHandsEvent.event.value === "string" ? openHandsEvent.event.value : undefined;

    if (key === "stats" || key === "last_user_message_id") {
      return { type: "suppress" };
    }
    if (key === "execution_status") {
      if (value === "paused") return { type: "suppress" };
      return lifecycleNode(event, value ?? "status", lastLifecycleValue);
    }

    return unknownEventNode(event);
  }

  if (openHandsEvent.eventClass === "SystemPromptEvent") {
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
        rawPayload: rawEvent,
      },
    };
  }

  if (openHandsEvent.eventClass === "PauseEvent") {
    return {
      type: "standalone",
      node: {
        id: event.eventId,
        kind: "pause",
        status: event.status,
        createdAtMs: event.createdAtMs,
        label: "Paused",
        bodyText: getInternalEventSummary(openHandsEvent) ?? "Conversation paused.",
        sourceEventIds: [event.eventId],
        rawPayload: rawEvent,
      },
    };
  }

  if (openHandsEvent.eventClass === "ConversationErrorEvent") {
    return errorNode(event, "error", "Error");
  }

  if (openHandsEvent.eventClass === "AgentErrorEvent") {
    const toolName = getToolName(openHandsEvent);
    return errorNode(
      event,
      toolName === "task" ? "subagent_error" : "tool_error",
      toolName === "task" ? "Subagent error" : "Tool error",
    );
  }

  if (
    openHandsEvent.eventClass === "ActionEvent" ||
    openHandsEvent.eventClass === "ObservationEvent"
  ) {
    const toolName = getToolName(openHandsEvent);
    if (toolName === "file_editor") {
      return groupedToolNode(event, "file_activity", buildFileActivityMember(event, openHandsEvent));
    }
    if (toolName === "terminal") {
      return groupedToolNode(
        event,
        "terminal_activity",
        buildTerminalActivityMember(event, openHandsEvent),
      );
    }
    if (toolName === "think") {
      return groupedToolNode(event, "reasoning", buildReasoningMember(event, openHandsEvent));
    }
    if (toolName === "invoke_skill") {
      return {
        type: "standalone",
        node: {
          id: getStandaloneMergeKey("skill", openHandsEvent),
          kind: "skill",
          status: event.status,
          createdAtMs: event.createdAtMs,
          label: "Skill",
          bodyText:
            getObservationText(openHandsEvent) ??
            getString(openHandsEvent.event, "summary") ??
            getString(openHandsEvent.event.action, "name") ??
            getString(openHandsEvent.event.observation, "skill_name") ??
            "Skill invoked",
          sourceEventIds: [event.eventId],
          rawPayload: rawEvent,
        },
        mergeKey: getStandaloneMergeKey("skill", openHandsEvent),
      };
    }
    if (toolName === "task") {
      return {
        type: "standalone",
        node: {
          id: getStandaloneMergeKey("subagent", openHandsEvent),
          kind: "subagent",
          status: event.status,
          createdAtMs: event.createdAtMs,
          label: "Subagent",
          bodyText:
            getObservationText(openHandsEvent) ??
            getString(openHandsEvent.event.action, "description") ??
            getString(openHandsEvent.event.observation, "subagent") ??
            "Subagent launched",
          actionText:
            getString(openHandsEvent.event.action, "description") ??
            getString(openHandsEvent.event, "summary") ??
            "Subagent launched",
          observationText: getObservationText(openHandsEvent),
          thoughtText: getReasoningText(openHandsEvent),
          sourceEventIds: [event.eventId],
          rawPayload: rawEvent,
        },
        mergeKey: getStandaloneMergeKey("subagent", openHandsEvent),
      };
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
            getString(openHandsEvent.event.action, "message") ??
            getString(openHandsEvent.event, "summary") ??
            "Result available",
          sourceEventIds: [event.eventId],
          rawPayload: rawEvent,
        },
      };
    }
    if (openHandsEvent.eventClass === "ObservationEvent") {
      const observationText = getObservationText(openHandsEvent);
      if (observationText) {
        return {
          type: "standalone",
          node: {
            id: event.eventId,
            kind: "result",
            status: event.status,
            createdAtMs: event.createdAtMs,
            label: "Tool observation",
            bodyText: observationText,
            sourceEventIds: [event.eventId],
            rawPayload: rawEvent,
          },
        };
      }
    }
  }

  return unknownEventNode(event);
}

function groupedToolNode(
  event: ConversationEventEnvelope,
  groupKind: GroupedKind,
  member: DisplayNodeMember,
): SemanticClassification {
  return {
    type: "group_member",
    groupKind,
    member: {
      ...member,
      sourceEventIds: [event.eventId],
    },
  };
}

function buildTerminalActivityMember(
  event: ConversationEventEnvelope,
  openHandsEvent: OpenHandsConversationEvent,
): DisplayNodeMember {
  const commandText = getCommandText(openHandsEvent);
  const observationText = getObservationText(openHandsEvent);

  return {
    id: event.eventId,
    title: openHandsEvent.eventClass === "ActionEvent" ? "Run command" : "Command output",
    bodyText: commandText ?? observationText ?? "Terminal activity captured",
    actionText: commandText,
    observationText,
    sourceEventIds: [event.eventId],
  };
}

function buildFileActivityMember(
  event: ConversationEventEnvelope,
  openHandsEvent: OpenHandsConversationEvent,
): DisplayNodeMember {
  const input = getToolInput(openHandsEvent);
  const command = getString(openHandsEvent.event.action, "command");
  const observationText = getObservationText(openHandsEvent);
  const path =
    getString(openHandsEvent.event.action, "path") ??
    getString(openHandsEvent.event.observation, "path") ??
    (typeof input === "object" && input && "path" in input
      ? getString(input as Record<string, unknown>, "path")
      : undefined);

  return {
    id: event.eventId,
    title: command ? capitalize(command) : "File activity",
    bodyText: path ?? observationText ?? "File activity captured",
    actionText: path,
    observationText,
    sourceEventIds: [event.eventId],
  };
}

function buildReasoningMember(
  event: ConversationEventEnvelope,
  openHandsEvent: OpenHandsConversationEvent,
): DisplayNodeMember {
  const observationText = getObservationText(openHandsEvent);
  const bodyText =
    getReasoningText(openHandsEvent) ??
    (isThinkObservationPlaceholder(observationText) ? undefined : observationText);

  return {
    id: event.eventId,
    title: "Reasoning checkpoint",
    bodyText,
    sourceEventIds: [event.eventId],
  };
}

function isThinkObservationPlaceholder(value?: string): boolean {
  return value?.trim() === "Your thought has been logged.";
}

function lifecycleNode(
  event: ConversationEventEnvelope,
  value: string,
  lastLifecycleValue?: string,
): SemanticClassification {
  const normalized = value.toLowerCase();
  if (lastLifecycleValue === normalized) {
    return { type: "suppress" };
  }

  return {
    type: "standalone",
    node: {
      id: event.eventId,
      kind: "lifecycle",
      status: event.status,
      createdAtMs: event.createdAtMs,
      label: "Lifecycle",
      bodyText: capitalize(normalized),
      sourceEventIds: [event.eventId],
    },
  };
}

function errorNode(
  event: ConversationEventEnvelope,
  kind: Extract<DisplayNodeKind, "error" | "tool_error" | "subagent_error">,
  label: string,
): SemanticClassification {
  const openHandsEvent = event.payload.rawOpenHandsEvent as OpenHandsConversationEvent;

  return {
    type: "standalone",
    node: {
      id: event.eventId,
      kind,
      status: "failed",
      createdAtMs: event.createdAtMs,
      label,
      bodyText: getErrorText(openHandsEvent) ?? "Error captured",
      sourceEventIds: [event.eventId],
      rawPayload: event.payload.rawOpenHandsEvent,
    },
  };
}

function getStandaloneMergeKey(
  prefix: "skill" | "subagent",
  openHandsEvent: OpenHandsConversationEvent,
): string {
  return `${prefix}:${getToolCallId(openHandsEvent) ?? `event:${openHandsEvent.timestamp}`}`;
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
            getString(event.payload.rawOpenHandsEvent, "text", "message", "content") ??
            "Message captured",
          sourceEventIds: [event.eventId],
          rawPayload: event.payload.rawOpenHandsEvent,
        },
      };
    default:
      return unknownEventNode(event);
  }
}

function getToolCallIdFromEnvelope(
  event: ConversationEventEnvelope,
): string | undefined {
  const rawEvent = event.payload.rawOpenHandsEvent;
  if (!rawEvent || typeof rawEvent !== "object") return undefined;

  const openHandsEvent = rawEvent as OpenHandsConversationEvent;
  return getToolCallId(openHandsEvent);
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

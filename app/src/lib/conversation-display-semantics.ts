import type { ConversationEventEnvelope } from "./conversation-event-types";
import type { OpenHandsConversationEvent } from "./conversation-event-types";
import type {
  DisplayNode,
  DisplayNodeKind,
  DisplayNodeMember,
  DisplayTraceDrawerSection,
  DisplayTraceItem,
} from "./display-types";
import {
  getCommandText,
  getErrorText,
  getInternalEventSummary,
  getMessageText,
  normalizeConversationEventMessage,
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
            errorText: classification.member.errorText ?? existing.member.errorText,
            thoughtText: classification.member.thoughtText ?? existing.member.thoughtText,
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
          lastNode.actionText =
            lastNode.actionText ??
            classification.node.actionText ??
            lastNode.bodyText;
          lastNode.observationText =
            classification.node.observationText ??
            classification.node.bodyText ??
            lastNode.observationText;
          lastNode.thoughtText =
            lastNode.thoughtText ?? classification.node.thoughtText;
          lastNode.bodyText = lastNode.actionText ?? lastNode.bodyText;
        } else if (lastNode.kind === "skill") {
          lastNode.thoughtText = lastNode.thoughtText ?? classification.node.thoughtText;
          lastNode.actionText =
            lastNode.actionText ??
            classification.node.actionText ??
            lastNode.bodyText;
          lastNode.observationText =
            classification.node.observationText ??
            classification.node.bodyText ??
            lastNode.observationText;
          lastNode.bodyText = lastNode.actionText ?? lastNode.bodyText;
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
    ...(node.thoughtText ? [{ title: "Thought", body: node.thoughtText }] : []),
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
      if (member.actionText || member.observationText || member.errorText || member.thoughtText) {
        const sections: DisplayTraceDrawerSection[] = [];
        if (member.thoughtText) {
          sections.push({
            title: `Item ${index + 1}: Thought`,
            body: member.thoughtText,
          });
        }
        if (member.actionText) {
          sections.push({
            title: `Item ${index + 1}: Action`,
            body: member.actionText,
          });
        }
        if (member.observationText) {
          sections.push({
            title: `Item ${index + 1}: Observation`,
            body: member.observationText,
          });
        }
        if (member.errorText) {
          sections.push({
            title: `Item ${index + 1}: Error`,
            body: member.errorText,
          });
        }
        if (sections.length > 0) {
          return sections;
        }
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

  const openHandsEvent =
    event.payload.openHandsEvent ??
    normalizeRawOpenHandsEvent(event.payload.rawOpenHandsEvent);
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
    return groupedToolNode(event, "reasoning", buildReasoningMember(event, openHandsEvent));
  }

  if (
    openHandsEvent.kind === "ActionEvent" ||
    openHandsEvent.kind === "ObservationEvent" ||
    openHandsEvent.kind === "AgentErrorEvent"
  ) {
    const toolName = getToolName(openHandsEvent);
    if (openHandsEvent.kind === "AgentErrorEvent" && toolName === "task") {
      return {
        type: "standalone",
        node: {
          id: event.eventId,
          kind: "subagent_error",
          status: "failed",
          createdAtMs: event.createdAtMs,
          label: "Subagent error",
          bodyText: getErrorText(openHandsEvent) ?? "Subagent failed",
          sourceEventIds: [event.eventId],
          rawPayload: event.payload.rawOpenHandsEvent,
        },
      };
    }
    if (openHandsEvent.kind === "AgentErrorEvent" && toolName) {
      return {
        type: "standalone",
        node: {
          id: event.eventId,
          kind: "tool_error",
          status: "failed",
          createdAtMs: event.createdAtMs,
          label: "Tool error",
          bodyText: getErrorText(openHandsEvent) ?? "Tool execution failed",
          sourceEventIds: [event.eventId],
          rawPayload: event.payload.rawOpenHandsEvent,
        },
      };
    }
    if (toolName === "think") {
      return groupedToolNode(event, "reasoning", buildReasoningMember(event, openHandsEvent));
    }
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
    if (toolName === "invoke_skill") {
      const actionText = getActionSummary(openHandsEvent) ?? "Skill invoked";
      const observationText =
        openHandsEvent.kind === "ObservationEvent"
          ? getObservationText(openHandsEvent)
          : undefined;
      return {
        type: "standalone",
        node: {
          id: getStandaloneMergeKey("skill", openHandsEvent),
          kind: "skill",
          status: event.status,
          createdAtMs: event.createdAtMs,
          label: "Skill",
          bodyText: actionText,
          actionText,
          observationText,
          thoughtText: getReasoningText(openHandsEvent),
          sourceEventIds: [event.eventId],
          rawPayload: event.payload.rawOpenHandsEvent,
        },
        mergeKey: getStandaloneMergeKey("skill", openHandsEvent),
      };
    }
    if (toolName === "task") {
      const actionText = getActionSummary(openHandsEvent) ?? "Subagent launched";
      const observationText =
        openHandsEvent.kind === "ObservationEvent"
          ? getObservationText(openHandsEvent)
          : undefined;
      return {
        type: "standalone",
        node: {
          id: getStandaloneMergeKey("subagent", openHandsEvent),
          kind: "subagent",
          status: event.status,
          createdAtMs: event.createdAtMs,
          label: "Subagent",
          bodyText: actionText,
          actionText,
          observationText,
          thoughtText: getReasoningText(openHandsEvent),
          sourceEventIds: [event.eventId],
          rawPayload: event.payload.rawOpenHandsEvent,
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
            getActionSummary(openHandsEvent) ??
            "Result available",
          sourceEventIds: [event.eventId],
          rawPayload: event.payload.rawOpenHandsEvent,
        },
      };
    }
    if (openHandsEvent.kind === "ObservationEvent") {
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
            rawPayload: event.payload.rawOpenHandsEvent,
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
  const errorText = getErrorText(openHandsEvent);

  return {
    id: event.eventId,
    title: openHandsEvent.kind === "ActionEvent" ? "Run command" : "Command output",
    bodyText: commandText ?? observationText ?? errorText ?? "Terminal activity captured",
    actionText: commandText,
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
  const observationText = getObservationText(openHandsEvent);
  const errorText = getErrorText(openHandsEvent);
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

  return {
    id: event.eventId,
    title: command ? capitalize(command) : "File activity",
    bodyText: path ?? observationText ?? errorText ?? "File activity captured",
    actionText: path,
    observationText,
    errorText,
    thoughtText: getReasoningText(openHandsEvent),
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
    thoughtText: getReasoningText(openHandsEvent),
    sourceEventIds: [event.eventId],
  };
}

function isThinkObservationPlaceholder(value?: string): boolean {
  return value?.trim() === "Your thought has been logged.";
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

function getToolCallIdFromEnvelope(
  event: ConversationEventEnvelope,
): string | undefined {
  const openHandsEvent =
    event.payload.openHandsEvent ??
    normalizeRawOpenHandsEvent(event.payload.rawOpenHandsEvent);
  if (!openHandsEvent) return undefined;
  return getToolCallId(openHandsEvent);
}

function normalizeRawOpenHandsEvent(rawEvent: unknown): OpenHandsConversationEvent | null {
  if (!rawEvent || typeof rawEvent !== "object") return null;
  return normalizeConversationEventMessage(rawEvent as Record<string, unknown>);
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

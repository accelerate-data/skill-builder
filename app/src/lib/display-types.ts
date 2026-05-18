import type { ConversationEventStatus } from "./conversation-event-types";

export type DisplayNodeKind =
  | "task_sent"
  | "agent_update"
  | "activity_trace"
  | "tool_batch"
  | "skill"
  | "subagent"
  | "result"
  | "terminal_activity"
  | "file_activity"
  | "reasoning"
  | "runtime_setup"
  | "lifecycle"
  | "pause"
  | "error"
  | "tool_error"
  | "subagent_error"
  | "unknown_event";

export interface DisplayNodeMember {
  id: string;
  title: string;
  bodyText?: string;
  actionText?: string;
  observationText?: string;
  errorText?: string;
  thoughtText?: string;
  toolCallId?: string;
  actionEventId?: string;
  sourceEventIds: string[];
}

export interface DisplayTraceDrawerSection {
  title: string;
  body: string;
}

export interface DisplayTraceItem {
  id: string;
  kind: Exclude<DisplayNodeKind, "task_sent" | "agent_update" | "activity_trace" | "unknown_event">;
  title: string;
  summary: string;
  badgeLabel: string;
  sourceEventIds: string[];
  interactive?: boolean;
  drawerTitle?: string;
  drawerSubtitle?: string;
  drawerSections?: DisplayTraceDrawerSection[];
}

export interface DisplayNode {
  id: string;
  kind: DisplayNodeKind;
  status: ConversationEventStatus;
  createdAtMs: number;
  label?: string;
  bodyText?: string;
  actionText?: string;
  observationText?: string;
  thoughtText?: string;
  collapsedByDefault?: boolean;
  sourceEventIds: string[];
  groupedMemberEventIds?: string[];
  suppressedEventIds?: string[];
  members?: DisplayNodeMember[];
  traceItems?: DisplayTraceItem[];
  rawPayload?: unknown;
}

export const DISPLAY_TYPES_VERSION = 12;

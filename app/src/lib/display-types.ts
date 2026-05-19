import type { ConversationEventStatus } from "./conversation-event-types";

export type DisplayNodeKind =
  | "task_sent"
  | "agent_update"
  | "tool_batch"
  | "skill"
  | "subagent"
  | "result"
  | "terminal_activity"
  | "file_activity"
  | "reasoning"
  | "runtime_setup"
  | "pause"
  | "turn_end"
  | "error"
  | "tool_error"
  | "subagent_error"
  | "unknown_event";

export interface DisplayNodeMember {
  id: string;
  title: string;
  toolName?: string;
  bodyText?: string;
  actionText?: string;
  observationText?: string;
  errorText?: string;
  thoughtText?: string;
  toolCallId?: string;
  actionEventId?: string;
  sourceEventIds: string[];
}

export interface DisplayNode {
  id: string;
  kind: DisplayNodeKind;
  status: ConversationEventStatus;
  createdAtMs: number;
  label?: string;
  bodyText?: string;
  reasoningText?: string;
  actionText?: string;
  observationText?: string;
  thoughtText?: string;
  collapsedByDefault?: boolean;
  sourceEventIds: string[];
  groupedMemberEventIds?: string[];
  suppressedEventIds?: string[];
  members?: DisplayNodeMember[];
  rawPayload?: unknown;
}

export const DISPLAY_TYPES_VERSION = 14;

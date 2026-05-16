export type ConversationEventStatus =
  | "sending"
  | "accepted"
  | "failed"
  | "observed";

export type ConversationEventOrigin = "frontend" | "backend";

export type ConversationDisplayKind =
  | "user_message"
  | "agent_message"
  | "tool_call"
  | "tool_result"
  | "subagent"
  | "state"
  | "error"
  | "system";

export interface FrontendConversationCommand {
  type: "send_message";
  text: string;
  targetFiles?: string[];
}

export interface ConversationBackendError {
  message: string;
  code?: string;
}

export interface ConversationEventEnvelope {
  eventId: string;
  conversationId: string;
  origin: ConversationEventOrigin;
  status: ConversationEventStatus;
  createdAtMs: number;
  acceptedAtMs?: number | null;
  failedAtMs?: number | null;
  display: {
    kind: ConversationDisplayKind;
    label?: string;
    collapsedByDefault?: boolean;
  };
  payload: {
    rawOpenHandsEvent?: unknown;
    frontendCommand?: FrontendConversationCommand;
    backendError?: ConversationBackendError;
  };
}

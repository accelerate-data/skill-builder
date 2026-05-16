import type {
  ConversationDisplayKind,
  ConversationEventStatus,
} from "./conversation-event-types";

export interface DisplayNode {
  id: string;
  kind: ConversationDisplayKind;
  status: ConversationEventStatus;
  label?: string;
  collapsedByDefault?: boolean;
  createdAtMs: number;
  payload: {
    rawOpenHandsEvent?: unknown;
    frontendCommand?: {
      type: "send_message";
      text: string;
      targetFiles?: string[];
    };
    backendError?: {
      message: string;
      code?: string;
    };
  };
}

export const DISPLAY_TYPES_VERSION = 9;

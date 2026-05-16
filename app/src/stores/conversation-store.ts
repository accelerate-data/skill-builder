import { create } from "zustand";
import {
  appendObservedEvent,
  markEventAccepted,
  markEventFailed,
} from "@/lib/conversation-event-ordering";
import type {
  ConversationBackendError,
  ConversationEventEnvelope,
} from "@/lib/conversation-event-types";

interface ConversationStoreState {
  eventsByConversation: Record<string, ConversationEventEnvelope[]>;
  appendFrontendSendingEvent: (event: ConversationEventEnvelope) => void;
  markFrontendEventAccepted: (
    conversationId: string,
    eventId: string,
    acceptedAtMs: number,
  ) => void;
  markFrontendEventFailed: (
    conversationId: string,
    eventId: string,
    error: ConversationBackendError,
    failedAtMs: number,
  ) => void;
  appendBackendObservedEvent: (event: ConversationEventEnvelope) => void;
  replaceConversationHistory: (
    conversationId: string,
    events: ConversationEventEnvelope[],
  ) => void;
}

function getConversationEvents(
  state: ConversationStoreState,
  conversationId: string,
): ConversationEventEnvelope[] {
  return state.eventsByConversation[conversationId] ?? [];
}

export const useConversationStore = create<ConversationStoreState>((set) => ({
  eventsByConversation: {},

  appendFrontendSendingEvent: (event) =>
    set((state) => ({
      eventsByConversation: {
        ...state.eventsByConversation,
        [event.conversationId]: [
          ...getConversationEvents(state, event.conversationId),
          event,
        ],
      },
    })),

  markFrontendEventAccepted: (conversationId, eventId, acceptedAtMs) =>
    set((state) => ({
      eventsByConversation: {
        ...state.eventsByConversation,
        [conversationId]: markEventAccepted(
          getConversationEvents(state, conversationId),
          eventId,
          acceptedAtMs,
        ),
      },
    })),

  markFrontendEventFailed: (conversationId, eventId, error, failedAtMs) =>
    set((state) => ({
      eventsByConversation: {
        ...state.eventsByConversation,
        [conversationId]: markEventFailed(
          getConversationEvents(state, conversationId),
          eventId,
          error,
          failedAtMs,
        ),
      },
    })),

  appendBackendObservedEvent: (event) =>
    set((state) => ({
      eventsByConversation: {
        ...state.eventsByConversation,
        [event.conversationId]: appendObservedEvent(
          getConversationEvents(state, event.conversationId),
          event,
        ),
      },
    })),

  replaceConversationHistory: (conversationId, events) =>
    set((state) => ({
      eventsByConversation: {
        ...state.eventsByConversation,
        [conversationId]: events,
      },
    })),
}));

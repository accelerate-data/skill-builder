import type {
  ConversationBackendError,
  ConversationEventEnvelope,
} from "./conversation-event-types";

function updateEventById(
  events: ConversationEventEnvelope[],
  eventId: string,
  updater: (event: ConversationEventEnvelope) => ConversationEventEnvelope,
): ConversationEventEnvelope[] {
  let changed = false;
  const nextEvents = events.map((event) => {
    if (event.eventId !== eventId) {
      return event;
    }
    changed = true;
    return updater(event);
  });

  return changed ? nextEvents : events;
}

export function markEventAccepted(
  events: ConversationEventEnvelope[],
  eventId: string,
  acceptedAtMs: number,
): ConversationEventEnvelope[] {
  return updateEventById(events, eventId, (event) => ({
    ...event,
    status: "accepted",
    acceptedAtMs,
    failedAtMs: null,
    payload: {
      ...event.payload,
      backendError: undefined,
    },
  }));
}

export function markEventFailed(
  events: ConversationEventEnvelope[],
  eventId: string,
  error: ConversationBackendError,
  failedAtMs: number,
): ConversationEventEnvelope[] {
  return updateEventById(events, eventId, (event) => ({
    ...event,
    status: "failed",
    failedAtMs,
    acceptedAtMs: null,
    payload: {
      ...event.payload,
      backendError: error,
    },
  }));
}

export function appendObservedEvent(
  events: ConversationEventEnvelope[],
  event: ConversationEventEnvelope,
): ConversationEventEnvelope[] {
  return [...events, event];
}

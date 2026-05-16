import { beforeEach, describe, expect, it } from "vitest";
import { useConversationStore } from "@/stores/conversation-store";
import type { ConversationEventEnvelope } from "@/lib/conversation-event-types";

function makeEvent(
  overrides: Partial<ConversationEventEnvelope> & {
    eventId: string;
    conversationId: string;
    createdAtMs: number;
  },
): ConversationEventEnvelope {
  return {
    eventId: overrides.eventId,
    conversationId: overrides.conversationId,
    origin: "frontend",
    status: "sending",
    createdAtMs: overrides.createdAtMs,
    display: {
      kind: "user_message",
    },
    payload: {
      frontendCommand: {
        type: "send_message",
        text: "hello",
      },
    },
    ...overrides,
  };
}

describe("conversation-store", () => {
  beforeEach(() => {
    useConversationStore.setState({ eventsByConversation: {} });
  });

  it("appends a frontend sending event and keeps conversations isolated", () => {
    useConversationStore.getState().appendFrontendSendingEvent(
      makeEvent({
        eventId: "evt-1",
        conversationId: "conv-1",
        createdAtMs: 1_000,
      }),
    );
    useConversationStore.getState().appendFrontendSendingEvent(
      makeEvent({
        eventId: "evt-2",
        conversationId: "conv-2",
        createdAtMs: 2_000,
      }),
    );

    const state = useConversationStore.getState();
    expect(state.eventsByConversation["conv-1"]).toHaveLength(1);
    expect(state.eventsByConversation["conv-2"]).toHaveLength(1);
  });

  it("marks a frontend event accepted without reordering the stream", () => {
    useConversationStore.getState().replaceConversationHistory("conv-1", [
      makeEvent({
        eventId: "evt-1",
        conversationId: "conv-1",
        createdAtMs: 1_000,
      }),
      makeEvent({
        eventId: "evt-2",
        conversationId: "conv-1",
        createdAtMs: 1_100,
        origin: "backend",
        status: "observed",
        display: { kind: "state" },
        payload: { rawOpenHandsEvent: { status: "running" } },
      }),
    ]);

    useConversationStore
      .getState()
      .markFrontendEventAccepted("conv-1", "evt-1", 1_200);

    expect(
      useConversationStore
        .getState()
        .eventsByConversation["conv-1"].map((event) => event.eventId),
    ).toEqual(["evt-1", "evt-2"]);
    expect(
      useConversationStore.getState().eventsByConversation["conv-1"][0],
    ).toMatchObject({
      eventId: "evt-1",
      status: "accepted",
      acceptedAtMs: 1_200,
    });
  });

  it("stores backend observed events and frontend failures in the same transcript authority", () => {
    useConversationStore.getState().appendFrontendSendingEvent(
      makeEvent({
        eventId: "evt-1",
        conversationId: "conv-1",
        createdAtMs: 1_000,
      }),
    );

    useConversationStore.getState().appendBackendObservedEvent(
      makeEvent({
        eventId: "evt-2",
        conversationId: "conv-1",
        createdAtMs: 1_100,
        origin: "backend",
        status: "observed",
        display: { kind: "agent_message" },
        payload: { rawOpenHandsEvent: { message: "working" } },
      }),
    );

    useConversationStore
      .getState()
      .markFrontendEventFailed(
        "conv-1",
        "evt-1",
        { message: "send rejected", code: "E_REJECTED" },
        1_200,
      );

    expect(useConversationStore.getState().eventsByConversation["conv-1"]).toEqual([
      expect.objectContaining({
        eventId: "evt-1",
        status: "failed",
        payload: expect.objectContaining({
          backendError: { message: "send rejected", code: "E_REJECTED" },
        }),
      }),
      expect.objectContaining({
        eventId: "evt-2",
        status: "observed",
      }),
    ]);
  });
});

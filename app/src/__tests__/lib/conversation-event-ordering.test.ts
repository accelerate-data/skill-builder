import { describe, expect, it } from "vitest";
import {
  appendObservedEvent,
  markEventAccepted,
  markEventFailed,
  type ConversationEventEnvelope,
} from "@/lib/conversation-event-ordering";

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

describe("conversation-event-ordering", () => {
  it("keeps a sending user event in place when it becomes accepted", () => {
    const stream = [
      makeEvent({
        eventId: "evt-1",
        conversationId: "conv-1",
        createdAtMs: 1_000,
      }),
      makeEvent({
        eventId: "evt-2",
        conversationId: "conv-1",
        createdAtMs: 2_000,
        origin: "backend",
        status: "observed",
        display: { kind: "state", label: "Running" },
        payload: { rawOpenHandsEvent: { status: "running" } },
      }),
    ];

    const updated = markEventAccepted(stream, "evt-1", 3_000);

    expect(updated).toHaveLength(2);
    expect(updated[0]).toMatchObject({
      eventId: "evt-1",
      status: "accepted",
      acceptedAtMs: 3_000,
    });
    expect(updated[1].eventId).toBe("evt-2");
  });

  it("marks a sending event failed in place and attaches backend error details", () => {
    const stream = [
      makeEvent({
        eventId: "evt-1",
        conversationId: "conv-1",
        createdAtMs: 1_000,
      }),
    ];

    const updated = markEventFailed(
      stream,
      "evt-1",
      { message: "network down", code: "E_SEND" },
      1_500,
    );

    expect(updated).toEqual([
      expect.objectContaining({
        eventId: "evt-1",
        status: "failed",
        failedAtMs: 1_500,
        payload: expect.objectContaining({
          backendError: { message: "network down", code: "E_SEND" },
        }),
      }),
    ]);
  });

  it("appends backend observed events at the tail", () => {
    const stream = [
      makeEvent({
        eventId: "evt-1",
        conversationId: "conv-1",
        createdAtMs: 1_000,
      }),
    ];
    const observed = makeEvent({
      eventId: "evt-2",
      conversationId: "conv-1",
      createdAtMs: 900,
      origin: "backend",
      status: "observed",
      display: { kind: "agent_message" },
      payload: { rawOpenHandsEvent: { message: "done" } },
    });

    const updated = appendObservedEvent(stream, observed);

    expect(updated.map((event) => event.eventId)).toEqual(["evt-1", "evt-2"]);
  });
});

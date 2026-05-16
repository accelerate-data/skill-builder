import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useConversationEvents } from "@/hooks/use-conversation-stream";
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
    origin: "backend",
    status: "observed",
    createdAtMs: overrides.createdAtMs,
    display: { kind: "agent_message" },
    payload: { rawOpenHandsEvent: { text: "hello" } },
    ...overrides,
  };
}

describe("use-conversation-stream", () => {
  beforeEach(() => {
    useConversationStore.setState({ eventsByConversation: {} });
  });

  it("returns canonical events for the requested conversation only", () => {
    useConversationStore.getState().replaceConversationHistory("conv-1", [
      makeEvent({
        eventId: "evt-1",
        conversationId: "conv-1",
        createdAtMs: 1_000,
      }),
    ]);
    useConversationStore.getState().replaceConversationHistory("conv-2", [
      makeEvent({
        eventId: "evt-2",
        conversationId: "conv-2",
        createdAtMs: 2_000,
      }),
    ]);

    const { result } = renderHook(() => useConversationEvents("conv-1"));

    expect(result.current.map((event) => event.eventId)).toEqual(["evt-1"]);
  });
});

import { describe, expect, it } from "vitest";
import { projectConversationEvents } from "@/lib/conversation-event-projection";
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
    status: "accepted",
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

describe("conversation-event-projection", () => {
  it("projects canonical events into display nodes with stable ids and status", () => {
    const nodes = projectConversationEvents([
      makeEvent({
        eventId: "evt-1",
        conversationId: "conv-1",
        createdAtMs: 1_000,
        display: { kind: "user_message", label: "You" },
      }),
      makeEvent({
        eventId: "evt-2",
        conversationId: "conv-1",
        createdAtMs: 2_000,
        origin: "backend",
        status: "observed",
        display: { kind: "agent_message", label: "OpenHands" },
        payload: { rawOpenHandsEvent: { text: "Done." } },
      }),
    ]);

    expect(nodes).toEqual([
      expect.objectContaining({
        id: "evt-1",
        kind: "user_message",
        status: "accepted",
        label: "You",
      }),
      expect.objectContaining({
        id: "evt-2",
        kind: "agent_message",
        status: "observed",
        label: "OpenHands",
      }),
    ]);
  });

  it("preserves collapsed-by-default display hints for the renderer", () => {
    const [node] = projectConversationEvents([
      makeEvent({
        eventId: "evt-tool",
        conversationId: "conv-1",
        createdAtMs: 1_000,
        origin: "backend",
        status: "observed",
        display: {
          kind: "tool_call",
          label: "Read file",
          collapsedByDefault: true,
        },
        payload: { rawOpenHandsEvent: { tool: "read_file" } },
      }),
    ]);

    expect(node).toMatchObject({
      id: "evt-tool",
      kind: "tool_call",
      collapsedByDefault: true,
      label: "Read file",
    });
  });
});

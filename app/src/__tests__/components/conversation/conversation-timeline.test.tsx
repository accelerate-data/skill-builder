import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ConversationTimeline } from "@/components/conversation/conversation-timeline";
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
    status: "accepted",
    createdAtMs: overrides.createdAtMs,
    display: {
      kind: "user_message",
      label: "You",
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

describe("ConversationTimeline", () => {
  beforeEach(() => {
    useConversationStore.setState({ eventsByConversation: {} });
  });

  it("renders canonical events for the selected session conversation only", () => {
    useConversationStore.getState().replaceConversationHistory("conv-session-1", [
      makeEvent({
        eventId: "evt-user",
        conversationId: "conv-session-1",
        createdAtMs: 1_000,
        display: { kind: "user_message", label: "You" },
        payload: {
          frontendCommand: {
            type: "send_message",
            text: "Draft the rollout plan",
          },
        },
      }),
      makeEvent({
        eventId: "evt-agent",
        conversationId: "conv-session-1",
        createdAtMs: 2_000,
        origin: "backend",
        status: "observed",
        display: { kind: "agent_message", label: "OpenHands" },
        payload: {
          rawOpenHandsEvent: {
            text: "Plan drafted and ready for review.",
          },
        },
      }),
      makeEvent({
        eventId: "evt-error",
        conversationId: "conv-session-1",
        createdAtMs: 3_000,
        origin: "backend",
        status: "failed",
        display: { kind: "error", label: "Transport" },
        payload: {
          backendError: {
            message: "Session dispatch failed",
          },
        },
      }),
    ]);
    useConversationStore.getState().replaceConversationHistory("conv-session-2", [
      makeEvent({
        eventId: "evt-other",
        conversationId: "conv-session-2",
        createdAtMs: 500,
        payload: {
          frontendCommand: {
            type: "send_message",
            text: "This should stay hidden",
          },
        },
      }),
    ]);

    render(<ConversationTimeline conversationId="conv-session-1" />);

    const rows = screen.getAllByTestId("conversation-event-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Draft the rollout plan");
    expect(rows[1]).toHaveTextContent("Plan drafted and ready for review.");
    expect(rows[2]).toHaveTextContent("Session dispatch failed");
    expect(screen.queryByText("This should stay hidden")).not.toBeInTheDocument();
  });

  it("shows an empty state when the selected session has no canonical events yet", () => {
    render(<ConversationTimeline conversationId="conv-empty" />);

    const emptyState = screen.getByTestId("conversation-timeline-empty");
    expect(within(emptyState).getByText("No conversation activity yet")).toBeInTheDocument();
  });
});

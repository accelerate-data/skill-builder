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
        eventId: "evt-state-running",
        conversationId: "conv-session-1",
        createdAtMs: 1_500,
        origin: "backend",
        status: "observed",
        display: { kind: "state", label: "State" },
        payload: {
          openHandsEvent: {
            kind: "ConversationStateUpdateEvent",
            id: "state-running",
            timestamp: new Date(1_500).toISOString(),
            source: "environment",
            key: "execution_status",
            value: "running",
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
          openHandsEvent: {
            kind: "MessageEvent",
            id: "agent-message",
            timestamp: new Date(2_000).toISOString(),
            source: "agent",
            llm_message: {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "Plan drafted and ready for review.",
                },
              ],
            },
          },
        },
      }),
      makeEvent({
        eventId: "evt-task-state",
        conversationId: "conv-session-1",
        createdAtMs: 2_500,
        origin: "backend",
        status: "observed",
        display: { kind: "state", label: "State" },
        payload: {
          openHandsEvent: {
            kind: "ConversationStateUpdateEvent",
            id: "state-last-user",
            timestamp: new Date(2_500).toISOString(),
            source: "environment",
            key: "last_user_message_id",
            value: "evt-user",
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
          openHandsEvent: {
            kind: "ConversationErrorEvent",
            id: "conversation-error",
            timestamp: new Date(3_000).toISOString(),
            source: "environment",
            code: "dispatch_failed",
            detail: "Session dispatch failed",
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
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Draft the rollout plan");
    expect(rows[1]).toHaveTextContent("Plan drafted and ready for review.");
    expect(screen.getByTestId("conversation-status-footer")).toHaveTextContent("error");
    expect(screen.queryByText("This should stay hidden")).not.toBeInTheDocument();
  });

  it("shows an empty state when the selected session has no canonical events yet", () => {
    render(<ConversationTimeline conversationId="conv-empty" />);

    const emptyState = screen.getByTestId("conversation-timeline-empty");
    expect(within(emptyState).getByText("No conversation activity yet")).toBeInTheDocument();
  });

  it("shows paused state in the bottom footer when a pause event is the latest runtime signal", () => {
    useConversationStore.getState().replaceConversationHistory("conv-paused", [
      makeEvent({
        eventId: "evt-user",
        conversationId: "conv-paused",
        createdAtMs: 1_000,
        payload: {
          frontendCommand: {
            type: "send_message",
            text: "Wait for review",
          },
        },
      }),
      makeEvent({
        eventId: "evt-pause",
        conversationId: "conv-paused",
        createdAtMs: 2_000,
        origin: "backend",
        status: "observed",
        display: { kind: "state", label: "State" },
        payload: {
          openHandsEvent: {
            kind: "PauseEvent",
            id: "pause-1",
            timestamp: new Date(2_000).toISOString(),
            source: "environment",
            reason: "Waiting for review.",
          },
        },
      }),
    ]);

    render(<ConversationTimeline conversationId="conv-paused" />);

    expect(screen.getByTestId("conversation-status-footer")).toHaveTextContent("paused");
    expect(screen.getByTestId("conversation-status-footer")).toHaveTextContent(
      "Waiting for review.",
    );
  });
});

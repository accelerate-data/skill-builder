import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationStore } from "@/stores/conversation-store";

const mockInvokeUnsafe = vi.fn();

vi.mock("@/lib/tauri", () => ({
  sendConversationMessageCommand: (...args: unknown[]) => mockInvokeUnsafe(...args),
}));

import { sendConversationMessage } from "@/lib/conversation-runtime";

describe("conversation-runtime", () => {
  beforeEach(() => {
    mockInvokeUnsafe.mockReset();
    useConversationStore.setState({ eventsByConversation: {} });
  });

  it("sends a conversation message through the shared Tauri command", async () => {
    mockInvokeUnsafe.mockResolvedValue({ accepted: true });

    const result = await sendConversationMessage({
      conversationId: "conv-1",
      message: "hello",
      localEventId: "evt-1",
    });

    expect(mockInvokeUnsafe).toHaveBeenCalledWith(
      "conv-1",
      "evt-1",
      "hello",
    );
    expect(result).toEqual({ accepted: true });
  });

  it("normalizes Tauri invocation failures into a rejected-send result", async () => {
    mockInvokeUnsafe.mockRejectedValue(new Error("send failed"));

    useConversationStore.getState().appendFrontendSendingEvent({
      eventId: "evt-1",
      conversationId: "conv-1",
      origin: "frontend",
      status: "sending",
      createdAtMs: 1_000,
      display: { kind: "user_message" },
      payload: {
        frontendCommand: {
          type: "send_message",
          text: "hello",
        },
      },
    });

    await expect(
      sendConversationMessage({
        conversationId: "conv-1",
        message: "hello",
        localEventId: "evt-1",
      }),
    ).resolves.toEqual({
      accepted: false,
      error: "send failed",
    });

    expect(
      useConversationStore.getState().eventsByConversation["conv-1"][0],
    ).toMatchObject({
      eventId: "evt-1",
      status: "failed",
      payload: {
        frontendCommand: {
          type: "send_message",
          text: "hello",
        },
        backendError: {
          message: "send failed",
        },
      },
    });
  });

  it("marks the frontend sending event accepted after a successful send", async () => {
    mockInvokeUnsafe.mockResolvedValue({ accepted: true });

    useConversationStore.getState().appendFrontendSendingEvent({
      eventId: "evt-1",
      conversationId: "conv-1",
      origin: "frontend",
      status: "sending",
      createdAtMs: 1_000,
      display: { kind: "user_message" },
      payload: {
        frontendCommand: {
          type: "send_message",
          text: "hello",
        },
      },
    });

    await expect(
      sendConversationMessage({
        conversationId: "conv-1",
        message: "hello",
        localEventId: "evt-1",
      }),
    ).resolves.toEqual({ accepted: true });

    expect(
      useConversationStore.getState().eventsByConversation["conv-1"][0],
    ).toMatchObject({
      eventId: "evt-1",
      status: "accepted",
    });
  });
});

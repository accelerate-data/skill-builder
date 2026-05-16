import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInvokeUnsafe = vi.fn();

vi.mock("@/lib/tauri", () => ({
  sendConversationMessageCommand: (...args: unknown[]) => mockInvokeUnsafe(...args),
}));

import { sendConversationMessage } from "@/lib/conversation-runtime";

describe("conversation-runtime", () => {
  beforeEach(() => {
    mockInvokeUnsafe.mockReset();
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
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "@/stores/chat-store";

describe("chat-store", () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it("starts with empty state", () => {
    const state = useChatStore.getState();
    expect(state.sessionId).toBeNull();
    expect(state.skillName).toBeNull();
    expect(state.mode).toBe("conversational");
    expect(state.messages).toEqual([]);
    expect(state.isStreaming).toBe(false);
    expect(state.activeAgentId).toBeNull();
  });

  it("initSession sets session data and clears messages", () => {
    useChatStore.getState().addMessage({
      id: "old",
      role: "user",
      content: "old message",
      createdAt: "2024-01-01",
    });

    useChatStore.getState().initSession("sess-1", "my-skill", "conversational");

    const state = useChatStore.getState();
    expect(state.sessionId).toBe("sess-1");
    expect(state.skillName).toBe("my-skill");
    expect(state.mode).toBe("conversational");
    expect(state.messages).toEqual([]);
  });

  it("addMessage appends to messages", () => {
    useChatStore.getState().addMessage({
      id: "msg-1",
      role: "user",
      content: "Hello",
      createdAt: "2024-01-01",
    });
    useChatStore.getState().addMessage({
      id: "msg-2",
      role: "assistant",
      content: "Hi there!",
      createdAt: "2024-01-01",
    });

    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
  });

  it("setMessages replaces all messages", () => {
    useChatStore.getState().addMessage({
      id: "msg-1",
      role: "user",
      content: "Hello",
      createdAt: "2024-01-01",
    });

    useChatStore.getState().setMessages([
      { id: "msg-new", role: "assistant", content: "New", createdAt: "2024-01-02" },
    ]);

    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].id).toBe("msg-new");
  });

  it("setMode toggles between modes", () => {
    expect(useChatStore.getState().mode).toBe("conversational");
    useChatStore.getState().setMode("review");
    expect(useChatStore.getState().mode).toBe("review");
  });

  it("setStreaming and setActiveAgentId work", () => {
    useChatStore.getState().setStreaming(true);
    expect(useChatStore.getState().isStreaming).toBe(true);

    useChatStore.getState().setActiveAgentId("agent-123");
    expect(useChatStore.getState().activeAgentId).toBe("agent-123");
  });

  it("reset clears all state", () => {
    useChatStore.getState().initSession("sess-1", "skill", "review");
    useChatStore.getState().addMessage({
      id: "msg-1",
      role: "user",
      content: "Hello",
      createdAt: "2024-01-01",
    });
    useChatStore.getState().setStreaming(true);
    useChatStore.getState().setActiveAgentId("agent-1");

    useChatStore.getState().reset();

    const state = useChatStore.getState();
    expect(state.sessionId).toBeNull();
    expect(state.skillName).toBeNull();
    expect(state.mode).toBe("conversational");
    expect(state.messages).toEqual([]);
    expect(state.isStreaming).toBe(false);
    expect(state.activeAgentId).toBeNull();
  });
});

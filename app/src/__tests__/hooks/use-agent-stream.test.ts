import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockListen, resetTauriMocks } from "@/test/mocks/tauri";

type ListenCallback = (event: { payload: unknown }) => void;

describe("use-agent-stream", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.resetModules();
  });

  it("bridges legacy agent-keyed runtime events into the canonical conversation store", async () => {
    let agentMessageListener: ListenCallback | undefined;

    vi.mocked(mockListen).mockImplementation((event: string, callback: ListenCallback) => {
      if (event === "agent-message") {
        agentMessageListener = callback;
      }
      return Promise.resolve(vi.fn());
    });

    const { useConversationStore } = await import("@/stores/conversation-store");
    const { useAgentStore } = await import("@/stores/agent-store");
    const { useSkillStore } = await import("@/stores/skill-store");
    useConversationStore.setState({ eventsByConversation: {} });
    useSkillStore.getState().clearSelectedSkillSession();
    useSkillStore.getState().setConversationId("conv-selected");
    const agentStreamModule = await import("@/hooks/use-agent-stream");
    await agentStreamModule._resetForTesting();
    await agentStreamModule.initAgentStream();

    expect(agentMessageListener).toBeDefined();

    agentMessageListener?.({
      payload: {
        agent_id: "selected-skill-agent",
        message: {
          type: "conversation_state",
          runtime: "openhands",
          agent_id: "selected-skill-agent",
          status: "running",
          timestamp: 1_778_000_100,
        },
      },
    });

    const events =
      useConversationStore.getState().eventsByConversation["conv-selected"];

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      conversationId: "conv-selected",
      origin: "backend",
      status: "observed",
      display: { kind: "state" },
    });
    expect(
      useAgentStore.getState().runs["selected-skill-agent"]?.conversationState,
    ).toMatchObject({
      status: "running",
    });
  });
});

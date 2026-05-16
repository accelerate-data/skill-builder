import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockListen, resetTauriMocks } from "@/test/mocks/tauri";

type ListenCallback = (event: { payload: unknown }) => void;

describe("use-session-runtime-stream", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.resetModules();
  });

  it("bridges runtime conversation_state events into canonical conversation and session runtime stores", async () => {
    let agentMessageListener: ListenCallback | undefined;

    vi.mocked(mockListen).mockImplementation(
      (event: string, callback: ListenCallback) => {
        if (event === "agent-message") {
          agentMessageListener = callback;
        }
        return Promise.resolve(vi.fn());
      },
    );

    const { useConversationStore } =
      await import("@/stores/conversation-store");
    const { useSessionRuntimeStore } =
      await import("@/stores/session-runtime-store");
    const { useSkillStore } = await import("@/stores/skill-store");
    useConversationStore.setState({ eventsByConversation: {} });
    useSessionRuntimeStore.getState().clearSessionRuns();
    useSkillStore.getState().clearSelectedSkillSession();
    useSkillStore.getState().setConversationId("conv-selected");
    const runtimeStreamModule =
      await import("@/hooks/use-session-runtime-stream");
    await runtimeStreamModule._resetForTesting();
    await runtimeStreamModule.initSessionRuntimeStream();

    expect(agentMessageListener).toBeDefined();

    agentMessageListener?.({
      payload: {
        conversation_id: "conv-selected",
        message: {
          type: "conversation_state",
          runtime: "openhands",
          conversation_id: "conv-selected",
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
      useSessionRuntimeStore.getState().runs["conv-selected"]
        ?.conversationState,
    ).toMatchObject({
      status: "running",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockListen, resetTauriMocks } from "@/test/mocks/tauri";

type ListenCallback = (event: { payload: unknown }) => void;

describe("use-session-runtime-stream", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.resetModules();
  });

  it("bridges canonical backend conversation events into conversation and session runtime stores", async () => {
    let agentConversationEventListener: ListenCallback | undefined;

    vi.mocked(mockListen).mockImplementation(
      (event: string, callback: ListenCallback) => {
        if (event === "agent-conversation-event") {
          agentConversationEventListener = callback;
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

    expect(agentConversationEventListener).toBeDefined();

    agentConversationEventListener?.({
      payload: {
        conversation_id: "conv-selected",
        event: {
          kind: "ConversationStateUpdateEvent",
          id: "evt-running",
          timestamp: new Date(1_778_000_100).toISOString(),
          source: "environment",
          key: "execution_status",
          value: "running",
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

  it("maps execution_status=error into session runtime error state", async () => {
    let agentConversationEventListener: ListenCallback | undefined;

    vi.mocked(mockListen).mockImplementation(
      (event: string, callback: ListenCallback) => {
        if (event === "agent-conversation-event") {
          agentConversationEventListener = callback;
        }
        return Promise.resolve(vi.fn());
      },
    );

    const { useSessionRuntimeStore } =
      await import("@/stores/session-runtime-store");
    const { useSkillStore } = await import("@/stores/skill-store");
    useSessionRuntimeStore.getState().clearSessionRuns();
    useSkillStore.getState().clearSelectedSkillSession();
    useSkillStore.getState().setConversationId("conv-selected");
    const runtimeStreamModule =
      await import("@/hooks/use-session-runtime-stream");
    await runtimeStreamModule._resetForTesting();
    await runtimeStreamModule.initSessionRuntimeStream();

    agentConversationEventListener?.({
      payload: {
        conversation_id: "conv-selected",
        event: {
          kind: "ConversationStateUpdateEvent",
          id: "evt-error",
          timestamp: new Date(1_778_000_101).toISOString(),
          source: "environment",
          key: "execution_status",
          value: "error",
        },
      },
    });

    expect(
      useSessionRuntimeStore.getState().runs["conv-selected"]
        ?.conversationState,
    ).toMatchObject({
      status: "error",
    });
  });

  it("maps execution_status=completed into session runtime completed state", async () => {
    let agentConversationEventListener: ListenCallback | undefined;

    vi.mocked(mockListen).mockImplementation(
      (event: string, callback: ListenCallback) => {
        if (event === "agent-conversation-event") {
          agentConversationEventListener = callback;
        }
        return Promise.resolve(vi.fn());
      },
    );

    const { useSessionRuntimeStore } =
      await import("@/stores/session-runtime-store");
    const { useSkillStore } = await import("@/stores/skill-store");
    useSessionRuntimeStore.getState().clearSessionRuns();
    useSkillStore.getState().clearSelectedSkillSession();
    useSkillStore.getState().setConversationId("conv-selected");
    const runtimeStreamModule =
      await import("@/hooks/use-session-runtime-stream");
    await runtimeStreamModule._resetForTesting();
    await runtimeStreamModule.initSessionRuntimeStream();

    agentConversationEventListener?.({
      payload: {
        conversation_id: "conv-selected",
        event: {
          kind: "ConversationStateUpdateEvent",
          id: "evt-completed",
          timestamp: new Date(1_778_000_102).toISOString(),
          source: "environment",
          key: "execution_status",
          value: "completed",
        },
      },
    });

    expect(
      useSessionRuntimeStore.getState().runs["conv-selected"]
        ?.conversationState,
    ).toMatchObject({
      status: "completed",
    });
  });
});

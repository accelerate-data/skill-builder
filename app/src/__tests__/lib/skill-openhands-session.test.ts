import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hydrateSelectedSkillOpenHandsSession,
  restartSkillOpenHandsSession,
} from "@/lib/skill-openhands-session";
import { useConversationStore } from "@/stores/conversation-store";
import { useSkillStore } from "@/stores/skill-store";
import type { SkillSessionInfo } from "@/lib/types";

const mockSelectSkillOpenHandsSession = vi.fn();

vi.mock("@/lib/tauri", () => ({
  selectSkillOpenHandsSession: (...args: unknown[]) =>
    mockSelectSkillOpenHandsSession(...args),
}));

describe("skill-openhands-session", () => {
  beforeEach(() => {
    useSkillStore.getState().clearSelectedSkillSession();
    useConversationStore.setState({ eventsByConversation: {} });
    mockSelectSkillOpenHandsSession.mockReset();
    vi.restoreAllMocks();
  });

  it("hydrates the selected skill session metadata", () => {
    const session: SkillSessionInfo = {
      conversation_id: "conv-123",
      skill_name: "sales-skill",
      created_at: new Date().toISOString(),
      available_agents: ["skill-creator"],
      restored_messages: [],
      restored_transcript_events: [],
    };

    hydrateSelectedSkillOpenHandsSession(
      { name: "sales-skill", plugin_slug: "skills", skill_source: "skill-builder" },
      session,
    );

    const sessionState = useSkillStore.getState();
    expect(sessionState.conversationId).toBe("conv-123");
    expect(sessionState.selectedSkill?.name).toBe("sales-skill");
    expect(sessionState.availableAgents).toEqual(["skill-creator"]);
  });

  it("replays restored transcript events into the canonical conversation store", () => {
    const session: SkillSessionInfo = {
      conversation_id: "conv-123",
      skill_name: "sales-skill",
      created_at: new Date().toISOString(),
      available_agents: ["skill-creator"],
      restored_messages: [],
      restored_transcript_events: [
        {
          kind: "MessageEvent",
          id: "evt-1",
          timestamp: new Date(1_000).toISOString(),
          source: "agent",
          llm_message: {
            role: "assistant",
            content: [{ type: "text", text: "Restored answer" }],
          },
        },
        {
          kind: "ObservationEvent",
          id: "evt-2",
          timestamp: new Date(2_000).toISOString(),
          source: "environment",
          tool_name: "terminal",
          tool_call_id: "tool-1",
          action_id: "evt-action",
          observation: "Observed tool output",
        },
      ],
    };

    hydrateSelectedSkillOpenHandsSession(
      { name: "sales-skill", plugin_slug: "skills", skill_source: "skill-builder" },
      session,
    );

    expect(
      useConversationStore.getState().eventsByConversation["conv-123"],
    ).toMatchObject([
      {
        conversationId: "conv-123",
        origin: "backend",
        status: "observed",
        createdAtMs: 1_000,
        display: { kind: "agent_message" },
        payload: {
          openHandsEvent: {
            kind: "MessageEvent",
            id: "evt-1",
          },
          rawOpenHandsEvent: {
            kind: "MessageEvent",
            id: "evt-1",
          },
        },
      },
      {
        conversationId: "conv-123",
        origin: "backend",
        status: "observed",
        createdAtMs: 2_000,
        display: { kind: "tool_result" },
        payload: {
          openHandsEvent: {
            kind: "ObservationEvent",
            id: "evt-2",
            tool_call_id: "tool-1",
          },
          rawOpenHandsEvent: {
            kind: "ObservationEvent",
            id: "evt-2",
            tool_call_id: "tool-1",
          },
        },
      },
    ]);
  });

  it("restored history uses the same canonical envelope shape as live canonical events", () => {
    const timestamp = new Date(3_000).toISOString();
    const session: SkillSessionInfo = {
      conversation_id: "conv-123",
      skill_name: "sales-skill",
      created_at: new Date().toISOString(),
      available_agents: ["skill-creator"],
      restored_messages: [],
      restored_transcript_events: [
        {
          kind: "ObservationEvent",
          id: "evt-parity",
          timestamp,
          source: "environment",
          tool_name: "terminal",
          tool_call_id: "tool-1",
          action_id: "evt-action",
          observation: "Observed tool output",
        },
      ],
    };

    hydrateSelectedSkillOpenHandsSession(
      { name: "sales-skill", plugin_slug: "skills", skill_source: "skill-builder" },
      session,
    );

    const [restoredEnvelope] =
      useConversationStore.getState().eventsByConversation["conv-123"];

    expect(restoredEnvelope).toMatchObject({
      conversationId: "conv-123",
      origin: "backend",
      status: "observed",
      createdAtMs: 3_000,
      display: { kind: "tool_result" },
      payload: {
        openHandsEvent: {
          kind: "ObservationEvent",
          id: "evt-parity",
          tool_call_id: "tool-1",
        },
      },
    });
  });

  it("skips unrecognized restored events instead of aborting hydration", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const session: SkillSessionInfo = {
      conversation_id: "conv-123",
      skill_name: "sales-skill",
      created_at: new Date().toISOString(),
      available_agents: ["skill-creator"],
      restored_messages: [],
      restored_transcript_events: [
        {
          kind: "MysteryEvent",
          id: "evt-bad",
          timestamp: new Date(500).toISOString(),
          source: "system",
        },
        {
          kind: "MessageEvent",
          id: "evt-good",
          timestamp: new Date(1_000).toISOString(),
          source: "agent",
          llm_message: {
            role: "assistant",
            content: [{ type: "text", text: "Restored answer" }],
          },
        },
      ] as SkillSessionInfo["restored_transcript_events"],
    };

    hydrateSelectedSkillOpenHandsSession(
      { name: "sales-skill", plugin_slug: "skills", skill_source: "skill-builder" },
      session,
    );

    expect(warnSpy).toHaveBeenCalledWith(
      "[skill-openhands-session] Skipping unrecognized restored OpenHands event",
      expect.objectContaining({ kind: "MysteryEvent", id: "evt-bad" }),
    );
    const [restoredEvent] =
      useConversationStore.getState().eventsByConversation["conv-123"];
    expect(restoredEvent).toMatchObject({
      payload: {
        openHandsEvent: expect.objectContaining({
          kind: "MessageEvent",
          id: "evt-good",
        }),
      },
    });
  });

  it("restart hydrates the selected skill session metadata", async () => {
    const session: SkillSessionInfo = {
      conversation_id: "conv-789",
      skill_name: "sales-skill",
      created_at: new Date().toISOString(),
      available_agents: ["skill-creator"],
      restored_messages: [],
      restored_transcript_events: [],
    };
    mockSelectSkillOpenHandsSession.mockResolvedValue(session);

    await restartSkillOpenHandsSession(
      { id: 42, name: "sales-skill", plugin_slug: "skills", skill_source: "skill-builder" },
    );

    expect(mockSelectSkillOpenHandsSession).toHaveBeenCalledWith(
      42,
    );

    const sessionState = useSkillStore.getState();
    expect(sessionState.selectedSkill?.name).toBe("sales-skill");
    expect(sessionState.conversationId).toBe("conv-789");
    expect(sessionState.availableAgents).toEqual(["skill-creator"]);
  });
});

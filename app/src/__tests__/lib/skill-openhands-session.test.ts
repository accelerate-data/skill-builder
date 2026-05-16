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
          event_class: "MessageEvent",
          event: {
            source: "agent",
            message: "Restored answer",
          },
          timestamp: 1_000,
        },
        {
          event_class: "ObservationEvent",
          event: {
            observation: "Observed tool output",
          },
          timestamp: 2_000,
          tool_call_id: "tool-1",
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
          rawOpenHandsEvent: {
            type: "conversation_event",
            runtime: "openhands",
            conversationId: "conv-123",
            eventClass: "MessageEvent",
            event: {
              source: "agent",
              message: "Restored answer",
            },
            timestamp: 1_000,
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
          rawOpenHandsEvent: {
            type: "conversation_event",
            runtime: "openhands",
            conversationId: "conv-123",
            eventClass: "ObservationEvent",
            event: {
              observation: "Observed tool output",
            },
            timestamp: 2_000,
            toolCallId: "tool-1",
          },
        },
      },
    ]);
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

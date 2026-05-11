import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hydrateSelectedSkillOpenHandsSession,
  restartSkillOpenHandsSession,
} from "@/lib/skill-openhands-session";
import { useAgentStore, resetAgentStoreInternals } from "@/stores/agent-store";
import { useRefineStore } from "@/stores/refine-store";
import type { RefineSessionInfo } from "@/lib/types";

const mockSelectSkillOpenHandsSession = vi.fn();

vi.mock("@/lib/tauri", () => ({
  selectSkillOpenHandsSession: (...args: unknown[]) =>
    mockSelectSkillOpenHandsSession(...args),
}));

describe("skill-openhands-session", () => {
  beforeEach(() => {
    useRefineStore.getState().clearSession();
    useAgentStore.getState().clearRuns();
    resetAgentStoreInternals();
    mockSelectSkillOpenHandsSession.mockReset();
  });

  it("hydrates restored transcript events into refine messages and a completed restored run", () => {
    const session: RefineSessionInfo = {
      conversation_id: "conv-123",
      skill_name: "sales-skill",
      created_at: new Date().toISOString(),
      available_agents: ["skill-creator"],
      restored_messages: [
        { role: "user", content: "Tighten the summary" },
        { role: "agent", content: "Updated the summary." },
      ],
      restored_transcript_events: [
        {
          event_class: "SystemPromptEvent",
          event: { event_class: "SystemPromptEvent", message: "system prompt" },
          timestamp: 1,
          tool_call_id: null,
          parent_tool_call_id: null,
        },
        {
          event_class: "MessageEvent",
          event: {
            event_class: "MessageEvent",
            source: "user",
            message: "Tighten the summary",
          },
          timestamp: 2,
          tool_call_id: null,
          parent_tool_call_id: null,
        },
        {
          event_class: "ActionEvent",
          event: {
            event_class: "ActionEvent",
            action: {
              tool: "terminal",
              tool_call_id: "tool-1",
              arguments: { command: "npm test" },
            },
          },
          timestamp: 3,
          tool_call_id: "tool-1",
          parent_tool_call_id: null,
        },
        {
          event_class: "ObservationEvent",
          event: {
            event_class: "ObservationEvent",
            observation: {
              tool_call_id: "tool-1",
              content: "Tests passed",
            },
          },
          timestamp: 4,
          tool_call_id: "tool-1",
          parent_tool_call_id: null,
        },
        {
          event_class: "MessageEvent",
          event: {
            event_class: "MessageEvent",
            source: "agent",
            message: "Updated the summary.",
          },
          timestamp: 5,
          tool_call_id: null,
          parent_tool_call_id: null,
        },
      ],
    };

    hydrateSelectedSkillOpenHandsSession(
      { name: "sales-skill", plugin_slug: "skills", skill_source: "skill-builder" },
      session,
    );

    const refine = useRefineStore.getState();
    expect(refine.conversationId).toBe("conv-123");
    expect(refine.messages).toHaveLength(2);
    expect(refine.messages[0]?.role).toBe("user");
    expect(refine.messages[0]?.userText).toBe("Tighten the summary");
    expect(refine.messages[1]?.role).toBe("agent");
    expect(refine.messages[1]?.hideTaskSent).toBe(false);

    const runs = useAgentStore.getState().runs;
    const restoredRun = Object.values(runs)[0];
    expect(restoredRun?.status).toBe("completed");
    expect(restoredRun?.conversationEvents).toHaveLength(5);
    expect(restoredRun?.displayItems.length).toBeGreaterThan(0);
  });

  it("falls back to restored messages when transcript events are unavailable", () => {
    hydrateSelectedSkillOpenHandsSession(
      { name: "sales-skill", plugin_slug: "skills", skill_source: "skill-builder" },
      {
        conversation_id: "conv-456",
        skill_name: "sales-skill",
        created_at: new Date().toISOString(),
        available_agents: ["skill-creator"],
        restored_messages: [
          { role: "user", content: "Tighten the summary" },
          { role: "agent", content: "Updated the summary." },
        ],
        restored_transcript_events: [],
      },
    );

    const refine = useRefineStore.getState();
    expect(refine.messages).toHaveLength(2);
    expect(refine.messages[1]?.agentText).toBe("Updated the summary.");
  });

  it("restart hydrates the selected skill session without injecting an extra bootstrap turn", async () => {
    const session: RefineSessionInfo = {
      conversation_id: "conv-789",
      skill_name: "sales-skill",
      created_at: new Date().toISOString(),
      available_agents: ["skill-creator"],
      restored_messages: [
        { role: "user", content: "Tighten the summary" },
        { role: "agent", content: "Updated the summary." },
      ],
      restored_transcript_events: [
        {
          event_class: "MessageEvent",
          event: {
            event_class: "MessageEvent",
            source: "user",
            message: "Tighten the summary",
          },
          timestamp: 2,
          tool_call_id: null,
          parent_tool_call_id: null,
        },
        {
          event_class: "MessageEvent",
          event: {
            event_class: "MessageEvent",
            source: "agent",
            message: "Updated the summary.",
          },
          timestamp: 5,
          tool_call_id: null,
          parent_tool_call_id: null,
        },
      ],
    };
    mockSelectSkillOpenHandsSession.mockResolvedValue(session);

    await restartSkillOpenHandsSession(
      { id: 42, name: "sales-skill", plugin_slug: "skills", skill_source: "skill-builder" },
      "/tmp/workspace",
    );

    expect(mockSelectSkillOpenHandsSession).toHaveBeenCalledWith(
      42,
      "/tmp/workspace",
    );

    const refine = useRefineStore.getState();
    expect(refine.conversationId).toBe("conv-789");
    expect(refine.messages).toHaveLength(2);
    expect(refine.messages.map((message) => message.role)).toEqual(["user", "agent"]);
    expect(refine.messages[0]?.userText).toBe("Tighten the summary");
    expect(refine.messages[1]?.hideTaskSent).toBe(false);

    const runs = Object.values(useAgentStore.getState().runs);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("completed");
  });
});

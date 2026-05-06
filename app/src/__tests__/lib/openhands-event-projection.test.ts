import { describe, expect, it } from "vitest";
import {
  projectConversationEvent,
  type PendingActions,
} from "@/lib/openhands-event-projection";
import type { OpenHandsConversationEvent } from "@/lib/openhands-conversation-events";

function makeEvent(
  eventClass: string,
  body: Record<string, unknown>,
  timestamp = 1_000,
): OpenHandsConversationEvent {
  return {
    type: "conversation_event",
    runtime: "openhands",
    conversationId: "conv-test",
    agentId: "agent-test",
    eventClass,
    event: body,
    timestamp,
  };
}

describe("projectConversationEvent", () => {
  it("projects a user MessageEvent into a task_sent collapsed item", () => {
    const event = makeEvent("MessageEvent", {
      source: "user",
      message: "Please summarize the doc.",
    });

    const result = projectConversationEvent(event, {});
    expect(result.add).toHaveLength(1);
    const item = result.add[0];
    expect(item.type).toBe("tool_call");
    expect(item.toolName).toBe("task_sent");
    expect(item.toolSummary).toBe("Task sent");
    expect(item.toolStatus).toBe("ok");
    expect(item.toolResult).toEqual({
      content: "Please summarize the doc.",
      isError: false,
    });
    expect(item.timestamp).toBe(event.timestamp);
    expect(result.update).toEqual([]);
    expect(result.pendingDelta).toEqual({});
  });

  it("projects an agent MessageEvent into an output item with markdown text", () => {
    const event = makeEvent("MessageEvent", {
      source: "agent",
      message: "## Done\n\nResult ready.",
    });

    const result = projectConversationEvent(event, {});
    expect(result.add).toHaveLength(1);
    const item = result.add[0];
    expect(item.type).toBe("output");
    expect(item.outputText).toBe("## Done\n\nResult ready.");
  });

  it("projects file_editor view into a Read file: pending tool_call", () => {
    const event = makeEvent("ActionEvent", {
      source: "agent",
      action: { command: "view", path: "/repo/foo.md" },
      tool_name: "file_editor",
      tool_call_id: "call-1",
    });

    const result = projectConversationEvent(event, {});
    expect(result.add).toHaveLength(1);
    const item = result.add[0];
    expect(item.toolName).toBe("file_editor");
    expect(item.toolSummary).toBe("Read file: foo.md");
    expect(item.toolStatus).toBe("pending");
    expect(item.toolUseId).toBe("call-1");
    expect(result.pendingDelta.set?.[0]?.key).toBe("call-1");
    expect(result.pendingDelta.set?.[0]?.value.displayItemId).toBe(item.id);
  });

  it("projects file_editor str_replace into Edit file:", () => {
    const event = makeEvent("ActionEvent", {
      source: "agent",
      action: { command: "str_replace", path: "src/foo.md" },
      tool_name: "file_editor",
      tool_call_id: "call-2",
    });

    const result = projectConversationEvent(event, {});
    expect(result.add[0].toolSummary).toBe("Edit file: foo.md");
  });

  it("uses event.summary for terminal when present, else first 60 chars of command", () => {
    const eventWithSummary = makeEvent("ActionEvent", {
      source: "agent",
      action: { command: "ls -la" },
      tool_name: "terminal",
      tool_call_id: "call-3",
      summary: "List files",
    });
    const summaryRes = projectConversationEvent(eventWithSummary, {});
    expect(summaryRes.add[0].toolSummary).toBe("List files");

    const eventWithoutSummary = makeEvent("ActionEvent", {
      source: "agent",
      action: { command: "echo hello" },
      tool_name: "terminal",
      tool_call_id: "call-4",
    });
    const noSummaryRes = projectConversationEvent(eventWithoutSummary, {});
    expect(noSummaryRes.add[0].toolSummary).toBe("Ran command: echo hello");
  });

  it("projects invoke_skill as a skill item", () => {
    const event = makeEvent("ActionEvent", {
      source: "agent",
      action: { name: "research" },
      tool_name: "invoke_skill",
      tool_call_id: "call-5",
      summary: "Researching pricing",
    });

    const result = projectConversationEvent(event, {});
    const item = result.add[0];
    expect(item.type).toBe("skill");
    expect(item.skillName).toBe("research");
    expect(item.toolSummary).toBe("Using skill: research");
    expect(item.subagentDescription).toBe("Researching pricing");
    expect(item.subagentStatus).toBe("running");
  });

  it("projects think into a pending thinking item with Reasoning step label", () => {
    const event = makeEvent("ActionEvent", {
      source: "agent",
      action: { thought: "Considering options for the next step." },
      tool_name: "think",
      tool_call_id: "call-6",
    });

    const result = projectConversationEvent(event, {});
    const item = result.add[0];
    expect(item.type).toBe("thinking");
    expect(item.toolSummary).toBe("Reasoning step");
    expect(item.thinkingText).toBe("Considering options for the next step.");
  });

  it("labels think actions starting with ## as Planning checkpoint", () => {
    const event = makeEvent("ActionEvent", {
      source: "agent",
      action: { thought: "## Plan\n\nStep 1: ..." },
      tool_name: "think",
      tool_call_id: "call-7",
    });
    const result = projectConversationEvent(event, {});
    expect(result.add[0].toolSummary).toBe("Planning checkpoint");
  });

  it("does not project FinishTool actions", () => {
    const event = makeEvent("ActionEvent", {
      source: "agent",
      action: {},
      tool_name: "FinishTool",
      tool_call_id: "call-finish",
    });
    const result = projectConversationEvent(event, {});
    expect(result.add).toEqual([]);
    expect(result.update).toEqual([]);
    expect(result.pendingDelta).toEqual({});
  });

  it("pairs ActionEvent with matching ObservationEvent and computes duration", () => {
    const action = makeEvent(
      "ActionEvent",
      {
        source: "agent",
        action: { command: "view", path: "foo.md" },
        tool_name: "file_editor",
        tool_call_id: "call-pair-1",
      },
      1_000,
    );
    const actionResult = projectConversationEvent(action, {});
    expect(actionResult.add).toHaveLength(1);
    const setEntry = actionResult.pendingDelta.set?.[0];
    expect(setEntry).toBeDefined();
    if (!setEntry) throw new Error("missing set entry");

    const pending: PendingActions = {
      [setEntry.key]: setEntry.value,
    };

    const observation = makeEvent(
      "ObservationEvent",
      {
        tool_call_id: "call-pair-1",
        observation: { content: "file contents..." },
        is_error: false,
      },
      1_500,
    );
    const obsResult = projectConversationEvent(observation, pending);
    expect(obsResult.add).toEqual([]);
    expect(obsResult.update).toHaveLength(1);
    const patch = obsResult.update[0];
    expect(patch.id).toBe(setEntry.value.displayItemId);
    expect(patch.patch.toolStatus).toBe("ok");
    expect(patch.patch.toolDurationMs).toBe(500);
    expect(patch.patch.toolResult).toEqual({
      content: "file contents...",
      isError: false,
    });
    expect(obsResult.pendingDelta.delete).toEqual(["call-pair-1"]);
  });

  it("marks toolStatus error when observation has is_error true", () => {
    const pending: PendingActions = {
      "call-err": {
        displayItemId: "item-err",
        toolCallId: "call-err",
        actionTimestampMs: 100,
      },
    };
    const event = makeEvent(
      "ObservationEvent",
      {
        tool_call_id: "call-err",
        observation: { content: "failed: missing file" },
        is_error: true,
      },
      200,
    );
    const result = projectConversationEvent(event, pending);
    expect(result.update[0].patch.toolStatus).toBe("error");
    expect(result.update[0].patch.toolResult?.isError).toBe(true);
  });

  it("marks toolStatus error for terminal observation with non-zero exit_code", () => {
    const pending: PendingActions = {
      "call-exit": {
        displayItemId: "item-exit",
        toolCallId: "call-exit",
        actionTimestampMs: 100,
      },
    };
    const event = makeEvent(
      "ObservationEvent",
      {
        tool_call_id: "call-exit",
        observation: { content: "stderr text", exit_code: 2 },
      },
      150,
    );
    const result = projectConversationEvent(event, pending);
    expect(result.update[0].patch.toolStatus).toBe("error");
    expect(result.update[0].patch.toolResult?.isError).toBe(true);
  });

  it("emits a standalone item for a dangling ObservationEvent", () => {
    const event = makeEvent("ObservationEvent", {
      tool_call_id: "no-such",
      tool_name: "terminal",
      observation: { content: "stray output" },
    });
    const result = projectConversationEvent(event, {});
    expect(result.add).toHaveLength(1);
    const item = result.add[0];
    expect(item.type).toBe("tool_call");
    expect(item.toolName).toBe("terminal");
    expect(item.toolSummary).toBe("Observation");
    expect(item.toolResult?.content).toBe("stray output");
    expect(result.update).toEqual([]);
  });

  it("projects SystemPromptEvent as a Runtime setup collapsed item", () => {
    const event = makeEvent("SystemPromptEvent", {
      system_prompt: { text: "You are a helpful agent." },
      dynamic_context: { text: "# Skill Creator Agent\n\nUse workspace files as the source of truth." },
    });
    const result = projectConversationEvent(event, {});
    const item = result.add[0];
    expect(item.toolName).toBe("system_prompt");
    expect(item.toolSummary).toBe("Runtime setup");
    expect(item.toolResult?.content).toBe(
      "You are a helpful agent.\n\n# Skill Creator Agent\n\nUse workspace files as the source of truth.",
    );
  });

  it("projects CondensationSummaryEvent as a Context condensed item", () => {
    const event = makeEvent("CondensationSummaryEvent", {
      summary: "Older turns summarized.",
    });
    const result = projectConversationEvent(event, {});
    const item = result.add[0];
    expect(item.toolName).toBe("condensation");
    expect(item.toolSummary).toBe("Context condensed");
    expect(item.toolResult?.content).toBe("Older turns summarized.");
  });

  it("hides ConversationStateUpdateEvent from the chat (audit-only)", () => {
    // Internal counter/state churn; lifecycle chip covers user-facing
    // transitions. Event still lands in run.conversationEvents in the store
    // layer (audit trail preserved); the projection emits no DisplayItem.
    const event = makeEvent("ConversationStateUpdateEvent", {
      key: "agent_status",
      value: "running",
    });
    const result = projectConversationEvent(event, {});
    expect(result.add).toEqual([]);
    expect(result.update).toEqual([]);
    expect(result.pendingDelta).toEqual({});
  });

  it("projects unknown event_class as Unknown OpenHands event", () => {
    const event = makeEvent("MysteryEvent", { foo: "bar" });
    const result = projectConversationEvent(event, {});
    expect(result.add[0].toolName).toBe("unknown_event");
    expect(result.add[0].toolSummary).toBe(
      "Unknown OpenHands event: MysteryEvent",
    );
  });

  it("projects AgentErrorEvent as an error DisplayItem", () => {
    const event = makeEvent("AgentErrorEvent", {
      error: "something went wrong",
    });
    const result = projectConversationEvent(event, {});
    expect(result.add[0].type).toBe("error");
    expect(result.add[0].errorMessage).toBe("something went wrong");
  });

  it("projects PauseEvent as a Paused by user collapsed item", () => {
    const event = makeEvent("PauseEvent", { reason: "user requested pause" });
    const result = projectConversationEvent(event, {});
    const item = result.add[0];
    expect(item.toolName).toBe("pause");
    expect(item.toolSummary).toBe("Paused by user");
    expect(item.toolResult?.content).toBe("user requested pause");
  });
});

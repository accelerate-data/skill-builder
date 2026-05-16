import { describe, expect, it } from "vitest";
import {
  buildCanonicalConversationEventEnvelope,
  getErrorText,
  getEventText,
  getInternalEventSummary,
  getLlmResponseId,
  getMessageText,
  getObservationText,
  getReasoningText,
  getToolCallId,
  getToolInput,
  getToolName,
  groupConversationActionEvents,
  normalizeConversationEventMessage,
  normalizeConversationStateMessage,
  stringifyEventPayload,
  type OpenHandsConversationEvent,
} from "@/lib/openhands-conversation-events";
import {
  openHandsActionEventRecord,
  openHandsAgentErrorEventRecord,
  openHandsCondensationStartEventRecord,
  openHandsCondensationSummaryEventRecord,
  openHandsConversationErrorEventRecord,
  openHandsConversationEventRecords,
  openHandsConversationStateUpdateEventRecord,
  openHandsMessageEventRecord,
  openHandsObservationEventRecord,
  openHandsParallelActionEventRecords,
  openHandsPauseEventRecord,
  openHandsRawPayloadEventRecord,
  openHandsSystemPromptEventRecord,
  openHandsUnknownEventRecord,
  openHandsUserRejectObservationRecord,
} from "../fixtures/openhands-conversation-events";

function normalized(
  record: Record<string, unknown>,
): OpenHandsConversationEvent {
  const event = normalizeConversationEventMessage(record);
  if (!event) throw new Error("fixture did not normalize");
  return event;
}

describe("OpenHands conversation event helpers", () => {
  it("normalizes all realistic fixture records", () => {
    const events = openHandsConversationEventRecords.map(normalized);

    expect(events.map((event) => event.eventClass)).toEqual([
      "MessageEvent",
      "ActionEvent",
      "ActionEvent",
      "ActionEvent",
      "ObservationEvent",
      "UserRejectObservation",
      "AgentErrorEvent",
      "ConversationErrorEvent",
      "SystemPromptEvent",
      "CondensationStartEvent",
      "CondensationSummaryEvent",
      "ConversationStateUpdateEvent",
      "PauseEvent",
      "CustomSdkEvent",
      "RawFallbackEvent",
    ]);
    expect(events[0]).toMatchObject({
      conversationId: "conv-fixture",
      agentId: "agent-fixture",
      timestamp: 1_778_000_001,
    });
    expect(events[1].toolCallId).toBe("call-single");
  });

  it("normalizes top-level and raw parent tool call ids", () => {
    const event = normalized({
      type: "conversation_event",
      runtime: "openhands",
      conversation_id: "conv-child",
      agent_id: "agent-child",
      event_class: "ActionEvent",
      parent_tool_call_id: "call-parent-1",
      timestamp: 1_778_000_090,
      event: {
        source: "agent",
        tool_call: {
          id: "call-child-1",
          type: "function",
          function: {
            name: "read_file",
            arguments: { path: "child.md" },
          },
        },
      },
    });

    expect(event.toolCallId).toBe("call-child-1");
    expect(event.parentToolCallId).toBe("call-parent-1");
  });

  it("preserves terminal result text", () => {
    const state = normalizeConversationStateMessage({
      type: "conversation_state",
      runtime: "openhands",
      conversation_id: "conv-result",
      agent_id: "agent-result",
      status: "completed",
      result_text: '```json\n{"verdict":"mixed"}\n```',
      timestamp: 1_778_000_100,
    });

    expect(state).toMatchObject({
      type: "conversation_state",
      runtime: "openhands",
      conversationId: "conv-result",
      agentId: "agent-result",
      status: "completed",
      resultText: '```json\n{"verdict":"mixed"}\n```',
      timestamp: 1_778_000_100,
    });
  });

  it("builds unique canonical event ids for repeated runtime events in the same millisecond", () => {
    const event = normalized({
      type: "conversation_event",
      runtime: "openhands",
      conversation_id: "conv-repeat",
      agent_id: "agent-repeat",
      event_class: "ActionEvent",
      timestamp: 1_778_000_200,
      event: {
        source: "agent",
        tool_call: {
          id: "call-repeat",
          type: "function",
          function: {
            name: "read_file",
            arguments: { path: "README.md" },
          },
        },
      },
    });

    const first = buildCanonicalConversationEventEnvelope(event);
    const second = buildCanonicalConversationEventEnvelope(event);

    expect(first.eventId).not.toBe(second.eventId);
    expect(first.eventId).toContain("conv-repeat");
    expect(second.eventId).toContain("conv-repeat");
  });

  it("rejects runtime events when no conversation identity can be resolved", () => {
    const event = normalized({
      type: "conversation_event",
      runtime: "openhands",
      event_class: "MessageEvent",
      timestamp: 1_778_000_201,
      event: {
        source: "agent",
        message: "missing identity",
      },
    });

    expect(() => buildCanonicalConversationEventEnvelope(event)).toThrow(
      /conversation identity/i,
    );
  });

  it("extracts nested message text from llm_message content blocks", () => {
    const event = normalized(openHandsMessageEventRecord);

    expect(getMessageText(event)).toBe(
      "I will inspect the current workflow files.",
    );
    expect(getEventText(event)).toBe(
      "I will inspect the current workflow files.",
    );
  });

  it("extracts nested action tool metadata, input, reasoning, and thinking", () => {
    const event = normalized(openHandsActionEventRecord);

    expect(getToolName(event)).toBe("read_file");
    expect(getToolCallId(event)).toBe("call-single");
    expect(getLlmResponseId(event)).toBe("resp-single");
    expect(getToolInput(event)).toEqual({
      path: "app/src/lib/openhands-conversation-events.ts",
    });
    expect(getReasoningText(event)).toBe(
      "Need the helper source before editing.\n\nUse a focused read before patching.",
    );
  });

  it("parses JSON tool arguments when the SDK emits arguments as a string", () => {
    const event = normalized(openHandsParallelActionEventRecords[0]);

    expect(getToolName(event)).toBe("list_files");
    expect(getToolInput(event)).toEqual({ path: "app/src/lib" });
  });

  it("extracts nested observation and rejected-observation text", () => {
    expect(
      getObservationText(normalized(openHandsObservationEventRecord)),
    ).toBe("Read 140 lines from the helper.");
    expect(
      getObservationText(normalized(openHandsUserRejectObservationRecord)),
    ).toBe("User rejected the proposed file edit.");
  });

  it("extracts nested agent and conversation error text", () => {
    expect(getErrorText(normalized(openHandsAgentErrorEventRecord))).toBe(
      "Tool execution failed.",
    );
    expect(
      getErrorText(normalized(openHandsConversationErrorEventRecord)),
    ).toBe("Conversation stopped after runtime error.");
  });

  it("summarizes common internal OpenHands events", () => {
    expect(
      getInternalEventSummary(normalized(openHandsSystemPromptEventRecord)),
    ).toBe("System prompt prepared.");
    expect(
      getInternalEventSummary(
        normalized(openHandsCondensationStartEventRecord),
      ),
    ).toBe("Conversation context condensed.");
    expect(
      getInternalEventSummary(
        normalized(openHandsCondensationSummaryEventRecord),
      ),
    ).toBe("The conversation was condensed after reading helper files.");
    expect(
      getInternalEventSummary(
        normalized(openHandsConversationStateUpdateEventRecord),
      ),
    ).toBe('State updated: {"phase":"running","iteration":2}');
    expect(getInternalEventSummary(normalized(openHandsPauseEventRecord))).toBe(
      "Paused: Waiting for user input.",
    );
    expect(
      getInternalEventSummary(normalized(openHandsUnknownEventRecord)),
    ).toBeUndefined();
  });

  it("groups only consecutive action events with the same non-empty llm_response_id", () => {
    const firstParallel = normalized(openHandsParallelActionEventRecords[0]);
    const secondParallel = normalized(openHandsParallelActionEventRecords[1]);
    const unrelatedAction = normalized({
      ...openHandsActionEventRecord,
      timestamp: 1_778_000_014,
      event: {
        ...openHandsActionEventRecord.event,
        llm_response_id: "resp-other",
      },
    });
    const message = normalized(openHandsMessageEventRecord);
    const events = [firstParallel, secondParallel, message, unrelatedAction];

    const grouped = groupConversationActionEvents(events);

    expect(grouped).toHaveLength(3);
    expect(grouped[0]).toMatchObject({
      type: "parallel_action_group",
      llmResponseId: "resp-parallel",
      reasoningText: "Fetch the source and tests in parallel.",
    });
    if (grouped[0].type === "parallel_action_group") {
      expect(grouped[0].events).toEqual([firstParallel, secondParallel]);
    }
    expect(grouped[1]).toEqual({ type: "event", event: message });
    expect(grouped[2]).toEqual({ type: "event", event: unrelatedAction });

    expect(events[0]).toBe(firstParallel);
    expect(firstParallel.event).toBe(
      openHandsParallelActionEventRecords[0].event,
    );
  });

  it("falls back to useful JSON for non-string payloads", () => {
    expect(stringifyEventPayload({ ok: true })).toBe('{\n  "ok": true\n}');
  });

  it("preserves non-object SDK event payload fallbacks", () => {
    const event = normalized(openHandsRawPayloadEventRecord);

    expect(event.event).toEqual({ raw: "SDK event string fallback." });
  });
});

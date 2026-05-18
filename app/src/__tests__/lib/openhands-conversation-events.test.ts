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
    const supportedRecords = openHandsConversationEventRecords.filter(
      (record) =>
        !["CustomSdkEvent", "RawFallbackEvent"].includes(
          (record.event_class as string | undefined) ?? "",
        ),
    );
    const events = supportedRecords.map(normalized);

    expect(events.map((event) => event.kind)).toEqual([
      "MessageEvent",
      "ActionEvent",
      "ActionEvent",
      "ActionEvent",
      "ObservationEvent",
      "UserRejectObservation",
      "AgentErrorEvent",
      "ConversationErrorEvent",
      "SystemPromptEvent",
      "CondensationRequest",
      "CondensationSummaryEvent",
      "ConversationStateUpdateEvent",
      "PauseEvent",
    ]);
    expect(events[0].timestamp).toBe(new Date(1_778_000_001).toISOString());
    expect(getToolCallId(events[1])).toBe("call-single");
  });

  it("normalizes top-level and raw parent tool call ids", () => {
    const event = normalized({
      type: "conversation_event",
      runtime: "openhands",
      conversation_id: "conv-child",
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

    expect(getToolCallId(event)).toBe("call-child-1");
    const envelope = buildCanonicalConversationEventEnvelope(event, "conv-child", {
      conversationId: "conv-child",
      parentToolCallId: "call-parent-1",
    });
    expect(envelope.payload.openHandsDiagnostics?.parentToolCallId).toBe("call-parent-1");
  });

  it("preserves terminal result text", () => {
    const state = normalizeConversationStateMessage({
      type: "conversation_state",
      runtime: "openhands",
      conversation_id: "conv-result",
      status: "completed",
      result_text: '```json\n{"verdict":"mixed"}\n```',
      timestamp: 1_778_000_100,
    });

    expect(state).toMatchObject({
      type: "conversation_state",
      runtime: "openhands",
      conversationId: "conv-result",
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

    const first = buildCanonicalConversationEventEnvelope(event, "conv-repeat", {
      conversationId: "conv-repeat",
    });
    const second = buildCanonicalConversationEventEnvelope(event, "conv-repeat", {
      conversationId: "conv-repeat",
    });

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

  it("uses ThinkEvent thought text as reasoning text", () => {
    const event = normalized({
      type: "conversation_event",
      runtime: "openhands",
      conversation_id: "conv-think",
      event_class: "ThinkEvent",
      timestamp: 1_778_000_300,
      event: {
        source: "agent",
        thought:
          "Let me synthesize the generation brief from the confirmed decisions and then create the skill package.",
      },
    });

    expect(getReasoningText(event)).toBe(
      "Let me synthesize the generation brief from the confirmed decisions and then create the skill package.",
    );
  });

  it("returns ThinkEvent thought text verbatim when present", () => {
    const event = normalized({
      type: "conversation_event",
      runtime: "openhands",
      conversation_id: "conv-think-fallback",
      event_class: "ThinkEvent",
      timestamp: 1_778_000_301,
      event: {
        source: "agent",
        thought: "Let me analyze the current clarification record and identify material gaps.",
      },
    });

    expect(getReasoningText(event)).toBe(
      "Let me analyze the current clarification record and identify material gaps.",
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
      normalizeConversationEventMessage(openHandsUnknownEventRecord),
    ).toBeNull();
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
  });

  it("falls back to useful JSON for non-string payloads", () => {
    expect(stringifyEventPayload({ ok: true })).toBe('{\n  "ok": true\n}');
  });

  it("preserves non-object SDK event payload fallbacks", () => {
    expect(normalizeConversationEventMessage(openHandsRawPayloadEventRecord)).toBeNull();
  });
});

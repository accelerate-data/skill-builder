import { describe, it, expect } from "vitest";
import { OpenHandsEventProcessor } from "../openhands-event-processor.js";
import type { RuntimeSink } from "../runtime/types.js";

function makeSink() {
  const messages: Record<string, unknown>[] = [];
  const sink: RuntimeSink = {
    emit(message) {
      messages.push(message);
    },
    emitDisplayItem(item) {
      messages.push({ type: "display_item", item });
    },
    emitAgentEvent(event, timestamp = Date.now()) {
      messages.push({ type: "agent_event", event, timestamp });
    },
    emitRefineQuestion(question) {
      messages.push({
        type: "refine_question",
        tool_use_id: question.tool_use_id,
        questions: question.questions,
        timestamp: question.timestamp,
      });
    },
    emitRaw(message) {
      messages.push(message);
    },
  };
  return { messages, sink };
}

function expectNoLegacyMessages(messages: Record<string, unknown>[]): void {
  expect(messages.some((message) => message.type === "openhands_event")).toBe(false);
  expect(messages.some((message) => message.type === "openhands_result")).toBe(false);
  expect(messages.some((message) => message.type === "display_item")).toBe(false);
  expect(
    messages.some(
      (message) =>
        message.type === "agent_event" &&
        (message.event as Record<string, unknown> | undefined)?.type ===
          "run_result",
    ),
  ).toBe(false);
  expect(
    messages.some(
      (message) => message.type === "system" && message.subtype === "sdk_stderr",
    ),
  ).toBe(false);
}

describe("OpenHandsEventProcessor", () => {
  it("forwards conversation_event records unchanged through the raw sink", () => {
    const processor = new OpenHandsEventProcessor();
    const { messages, sink } = makeSink();
    const record = {
      type: "conversation_event",
      runtime: "openhands",
      conversation_id: "scope-review-1",
      agent_id: "skill-creator",
      event_class: "MessageEvent",
      event: {
        source: "agent",
        message: "I found the scope constraints.",
      },
      timestamp: 1714550400000,
    };

    processor.processLine(JSON.stringify(record), sink);

    expect(messages).toEqual([record]);
    expect(processor.hasTerminalState()).toBe(false);
    expectNoLegacyMessages(messages);
  });

  it("forwards conversation_state records and tracks terminal states", () => {
    const processor = new OpenHandsEventProcessor();
    const { messages, sink } = makeSink();
    const running = {
      type: "conversation_state",
      runtime: "openhands",
      conversation_id: "scope-review-1",
      agent_id: "skill-creator",
      status: "running",
      error_detail: null,
      timestamp: 1714550401000,
    };
    const completed = {
      ...running,
      status: "completed",
      timestamp: 1714550402000,
    };

    processor.processLine(JSON.stringify(running), sink);
    expect(processor.hasTerminalState()).toBe(false);
    processor.processLine(JSON.stringify(completed), sink);

    expect(messages).toEqual([running, completed]);
    expect(processor.hasTerminalState()).toBe(true);
    expectNoLegacyMessages(messages);
  });

  it("drops legacy OpenHands records instead of converting them to app envelopes", () => {
    const processor = new OpenHandsEventProcessor();
    const { messages, sink } = makeSink();

    processor.processLine(
      JSON.stringify({
        type: "openhands_event",
        event_kind: "message",
        text: "legacy progress",
      }),
      sink,
    );
    processor.processLine(
      JSON.stringify({
        type: "openhands_result",
        status: "success",
        result_text: "legacy result",
      }),
      sink,
    );

    expect(messages).toEqual([]);
    expect(processor.hasTerminalState()).toBe(false);
    expectNoLegacyMessages(messages);
  });

  it("ignores empty, unparseable, and unrelated records", () => {
    const processor = new OpenHandsEventProcessor();
    const { messages, sink } = makeSink();

    processor.processLine("", sink);
    processor.processLine("not json", sink);
    processor.processLine(JSON.stringify({ type: "system", subtype: "debug" }), sink);

    expect(messages).toEqual([]);
    expectNoLegacyMessages(messages);
  });

  it("builds a native error conversation_state for sidecar process failures", () => {
    const processor = new OpenHandsEventProcessor();

    expect(processor.buildErrorState("spawn failed")).toMatchObject({
      type: "conversation_state",
      runtime: "openhands",
      status: "error",
      error_detail: "spawn failed",
    });
  });
});

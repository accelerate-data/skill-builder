import { describe, expect, it } from "vitest";
import { createRecordRuntimeSink } from "../runtime/sink.js";
import type { DisplayItem } from "../display-types.js";

describe("createRecordRuntimeSink", () => {
  it("emits display items in the existing sidecar envelope", () => {
    const messages: Record<string, unknown>[] = [];
    const sink = createRecordRuntimeSink((message) => messages.push(message));

    const item: DisplayItem = {
      id: "di-1",
      type: "output",
      outputText: "hello",
      timestamp: 123,
    };

    sink.emitDisplayItem(item);

    expect(messages).toEqual([{ type: "display_item", item }]);
  });

  it("emits agent events in the existing sidecar envelope", () => {
    const messages: Record<string, unknown>[] = [];
    const sink = createRecordRuntimeSink((message) => messages.push(message));

    sink.emitAgentEvent({ type: "turn_complete", turn: 1, streaming: false }, 456);

    expect(messages).toEqual([
      {
        type: "agent_event",
        event: { type: "turn_complete", turn: 1, streaming: false },
        timestamp: 456,
      },
    ]);
  });

  it("emits refine questions in the existing sidecar envelope", () => {
    const messages: Record<string, unknown>[] = [];
    const sink = createRecordRuntimeSink((message) => messages.push(message));

    sink.emitRefineQuestion({
      tool_use_id: "toolu-1",
      questions: [{ id: "q1", question: "Pick one" }],
      timestamp: 789,
    });

    expect(messages).toEqual([
      {
        type: "refine_question",
        tool_use_id: "toolu-1",
        questions: [{ id: "q1", question: "Pick one" }],
        timestamp: 789,
      },
    ]);
  });

  it("passes raw messages through unchanged", () => {
    const messages: Record<string, unknown>[] = [];
    const sink = createRecordRuntimeSink((message) => messages.push(message));

    sink.emitRaw({ type: "system", subtype: "init_start" });

    expect(messages).toEqual([{ type: "system", subtype: "init_start" }]);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenHandsEventProcessor } from "../openhands-event-processor.js";
import type { RuntimeSink } from "../runtime/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    skillName: "test-skill",
    stepId: 1,
    pluginSlug: "test-plugin",
    workspaceSkillDir: "/tmp/test",
    ...overrides,
  };
}

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

function getDisplayItems(messages: Record<string, unknown>[]) {
  return messages
    .filter((m) => m.type === "display_item")
    .map((m) => m.item as Record<string, unknown>);
}

function getRunResult(messages: Record<string, unknown>[]) {
  return messages.find(
    (m) =>
      m.type === "agent_event" &&
      (m.event as Record<string, unknown>)?.type === "run_result",
  );
}

// ---------------------------------------------------------------------------
// Happy path fixture tests
// ---------------------------------------------------------------------------

describe("OpenHandsEventProcessor — happy path fixture", () => {
  it("processes all lines from openhands-events.jsonl fixture", () => {
    const fixturePath = path.join(__dirname, "fixtures/openhands-events.jsonl");
    const lines = fs.readFileSync(fixturePath, "utf-8").split("\n").filter(Boolean);

    const processor = new OpenHandsEventProcessor(makeContext());
    const { messages, sink } = makeSink();

    for (const line of lines) {
      processor.processLine(line, sink);
    }

    const displayItems = getDisplayItems(messages);
    const runResult = getRunResult(messages);

    // Should have output display item from message event
    const outputItem = displayItems.find((i) => i.type === "output");
    expect(outputItem).toBeDefined();
    expect(outputItem!.outputText).toContain("Starting OpenHands agent");

    // Should have tool_call display item
    const toolItem = displayItems.find((i) => i.type === "tool_call");
    expect(toolItem).toBeDefined();
    expect(toolItem!.toolName).toBe("BashTool");
    expect(toolItem!.toolStatus).toBe("ok");
    expect(toolItem!.toolSummary).toContain("Executing");

    // Should have result display item
    const resultItem = displayItems.find((i) => i.type === "result");
    expect(resultItem).toBeDefined();
    expect(resultItem!.resultStatus).toBe("success");

    // Should have emitted a run_result agent event with status completed
    expect(runResult).toBeDefined();
    const event = runResult!.event as Record<string, unknown>;
    expect(event.type).toBe("run_result");
    expect(event.status).toBe("completed");

    // Processor should report result emitted
    expect(processor.hasEmittedResult()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// outputFormat: true — structured output extraction
// ---------------------------------------------------------------------------

describe("OpenHandsEventProcessor — hasOutputFormat: true", () => {
  it("extracts JSON from result_text and populates structuredOutput", () => {
    const processor = new OpenHandsEventProcessor(
      makeContext({ hasOutputFormat: true }),
    );
    const { messages, sink } = makeSink();

    const resultLine = JSON.stringify({
      type: "openhands_result",
      status: "success",
      result_text: 'Here is the result:\n\n```json\n{"answer": 42, "ok": true}\n```',
      structured_output: null,
      timestamp: Date.now(),
    });

    processor.processLine(resultLine, sink);

    expect(processor.hasEmittedResult()).toBe(true);

    const displayItems = getDisplayItems(messages);
    const resultItem = displayItems.find((i) => i.type === "result");
    expect(resultItem).toBeDefined();
    expect(resultItem!.structuredOutput).toEqual({ answer: 42, ok: true });
    expect(resultItem!.resultStatus).toBe("success");

    const runResult = getRunResult(messages);
    expect(runResult).toBeDefined();
    const event = runResult!.event as Record<string, unknown>;
    expect(event.status).toBe("completed");
    // resultText should be the JSON-stringified structured output
    expect(event.resultText).toBe('{"answer":42,"ok":true}');
  });

  it("emits error run_result with structured_output_missing when no JSON found", () => {
    const processor = new OpenHandsEventProcessor(
      makeContext({ hasOutputFormat: true }),
    );
    const { messages, sink } = makeSink();

    const resultLine = JSON.stringify({
      type: "openhands_result",
      status: "success",
      result_text: "Done! No JSON here.",
      structured_output: null,
      timestamp: Date.now(),
    });

    processor.processLine(resultLine, sink);

    expect(processor.hasEmittedResult()).toBe(true);

    const runResult = getRunResult(messages);
    expect(runResult).toBeDefined();
    const event = runResult!.event as Record<string, unknown>;
    expect(event.status).toBe("error");
    expect(event.resultSubtype).toBe("structured_output_missing");
  });
});

// ---------------------------------------------------------------------------
// Error fixture
// ---------------------------------------------------------------------------

describe("OpenHandsEventProcessor — error fixture", () => {
  it("processes openhands-events-import-error.jsonl fixture", () => {
    const fixturePath = path.join(
      __dirname,
      "fixtures/openhands-events-import-error.jsonl",
    );
    const lines = fs.readFileSync(fixturePath, "utf-8").split("\n").filter(Boolean);

    const processor = new OpenHandsEventProcessor(makeContext());
    const { messages, sink } = makeSink();

    for (const line of lines) {
      processor.processLine(line, sink);
    }

    const runResult = getRunResult(messages);
    expect(runResult).toBeDefined();
    const event = runResult!.event as Record<string, unknown>;
    expect(event.status).toBe("error");
    expect(processor.hasEmittedResult()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("OpenHandsEventProcessor — edge cases", () => {
  it("ignores empty lines", () => {
    const processor = new OpenHandsEventProcessor(makeContext());
    const { messages, sink } = makeSink();

    processor.processLine("", sink);
    processor.processLine("  ", sink);

    expect(messages).toHaveLength(0);
  });

  it("forwards unparseable lines as system raw messages", () => {
    const processor = new OpenHandsEventProcessor(makeContext());
    const { messages, sink } = makeSink();

    processor.processLine("this is not json", sink);

    const rawMsg = messages.find((m) => m.type === "system" && m.subtype === "openhands_raw");
    expect(rawMsg).toBeDefined();
  });

  it("forwards unknown event_kinds as system raw messages", () => {
    const processor = new OpenHandsEventProcessor(makeContext());
    const { messages, sink } = makeSink();

    const unknownEvent = JSON.stringify({
      type: "openhands_event",
      event_kind: "observation",
      data: "some data",
      timestamp: Date.now(),
    });

    processor.processLine(unknownEvent, sink);

    const rawMsg = messages.find(
      (m) => m.type === "system" && m.subtype === "openhands_event_raw",
    );
    expect(rawMsg).toBeDefined();
    expect(rawMsg!.event_kind).toBe("observation");
  });

  it("buildErrorResult returns a run_result with error status", () => {
    const processor = new OpenHandsEventProcessor(makeContext());
    const result = processor.buildErrorResult("something went wrong");

    expect(result.type).toBe("run_result");
    expect(result.status).toBe("error");
    expect(result.resultSubtype).toBe("error_during_execution");
    expect(result.resultErrors).toContain("something went wrong");
  });

  it("hasEmittedResult returns false before any result is processed", () => {
    const processor = new OpenHandsEventProcessor(makeContext());
    expect(processor.hasEmittedResult()).toBe(false);
  });
});

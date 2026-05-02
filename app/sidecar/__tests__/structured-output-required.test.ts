/**
 * Tests for JSON-contract result extraction.
 *
 * When outputFormat is configured, it is an app-side signal that the final
 * result must contain JSON. MessageProcessor accepts native structured_output
 * from runtimes that provide it, but it also extracts JSON from final text for
 * runtimes such as OpenHands.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MessageProcessor } from "../message-processor.js";
import type { DisplayItem, DisplayItemEnvelope } from "../display-types.js";
import type { AgentEventEnvelope, RunResultEvent } from "../agent-events.js";

function extractDisplayItems(output: Record<string, unknown>[]): DisplayItem[] {
  return output
    .filter((o) => o.type === "display_item")
    .map((o) => (o as DisplayItemEnvelope).item);
}

function extractRunResult(output: Record<string, unknown>[]): RunResultEvent | undefined {
  return output
    .filter((o) => o.type === "agent_event")
    .map((o) => (o as AgentEventEnvelope).event)
    .find((event): event is RunResultEvent => event.type === "run_result");
}

describe("JSON-contract outputFormat path", () => {
  describe("with hasOutputFormat: true (requireStructuredOutput)", () => {
    let processor: MessageProcessor;

    beforeEach(() => {
      processor = new MessageProcessor({ hasOutputFormat: true, pluginSlug: "test" });
    });

    it("uses native structured_output when present", () => {
      const schema = { step_summary: "All steps complete", artifacts: ["a.ts", "b.ts"] };
      const raw = {
        type: "result",
        subtype: "success",
        structured_output: schema,
        result: "some text summary",
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const out = processor.process(raw);
      const items = extractDisplayItems(out);
      const result = items.find((i) => i.type === "result");

      expect(result?.resultStatus).toBe("success");
      expect(result?.structuredOutput).toEqual(schema);
    });

    it("recovers JSON when runtime omits structured_output but result text is JSON", () => {
      const schema = { step_summary: "Research complete", artifacts: ["plan.md"] };
      const raw = {
        type: "result",
        subtype: "success",
        // structured_output intentionally absent; OpenHands currently returns text.
        result: JSON.stringify(schema),
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const out = processor.process(raw);
      const items = extractDisplayItems(out);
      const result = items.find((i) => i.type === "result");

      expect(result?.resultStatus).toBe("success");
      expect(result?.errorSubtype).toBeUndefined();
      expect(result?.structuredOutput).toEqual(schema);
      expect(extractRunResult(out)?.status).toBe("completed");
      expect(JSON.parse(extractRunResult(out)?.resultText ?? "{}")).toEqual(schema);
    });

    it("recovers JSON when runtime returns structured_output: null but result text is JSON", () => {
      const schema = { step_summary: "Done", next_steps: ["deploy"] };
      const raw = {
        type: "result",
        subtype: "success",
        structured_output: null,
        result: JSON.stringify(schema),
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const out = processor.process(raw);
      const items = extractDisplayItems(out);
      const result = items.find((i) => i.type === "result");

      expect(result?.resultStatus).toBe("success");
      expect(result?.errorSubtype).toBeUndefined();
      expect(result?.structuredOutput).toEqual(schema);
    });

    it("recovers object result when runtime omits structured_output", () => {
      const raw = {
        type: "result",
        subtype: "success",
        result: { step_summary: "Done" },
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const out = processor.process(raw);
      const items = extractDisplayItems(out);
      const result = items.find((i) => i.type === "result");

      expect(result?.resultStatus).toBe("success");
      expect(result?.errorSubtype).toBeUndefined();
      expect(result?.structuredOutput).toEqual({ step_summary: "Done" });
    });

    it("recovers JSON from last assistant text when result text is not JSON", () => {
      const schema = { step_summary: "Done", nested: { level: 2, items: [1, 2, 3] } };

      processor.process({
        type: "assistant",
        message: {
          content: [{ type: "text", text: JSON.stringify(schema) }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      });

      const raw = {
        type: "result",
        subtype: "success",
        structured_output: null,
        result: "I have completed the research phase.",
        usage: { input_tokens: 200, output_tokens: 80 },
      };

      const out = processor.process(raw);
      const items = extractDisplayItems(out);
      const result = items.find((i) => i.type === "result");

      expect(result?.resultStatus).toBe("success");
      expect(result?.errorSubtype).toBeUndefined();
      expect(result?.structuredOutput).toEqual(schema);
    });

    it("recovers fenced JSON with leading narrative from last assistant text", () => {
      const schema = { step_summary: "Done", code_files: ["lib/a.ts", "lib/b.ts"] };
      const fencedJson = "Done. Here is the payload:\n\n```json\n" + JSON.stringify(schema) + "\n```";

      processor.process({
        type: "assistant",
        message: {
          content: [{ type: "text", text: fencedJson }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      });

      const raw = {
        type: "result",
        subtype: "success",
        structured_output: null,
        result: "Task complete.",
        usage: { input_tokens: 200, output_tokens: 80 },
      };

      const out = processor.process(raw);
      const items = extractDisplayItems(out);
      const result = items.find((i) => i.type === "result");

      expect(result?.resultStatus).toBe("success");
      expect(result?.errorSubtype).toBeUndefined();
      expect(result?.structuredOutput).toEqual(schema);
    });

    it("hard-fails with structured_output_missing when no JSON is recoverable", () => {
      // No native structured output, no JSON in result text, no prior assistant text.
      const raw = {
        type: "result",
        subtype: "success",
        structured_output: null,
        result: "I completed the task but forgot to output JSON.",
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const out = processor.process(raw);
      const items = extractDisplayItems(out);
      const result = items.find((i) => i.type === "result");

      expect(result?.resultStatus).toBe("error");
      expect(result?.errorSubtype).toBe("structured_output_missing");
    });

    it("hard-fails when structured_output is null and result is empty", () => {
      const raw = {
        type: "result",
        subtype: "success",
        structured_output: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const out = processor.process(raw);
      const items = extractDisplayItems(out);
      const result = items.find((i) => i.type === "result");

      expect(result?.resultStatus).toBe("error");
      expect(result?.errorSubtype).toBe("structured_output_missing");
    });
  });

  describe("without hasOutputFormat (default)", () => {
    let processor: MessageProcessor;

    beforeEach(() => {
      processor = new MessageProcessor();
    });

    it("succeeds even when structured_output is null and result has no JSON", () => {
      // Without hasOutputFormat, missing structured_output is not an error.
      const raw = {
        type: "result",
        subtype: "success",
        structured_output: null,
        result: "Task complete with no structured output.",
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const out = processor.process(raw);
      const items = extractDisplayItems(out);
      const result = items.find((i) => i.type === "result");

      expect(result?.resultStatus).toBe("success");
      expect(result?.structuredOutput).toBeUndefined();
    });
  });
});

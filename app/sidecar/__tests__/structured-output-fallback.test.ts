/**
 * Tests for VU-1015: SDK outputFormat returns success without structured_output
 * for nested schemas (anthropics/claude-agent-sdk-typescript#277).
 *
 * The SDK silently drops structured_output for non-trivial nested schemas.
 * MessageProcessor must fall back to parsing JSON from the result text field
 * or the last assistant text block, and hard-fail when hasOutputFormat is
 * configured but no JSON is recoverable.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MessageProcessor } from "../message-processor.js";
import type { DisplayItem, DisplayItemEnvelope } from "../display-types.js";

function extractDisplayItems(output: Record<string, unknown>[]): DisplayItem[] {
  return output
    .filter((o) => o.type === "display_item")
    .map((o) => (o as DisplayItemEnvelope).item);
}

describe("structured_output fallback (VU-1015)", () => {
  describe("with hasOutputFormat: true (requireStructuredOutput)", () => {
    let processor: MessageProcessor;

    beforeEach(() => {
      processor = new MessageProcessor({ hasOutputFormat: true, pluginSlug: "test" });
    });

    it("uses SDK structured_output when present (happy path)", () => {
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

    it("falls back to result text when SDK omits structured_output (SDK bug)", () => {
      // SDK bug: structured_output key is missing entirely even though
      // outputFormat was configured and subtype is success.
      const schema = { step_summary: "Research complete", artifacts: ["plan.md"] };
      const raw = {
        type: "result",
        subtype: "success",
        // structured_output intentionally absent — this is the SDK bug
        result: JSON.stringify(schema),
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const out = processor.process(raw);
      const items = extractDisplayItems(out);
      const result = items.find((i) => i.type === "result");

      expect(result?.resultStatus).toBe("success");
      expect(result?.structuredOutput).toEqual(schema);
    });

    it("falls back to result text when SDK returns structured_output: null (SDK bug)", () => {
      // SDK bug variant: structured_output key is present but null.
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
      expect(result?.structuredOutput).toEqual(schema);
    });

    it("falls back to last assistant text when result field has no JSON (SDK bug)", () => {
      // SDK returns a prose summary in result text (not JSON), but the agent
      // wrote its JSON output as an assistant text block earlier in the turn.
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
      expect(result?.structuredOutput).toEqual(schema);
    });

    it("falls back to last assistant text with ```json fence (SDK bug)", () => {
      const schema = { step_summary: "Done", code_files: ["lib/a.ts", "lib/b.ts"] };
      const fencedJson = "```json\n" + JSON.stringify(schema) + "\n```";

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
      expect(result?.structuredOutput).toEqual(schema);
    });

    it("hard-fails with structured_output_missing when no JSON is recoverable", () => {
      // No structured_output, no JSON in result text, no prior assistant text.
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

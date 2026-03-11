import { describe, it, expect, beforeEach } from "vitest";
import { MessageProcessor, extractResultMarkdown, tryParseJsonFromText } from "../message-processor.js";
import type { DisplayItem, DisplayItemEnvelope } from "../display-types.js";

/** Helper to extract DisplayItems from processed output. */
function extractDisplayItems(output: Record<string, unknown>[]): DisplayItem[] {
  return output
    .filter((o) => o.type === "display_item")
    .map((o) => (o as DisplayItemEnvelope).item);
}

/** Helper to extract pass-through messages (non-display_item). */
function extractPassThrough(output: Record<string, unknown>[]): Record<string, unknown>[] {
  return output.filter((o) => o.type !== "display_item");
}

describe("MessageProcessor", () => {
  let processor: MessageProcessor;

  beforeEach(() => {
    processor = new MessageProcessor();
  });

  // =========================================================================
  // Classification / filtering
  // =========================================================================

  describe("filtering", () => {
    it("emits config as metadata message (for thinkingEnabled/agentName)", () => {
      const raw = { type: "config", config: { model: "sonnet" } };
      const out = processor.process(raw);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: "metadata" });
      const data = (out[0] as Record<string, unknown>).data as Record<string, unknown>;
      expect(data).toHaveProperty("config");
    });

    it("filters sdk_stderr messages", () => {
      const out = processor.process({
        type: "system",
        subtype: "sdk_stderr",
        data: "debug info",
      });
      expect(out).toHaveLength(0);
    });

    it("filters turn_complete messages", () => {
      const out = processor.process({ type: "turn_complete" });
      expect(out).toHaveLength(0);
    });

    it("forwards system init messages as-is", () => {
      const raw = { type: "system", subtype: "init_start", timestamp: 123 };
      const out = processor.process(raw);
      expect(out).toHaveLength(1);
      expect(out[0]).toBe(raw);
    });

    it("forwards sdk_ready as-is", () => {
      const raw = { type: "system", subtype: "sdk_ready", timestamp: 456 };
      const out = processor.process(raw);
      expect(out).toHaveLength(1);
      expect(out[0]).toBe(raw);
    });
  });

  // =========================================================================
  // Assistant message decomposition
  // =========================================================================

  describe("assistant messages", () => {
    it("decomposes text block into output DisplayItem", () => {
      const raw = {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello, world!" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      };
      const out = processor.process(raw);
      const items = extractDisplayItems(out);

      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("output");
      expect(items[0].outputText).toBe("Hello, world!");
      expect(items[0].id).toBeDefined();
      expect(items[0].timestamp).toBeGreaterThan(0);
    });

    it("decomposes thinking block into thinking DisplayItem", () => {
      const raw = {
        type: "assistant",
        message: {
          content: [{ type: "thinking", thinking: "Let me analyze..." }],
        },
      };
      const out = processor.process(raw);
      const items = extractDisplayItems(out);

      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("thinking");
      expect(items[0].thinkingText).toBe("Let me analyze...");
    });

    it("decomposes tool_use block into tool_call DisplayItem with pending status", () => {
      const raw = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-abc",
              name: "Read",
              input: { file_path: "/src/foo.ts" },
            },
          ],
        },
      };
      const out = processor.process(raw);
      const items = extractDisplayItems(out);

      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("tool_call");
      expect(items[0].toolName).toBe("Read");
      expect(items[0].toolUseId).toBe("tu-abc");
      expect(items[0].toolStatus).toBe("pending");
      expect(items[0].toolSummary).toBe("Reading foo.ts");
      expect(items[0].toolInput).toEqual({ file_path: "/src/foo.ts" });
    });

    it("decomposes multiple content blocks into separate DisplayItems", () => {
      const raw = {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "First think..." },
            { type: "text", text: "Here is my analysis." },
            {
              type: "tool_use",
              id: "tu-1",
              name: "Bash",
              input: { command: "ls -la" },
            },
          ],
        },
      };
      const out = processor.process(raw);
      const items = extractDisplayItems(out);

      expect(items).toHaveLength(3);
      expect(items[0].type).toBe("thinking");
      expect(items[1].type).toBe("output");
      expect(items[2].type).toBe("tool_call");
    });

    it("preserves text alongside tool_use (no silent discard)", () => {
      const raw = {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me read that file." },
            {
              type: "tool_use",
              id: "tu-2",
              name: "Read",
              input: { file_path: "/foo.ts" },
            },
          ],
        },
      };
      const out = processor.process(raw);
      const items = extractDisplayItems(out);

      expect(items).toHaveLength(2);
      expect(items[0].type).toBe("output");
      expect(items[0].outputText).toBe("Let me read that file.");
      expect(items[1].type).toBe("tool_call");
    });

    it("emits metadata with contextSnapshot instead of raw assistant pass-through", () => {
      const raw = {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "hi" }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      };
      const out = processor.process(raw);
      const metadataMsgs = out.filter((o) => o.type === "metadata");

      expect(metadataMsgs).toHaveLength(1);
      const data = (metadataMsgs[0] as Record<string, unknown>).data as Record<string, unknown>;
      expect(data).toHaveProperty("contextSnapshot");
      const snapshot = data.contextSnapshot as Record<string, unknown>;
      expect(snapshot.inputTokens).toBe(100);
      expect(snapshot.outputTokens).toBe(50);
    });
  });

  // =========================================================================
  // Tool call → result linking
  // =========================================================================

  describe("tool call linking", () => {
    it("links tool_result to pending tool_call with ok status", () => {
      // Step 1: tool_use in assistant message
      processor.process({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-link-1",
              name: "Read",
              input: { file_path: "/test.ts" },
            },
          ],
        },
      });
      expect(processor.pendingToolCallCount).toBe(1);

      // Step 2: tool_result in user message
      const out = processor.process({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-link-1",
              content: "file contents here",
            },
          ],
        },
      });

      const items = extractDisplayItems(out);
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("tool_call");
      expect(items[0].toolUseId).toBe("tu-link-1");
      expect(items[0].toolStatus).toBe("ok");
      expect(items[0].toolResult).toEqual({
        content: "file contents here",
        isError: false,
      });
      expect(items[0].toolDurationMs).toBeGreaterThanOrEqual(0);
      expect(processor.pendingToolCallCount).toBe(0);
    });

    it("links tool_result with error status", () => {
      processor.process({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-err-1",
              name: "Bash",
              input: { command: "false" },
            },
          ],
        },
      });

      const out = processor.process({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-err-1",
              content: "exit code 1",
              is_error: true,
            },
          ],
        },
      });

      const items = extractDisplayItems(out);
      expect(items[0].toolStatus).toBe("error");
      expect(items[0].toolResult?.isError).toBe(true);
    });

    it("handles orphaned tool_result (no matching pending call)", () => {
      const out = processor.process({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-nonexistent",
              content: "orphan",
            },
          ],
        },
      });

      // No display items emitted for orphaned results
      const items = extractDisplayItems(out);
      expect(items).toHaveLength(0);
    });

    it("marks pending tool calls as orphaned on result message", () => {
      // Create a pending tool call
      processor.process({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-orphan-1",
              name: "Read",
              input: { file_path: "/x.ts" },
            },
          ],
        },
      });
      expect(processor.pendingToolCallCount).toBe(1);

      // Result arrives without tool_result for tu-orphan-1
      const out = processor.process({
        type: "result",
        subtype: "success",
        usage: { input_tokens: 100, output_tokens: 50 },
        total_cost_usd: 0.01,
      });

      const items = extractDisplayItems(out);
      // Should have: orphaned tool call update + result item
      const orphaned = items.filter((i) => i.toolStatus === "orphaned");
      const resultItems = items.filter((i) => i.type === "result");

      expect(orphaned).toHaveLength(1);
      expect(orphaned[0].toolUseId).toBe("tu-orphan-1");
      expect(resultItems).toHaveLength(1);
      expect(processor.pendingToolCallCount).toBe(0);
    });
  });

  // =========================================================================
  // Subagent grouping
  // =========================================================================

  describe("subagent grouping", () => {
    it("creates subagent DisplayItem for Task tool_use", () => {
      const raw = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-task-1",
              name: "Task",
              input: {
                description: "Research entities",
                subagent_type: "Explore",
                prompt: "Find all entity definitions",
              },
            },
          ],
        },
      };
      const out = processor.process(raw);
      const items = extractDisplayItems(out);

      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("subagent");
      expect(items[0].subagentDescription).toBe("Research entities");
      expect(items[0].subagentType).toBe("Explore");
      expect(items[0].subagentStatus).toBe("running");
      expect(items[0].toolUseId).toBe("tu-task-1");
      expect(processor.activeSubagentCount).toBe(1);
    });

    it('creates subagent DisplayItem for Agent tool_use (SDK "Agent" tool name)', () => {
      const raw = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-agent-1",
              name: "Agent",
              input: {
                description: "Quality checker for sales-analysis skill",
                subagent_type: "code-reviewer",
                prompt: "Review the skill output",
              },
            },
          ],
        },
      };
      const out = processor.process(raw);
      const items = extractDisplayItems(out);

      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("subagent");
      expect(items[0].subagentDescription).toBe("Quality checker for sales-analysis skill");
      expect(items[0].subagentType).toBe("code-reviewer");
      expect(items[0].subagentStatus).toBe("running");
      expect(items[0].toolUseId).toBe("tu-agent-1");
      expect(processor.activeSubagentCount).toBe(1);
    });

    it("groups child messages under parent subagent", () => {
      // Step 1: Create subagent
      processor.process({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-parent-1",
              name: "Task",
              input: { description: "Research" },
            },
          ],
        },
      });

      // Step 2: Child assistant message with parent_tool_use_id
      // Child items are nested inside the subagent update, not emitted top-level
      const childOut = processor.process({
        type: "assistant",
        parent_tool_use_id: "tu-parent-1",
        message: {
          content: [{ type: "text", text: "Found 3 entities." }],
        },
      });
      const childItems = extractDisplayItems(childOut);
      // Should emit an updated subagent with the child nested inside
      expect(childItems).toHaveLength(1);
      expect(childItems[0].type).toBe("subagent");
      expect(childItems[0].subagentItems).toHaveLength(1);
      expect(childItems[0].subagentItems![0].type).toBe("output");
      expect(childItems[0].subagentItems![0].parentToolUseId).toBe("tu-parent-1");

      // Step 3: Complete subagent via tool_result
      const completeOut = processor.process({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-parent-1",
              content: "Research complete",
            },
          ],
        },
      });
      const completeItems = extractDisplayItems(completeOut);

      // Should have: tool_call update + subagent update
      const subagentUpdates = completeItems.filter(
        (i) => i.type === "subagent",
      );
      expect(subagentUpdates).toHaveLength(1);
      expect(subagentUpdates[0].subagentStatus).toBe("complete");
      expect(subagentUpdates[0].subagentItems).toHaveLength(1);
      expect(subagentUpdates[0].subagentItems![0].type).toBe("output");
      expect(processor.activeSubagentCount).toBe(0);
    });

    it("handles subagent error", () => {
      processor.process({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-sub-err",
              name: "Task",
              input: { description: "Failing task" },
            },
          ],
        },
      });

      const out = processor.process({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-sub-err",
              content: "Task failed",
              is_error: true,
            },
          ],
        },
      });
      const items = extractDisplayItems(out);
      const subagent = items.find((i) => i.type === "subagent");
      expect(subagent?.subagentStatus).toBe("error");
    });
  });

  // =========================================================================
  // Result message dual-emit
  // =========================================================================

  describe("result messages", () => {
    it("dual-emits display_item and run_summary for success", () => {
      const raw = {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 5000, output_tokens: 2000 },
        total_cost_usd: 0.05,
        stop_reason: "end_turn",
        structured_output: { status: "done" },
      };
      const out = processor.process(raw);

      const items = extractDisplayItems(out);
      const runSummaryMsgs = out.filter((o) => o.type === "run_summary");

      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("result");
      expect(items[0].resultStatus).toBe("success");
      expect(items[0].outputText_result).toBe("Agent completed");

      expect(runSummaryMsgs).toHaveLength(1);
      const data = (runSummaryMsgs[0] as Record<string, unknown>).data as Record<string, unknown>;
      expect(data).toHaveProperty("resultSubtype", "success");
      expect(data).toHaveProperty("stopReason", "end_turn");
    });

    it("handles error result with error_max_turns", () => {
      const raw = {
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        usage: { input_tokens: 100 },
      };
      const out = processor.process(raw);
      const items = extractDisplayItems(out);

      expect(items[0].resultStatus).toBe("error");
      expect(items[0].errorSubtype).toBe("error_max_turns");
      expect(items[0].outputText_result).toBe(
        "Agent reached the maximum number of turns allowed.",
      );
    });

    it("handles refusal result", () => {
      const raw = {
        type: "result",
        subtype: "success",
        stop_reason: "refusal",
        usage: {},
      };
      const out = processor.process(raw);
      const items = extractDisplayItems(out);

      expect(items[0].resultStatus).toBe("refusal");
    });

    it("emits run_summary instead of raw result pass-through", () => {
      const raw = {
        type: "result",
        subtype: "success",
        structured_output: { status: "complete", data: [1, 2, 3] },
        usage: { input_tokens: 10, output_tokens: 5 },
        total_cost_usd: 0.001,
      };
      const out = processor.process(raw);
      const runSummaryMsgs = out.filter((o) => o.type === "run_summary");

      expect(runSummaryMsgs).toHaveLength(1);
      const data = (runSummaryMsgs[0] as Record<string, unknown>).data as Record<string, unknown>;
      expect(data).toHaveProperty("resultSubtype", "success");
      expect(data).toHaveProperty("inputTokens", 10);
      expect(data).toHaveProperty("outputTokens", 5);
    });

    it("populates resultMarkdown when structured output has *_markdown fields", () => {
      const raw = {
        type: "result",
        subtype: "success",
        structured_output: {
          status: "validation_complete",
          validation_log_markdown: "# Validation Log\n\nAll checks passed.",
          test_results_markdown: "# Test Results\n\n3/3 passed.",
        },
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      const out = processor.process(raw);
      const items = extractDisplayItems(out);

      expect(items[0].resultMarkdown).toContain("# Validation Log");
      expect(items[0].resultMarkdown).toContain("# Test Results");
      expect(items[0].resultMarkdown).toContain("---");
    });

    it("does not set resultMarkdown when structured output has no *_markdown fields", () => {
      const raw = {
        type: "result",
        subtype: "success",
        structured_output: { status: "done", count: 3 },
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      const out = processor.process(raw);
      const items = extractDisplayItems(out);

      expect(items[0].resultMarkdown).toBeUndefined();
    });

    it("does not set resultMarkdown when there is no structured output", () => {
      const raw = {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      const out = processor.process(raw);
      const items = extractDisplayItems(out);

      expect(items[0].resultMarkdown).toBeUndefined();
    });
  });

  // =========================================================================
  // extractResultMarkdown helper
  // =========================================================================

  describe("extractResultMarkdown", () => {
    it("returns undefined for non-object inputs", () => {
      expect(extractResultMarkdown(null)).toBeUndefined();
      expect(extractResultMarkdown(undefined)).toBeUndefined();
      expect(extractResultMarkdown("string")).toBeUndefined();
      expect(extractResultMarkdown(42)).toBeUndefined();
    });

    it("returns undefined when no *_markdown fields exist", () => {
      expect(extractResultMarkdown({ status: "done", count: 3 })).toBeUndefined();
    });

    it("returns undefined when *_markdown fields are empty strings", () => {
      expect(extractResultMarkdown({ validation_log_markdown: "" })).toBeUndefined();
    });

    it("returns single markdown field content directly", () => {
      const result = extractResultMarkdown({ validation_log_markdown: "# Log\n\nOK" });
      expect(result).toBe("# Log\n\nOK");
    });

    it("joins multiple *_markdown fields with divider", () => {
      const result = extractResultMarkdown({
        validation_log_markdown: "# Log",
        test_results_markdown: "# Tests",
        status: "validation_complete",
      });
      expect(result).toBe("# Log\n\n---\n\n# Tests");
    });

    it("ignores non-string *_markdown fields", () => {
      const result = extractResultMarkdown({
        validation_log_markdown: "# Log",
        test_results_markdown: null,
      });
      expect(result).toBe("# Log");
    });
  });

  // =========================================================================
  // tryParseJsonFromText helper
  // =========================================================================

  describe("tryParseJsonFromText", () => {
    it("parses plain JSON string", () => {
      const result = tryParseJsonFromText('{"status":"ok","count":3}');
      expect(result).toEqual({ status: "ok", count: 3 });
    });

    it("strips ```json code fence before parsing", () => {
      const text = "```json\n{\"status\":\"validation_complete\",\"validation_log_markdown\":\"# Log\"}\n```";
      const result = tryParseJsonFromText(text) as Record<string, unknown>;
      expect(result.status).toBe("validation_complete");
      expect(result.validation_log_markdown).toBe("# Log");
    });

    it("strips plain ``` code fence before parsing", () => {
      const text = "```\n{\"key\":\"value\"}\n```";
      expect(tryParseJsonFromText(text)).toEqual({ key: "value" });
    });

    it("returns undefined for non-JSON text", () => {
      expect(tryParseJsonFromText("just some plain text")).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      expect(tryParseJsonFromText("")).toBeUndefined();
    });
  });

  // =========================================================================
  // resultMarkdown fallback from output text block
  // =========================================================================

  describe("resultMarkdown fallback from output text", () => {
    it("extracts resultMarkdown from last output text when structuredOutput is absent", () => {
      const jsonText = JSON.stringify({
        status: "validation_complete",
        validation_log_markdown: "# Validation Log\n\nAll good.",
        test_results_markdown: "# Tests\n\nAll pass.",
      });

      // Emit a text output block containing JSON
      processor.process({
        type: "assistant",
        message: {
          content: [{ type: "text", text: jsonText }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      });

      // Emit a result with no structured_output
      const out = processor.process({ type: "result", subtype: "success", stop_reason: "end_turn" });
      const items = extractDisplayItems(out);
      const resultItem = items.find((i) => i.type === "result");

      expect(resultItem?.resultMarkdown).toContain("# Validation Log");
      expect(resultItem?.resultMarkdown).toContain("# Tests");
      expect(resultItem?.structuredOutput).toMatchObject({ status: "validation_complete" });
    });

    it("extracts resultMarkdown from output text with ```json code fence", () => {
      const jsonText = "```json\n" + JSON.stringify({
        status: "validation_complete",
        validation_log_markdown: "# Log",
      }) + "\n```";

      processor.process({
        type: "assistant",
        message: {
          content: [{ type: "text", text: jsonText }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      });

      const out = processor.process({ type: "result", subtype: "success", stop_reason: "end_turn" });
      const items = extractDisplayItems(out);
      const resultItem = items.find((i) => i.type === "result");

      expect(resultItem?.resultMarkdown).toBe("# Log");
    });

    it("does not override structuredOutput when already present", () => {
      processor.process({
        type: "assistant",
        message: {
          content: [{ type: "text", text: '{"validation_log_markdown":"# From text"}' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      });

      const out = processor.process({
        type: "result",
        subtype: "success",
        stop_reason: "end_turn",
        structured_output: { validation_log_markdown: "# From structured" },
      });
      const items = extractDisplayItems(out);
      const resultItem = items.find((i) => i.type === "result");

      expect(resultItem?.resultMarkdown).toBe("# From structured");
    });
  });

  // =========================================================================
  // Error messages
  // =========================================================================

  describe("error messages", () => {
    it("creates error DisplayItem without forwarding raw", () => {
      const raw = { type: "error", error: "API rate limit exceeded" };
      const out = processor.process(raw);

      const items = extractDisplayItems(out);
      const passThrough = extractPassThrough(out);

      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("error");
      expect(items[0].errorMessage).toBe("API rate limit exceeded");

      expect(passThrough).toHaveLength(0);
    });

    it("handles error with message field instead of error field", () => {
      const raw = { type: "error", message: "Connection timeout" };
      const out = processor.process(raw);
      const items = extractDisplayItems(out);

      expect(items[0].errorMessage).toBe("Connection timeout");
    });
  });

  // =========================================================================
  // Compact boundary
  // =========================================================================

  describe("compact boundary", () => {
    it("emits compact_boundary DisplayItem and metadata compactionEvent", () => {
      const raw = {
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { pre_tokens: 50000 },
        timestamp: 12345,
      };
      const out = processor.process(raw);

      const items = extractDisplayItems(out);
      const metadataMsgs = out.filter((o) => o.type === "metadata");

      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("compact_boundary");

      expect(metadataMsgs).toHaveLength(1);
      const data = (metadataMsgs[0] as Record<string, unknown>).data as Record<string, unknown>;
      expect(data).toHaveProperty("compactionEvent");
      const event = data.compactionEvent as Record<string, unknown>;
      expect(event.preTokens).toBe(50000);
    });
  });

  // =========================================================================
  // Tool summary computation
  // =========================================================================

  describe("tool summaries", () => {
    const toolSummaryTests: [string, Record<string, unknown>, string][] = [
      ["Read", { file_path: "/src/components/app.tsx" }, "Reading app.tsx"],
      ["Write", { file_path: "/src/index.ts" }, "Writing index.ts"],
      ["Edit", { file_path: "/lib/utils.ts" }, "Editing utils.ts"],
      ["Bash", { command: "npm run test" }, "Running: npm run test"],
      ["Grep", { pattern: "TODO", path: "/src/lib" }, 'Grep: "TODO" in lib'],
      ["Glob", { pattern: "**/*.tsx" }, "Glob: **/*.tsx"],
      ["WebSearch", { query: "vitest mocking" }, 'Web search: "vitest mocking"'],
    ];

    it.each(toolSummaryTests)(
      "computes summary for %s tool",
      (toolName, input, expectedSummary) => {
        const out = processor.process({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: `tu-sum-${toolName}`, name: toolName, input },
            ],
          },
        });
        const items = extractDisplayItems(out);
        expect(items[0].toolSummary).toBe(expectedSummary);
      },
    );
  });

  // =========================================================================
  // State machine integrity
  // =========================================================================

  describe("state machine", () => {
    it("handles multiple tool calls in parallel", () => {
      // Two tool_use blocks in one message
      processor.process({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tu-p1", name: "Read", input: { file_path: "/a.ts" } },
            { type: "tool_use", id: "tu-p2", name: "Read", input: { file_path: "/b.ts" } },
          ],
        },
      });
      expect(processor.pendingToolCallCount).toBe(2);

      // Result for first
      processor.process({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tu-p1", content: "a contents" },
          ],
        },
      });
      expect(processor.pendingToolCallCount).toBe(1);

      // Result for second
      processor.process({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tu-p2", content: "b contents" },
          ],
        },
      });
      expect(processor.pendingToolCallCount).toBe(0);
    });

    it("handles result before all tool results arrive (orphaning)", () => {
      processor.process({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tu-late-1", name: "Read", input: { file_path: "/x.ts" } },
            { type: "tool_use", id: "tu-late-2", name: "Read", input: { file_path: "/y.ts" } },
          ],
        },
      });

      // Only resolve one
      processor.process({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tu-late-1", content: "x" },
          ],
        },
      });
      expect(processor.pendingToolCallCount).toBe(1);

      // Result arrives
      const out = processor.process({
        type: "result",
        subtype: "success",
        usage: {},
      });
      const items = extractDisplayItems(out);
      const orphaned = items.filter((i) => i.toolStatus === "orphaned");
      expect(orphaned).toHaveLength(1);
      expect(orphaned[0].toolUseId).toBe("tu-late-2");
      expect(processor.pendingToolCallCount).toBe(0);
    });

    // =========================================================================
    // Streaming terminal paths — failure vs shutdown distinction (VU-506)
    // =========================================================================

    it("buildExecutionErrorSummary produces status=error with error message", () => {
      const summary = processor.buildExecutionErrorSummary("connection reset");
      expect(summary.status).toBe("error");
      expect(summary.resultSubtype).toBe("error_during_execution");
      expect(summary.resultErrors).toEqual(["connection reset"]);
      expect(summary.stopReason).toBe("error");
    });

    it("buildShutdownSummary produces status=shutdown with zeroed tokens", () => {
      const summary = processor.buildShutdownSummary();
      expect(summary.status).toBe("shutdown");
      expect(summary.inputTokens).toBe(0);
      expect(summary.outputTokens).toBe(0);
      expect(summary.resultErrors).toBeUndefined();
    });

    it("buildExecutionErrorSummary and buildShutdownSummary are distinct", () => {
      const err = processor.buildExecutionErrorSummary("boom");
      const shutdown = processor.buildShutdownSummary();
      expect(err.status).not.toBe(shutdown.status);
      expect(err.resultSubtype).toBeDefined();
      expect(shutdown.resultSubtype).toBeUndefined();
    });

    it("buildExecutionErrorSummary carries accumulated turn count", () => {
      // Process one assistant turn to bump the turn counter
      processor.process({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "hello" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      });
      const summary = processor.buildExecutionErrorSummary("crash");
      expect(summary.numTurns).toBeGreaterThanOrEqual(1);
    });

    it("reset clears all state", () => {
      processor.process({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tu-reset", name: "Read", input: {} },
          ],
        },
      });
      expect(processor.pendingToolCallCount).toBe(1);

      processor.reset();
      expect(processor.pendingToolCallCount).toBe(0);
      expect(processor.activeSubagentCount).toBe(0);
    });
  });
});

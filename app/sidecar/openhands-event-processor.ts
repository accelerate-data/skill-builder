/**
 * OpenHands event processor.
 *
 * Maps raw JSONL lines from the Python runner's stdout into the existing
 * sidecar protocol (display_items + agent_event run_result), matching the
 * MessageProcessor contract for the Claude path.
 *
 * @module openhands-event-processor
 */

import { randomUUID } from "node:crypto";
import type { RunResultEvent } from "./agent-events.js";
import type { DisplayItem } from "./display-types.js";
import { extractJsonFromText } from "./lib/result-extraction.js";
import {
  RunMetadataAccumulator,
  type RequestContext,
} from "./run-metadata-accumulator.js";
import type { RuntimeSink } from "./runtime/types.js";

// ---------------------------------------------------------------------------
// Event shapes from the Python runner
// ---------------------------------------------------------------------------

interface OpenHandsEvent {
  type: "openhands_event";
  event_kind: string;
  text?: string;
  tool_name?: string;
  summary?: string;
  timestamp?: number;
}

interface OpenHandsResult {
  type: "openhands_result";
  status: "success" | "error";
  result_text: string | null;
  structured_output: unknown;
  error_message?: string | null;
  error_subtype?: string | null;
  timestamp?: number;
}

// ---------------------------------------------------------------------------
// OpenHandsEventProcessor
// ---------------------------------------------------------------------------

export class OpenHandsEventProcessor {
  private accumulator: RunMetadataAccumulator;
  private resultEmitted = false;
  private hasOutputFormat: boolean;

  constructor(context: RequestContext & { hasOutputFormat?: boolean }) {
    this.hasOutputFormat = context.hasOutputFormat ?? false;
    this.accumulator = new RunMetadataAccumulator(context);
  }

  hasEmittedResult(): boolean {
    return this.resultEmitted;
  }

  processLine(line: string, sink: RuntimeSink): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      process.stderr.write(
        `[openhands-processor] warn=unparseable_line line=${JSON.stringify(trimmed)}\n`,
      );
      sink.emitRaw({ type: "system", subtype: "openhands_raw", data: trimmed, timestamp: Date.now() });
      return;
    }

    const msgType = parsed.type as string | undefined;

    if (msgType === "openhands_event") {
      this.processEvent(parsed as unknown as OpenHandsEvent, sink);
    } else if (msgType === "openhands_result") {
      this.processResult(parsed as unknown as OpenHandsResult, sink);
    } else {
      // Forward unknown message types as system raw messages
      process.stderr.write(
        `[openhands-processor] event=unknown_message_type type=${msgType ?? "undefined"}\n`,
      );
      sink.emitRaw({ type: "system", subtype: "openhands_raw", data: parsed, timestamp: Date.now() });
    }
  }

  buildErrorResult(message: string): RunResultEvent {
    return this.accumulator.buildRunSummary({
      subtype: "error_during_execution",
      is_error: true,
      errors: [message],
      stop_reason: "error",
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      total_cost_usd: 0,
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private processEvent(event: OpenHandsEvent, sink: RuntimeSink): void {
    const timestamp = event.timestamp ?? Date.now();

    if (event.event_kind === "message") {
      const item: DisplayItem = {
        id: randomUUID(),
        type: "output",
        timestamp,
        outputText: event.text ?? "",
      };
      process.stderr.write(
        `[openhands-processor] event=display_item kind=output len=${item.outputText?.length ?? 0}\n`,
      );
      sink.emitDisplayItem(item);
    } else if (event.event_kind === "tool_call") {
      const item: DisplayItem = {
        id: randomUUID(),
        type: "tool_call",
        timestamp,
        toolName: event.tool_name ?? "unknown",
        toolStatus: "ok",
        toolSummary: event.summary,
      };
      process.stderr.write(
        `[openhands-processor] event=display_item kind=tool_call tool=${item.toolName}\n`,
      );
      sink.emitDisplayItem(item);
    } else {
      // Forward unrecognised event_kinds as system raw messages
      process.stderr.write(
        `[openhands-processor] event=unknown_event_kind kind=${event.event_kind}\n`,
      );
      sink.emitRaw({
        type: "system",
        subtype: "openhands_event_raw",
        event_kind: event.event_kind,
        data: event,
        timestamp,
      });
    }
  }

  private processResult(result: OpenHandsResult, sink: RuntimeSink): void {
    const timestamp = result.timestamp ?? Date.now();
    const status = result.status;
    const errorMessage = result.error_message ?? undefined;
    const errorSubtype = result.error_subtype ?? undefined;

    let resultText = result.result_text ?? "";
    let resultStatus: DisplayItem["resultStatus"] = status === "success" ? "success" : "error";
    let runResultSubtype: string =
      status === "success" ? "success" : (errorSubtype ?? "error_during_execution");
    let runResultErrors: string[] = errorMessage ? [errorMessage] : [];
    let structuredOutput: unknown = undefined;

    if (this.hasOutputFormat) {
      structuredOutput = extractJsonFromText(resultText);
      if (structuredOutput === undefined) {
        // No parseable JSON found — treat as structured_output_missing error
        resultStatus = "error";
        runResultSubtype = "structured_output_missing";
        runResultErrors = ["Structured output expected but no JSON found in result text"];
        process.stderr.write(
          "[openhands-processor] event=structured_output_missing status=error\n",
        );
      } else {
        resultText = JSON.stringify(structuredOutput);
        process.stderr.write(
          `[openhands-processor] event=structured_output_extracted len=${resultText.length}\n`,
        );
      }
    }

    // Emit the result display item
    const resultItem: DisplayItem = {
      id: randomUUID(),
      type: "result",
      timestamp,
      outputText_result: resultText,
      resultStatus,
      ...(structuredOutput !== undefined ? { structuredOutput } : {}),
      ...(runResultSubtype === "structured_output_missing"
        ? { errorSubtype: "structured_output_missing" }
        : errorSubtype
          ? { errorSubtype }
          : {}),
    };
    sink.emitDisplayItem(resultItem);

    // Build and emit the run_result agent event
    const raw = {
      subtype: runResultSubtype,
      is_error: status !== "success" || runResultSubtype === "structured_output_missing",
      errors: runResultErrors,
      stop_reason: status === "success" && runResultSubtype !== "structured_output_missing"
        ? "end_turn"
        : "error",
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      total_cost_usd: 0,
    };

    const runResult = this.accumulator.buildRunSummary(raw);
    // Attach the result text to the run_result event
    const finalRunResult: RunResultEvent = {
      ...runResult,
      resultText,
    };

    this.resultEmitted = true;
    process.stderr.write(
      `[openhands-processor] event=run_result status=${finalRunResult.status} subtype=${runResultSubtype}\n`,
    );
    sink.emitAgentEvent(finalRunResult);
  }
}

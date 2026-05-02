/**
 * OpenHands protocol forwarder.
 *
 * The Node sidecar is transport-only for OpenHands: runner stdout is expected
 * to contain app-framed conversation JSONL records, and those records are
 * forwarded unchanged for persistent-mode to add request_id.
 *
 * @module openhands-event-processor
 */

import type { RuntimeSink } from "./runtime/types.js";

const TERMINAL_STATUSES = new Set(["completed", "error", "cancelled"]);

type ConversationStatus =
  | "starting"
  | "running"
  | "completed"
  | "error"
  | "cancelled";

export class OpenHandsEventProcessor {
  private terminalStateSeen = false;

  hasTerminalState(): boolean {
    return this.terminalStateSeen;
  }

  processLine(line: string, sink: RuntimeSink): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      process.stderr.write(
        `[openhands-processor] warn=unparseable_stdout line=${JSON.stringify(trimmed)}\n`,
      );
      return;
    }

    if (parsed.type === "conversation_event") {
      sink.emitRaw(parsed);
      return;
    }

    if (parsed.type === "conversation_state") {
      if (
        typeof parsed.status === "string" &&
        TERMINAL_STATUSES.has(parsed.status)
      ) {
        this.terminalStateSeen = true;
      }
      sink.emitRaw(parsed);
      return;
    }

    process.stderr.write(
      `[openhands-processor] event=drop_stdout_record type=${String(parsed.type ?? "undefined")}\n`,
    );
  }

  buildErrorState(message: string): Record<string, unknown> {
    return this.buildState("error", message);
  }

  buildCancelledState(message: string): Record<string, unknown> {
    return this.buildState("cancelled", message);
  }

  private buildState(
    status: ConversationStatus,
    errorDetail: string | null,
  ): Record<string, unknown> {
    this.terminalStateSeen = TERMINAL_STATUSES.has(status);
    return {
      type: "conversation_state",
      runtime: "openhands",
      status,
      error_detail: errorDetail,
      timestamp: Date.now(),
    };
  }
}

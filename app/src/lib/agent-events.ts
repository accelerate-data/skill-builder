/**
 * Frontend agent event types — generated from Rust contracts.
 *
 * Run `cd app/src-tauri && cargo run --bin codegen` to regenerate.
 *
 * @module agent-events
 */

export type {
  ModelUsageEntry,
  RunConfigEvent,
  RunInitEvent,
  TurnUsageEvent,
  CompactionEvent,
  ContextWindowEvent,
  SessionExhaustedEvent,
  InitProgressEvent,
  TurnCompleteEvent,
  RunResultEvent,
  AgentEvent,
  AgentEventEnvelope,
} from "@/generated/contracts";

export const AGENT_EVENTS_VERSION = 3;

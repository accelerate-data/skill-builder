/**
 * Canonical AgentEvent service-boundary definitions — generated from Rust contracts.
 *
 * Run `cd app/src-tauri && cargo run --bin codegen` to regenerate.
 *
 * The individual event types add a `type` discriminator field on top of the
 * generated payload types so that sidecar code can construct typed event
 * objects directly (e.g. `{ type: "run_config", thinkingEnabled: true }`).
 *
 * @module agent-events
 */

import type {
  ModelUsageEntry as _ModelUsageEntry,
  RunConfigEvent as _RunConfigEvent,
  RunInitEvent as _RunInitEvent,
  TurnUsageEvent as _TurnUsageEvent,
  CompactionEvent as _CompactionEvent,
  ContextWindowEvent as _ContextWindowEvent,
  SessionExhaustedEvent as _SessionExhaustedEvent,
  InitProgressEvent as _InitProgressEvent,
  TurnCompleteEvent as _TurnCompleteEvent,
  RunResultEvent as _RunResultEvent,
  AgentEvent as _AgentEvent,
  AgentEventEnvelope as _AgentEventEnvelope,
} from "./generated/contracts.js";

// Re-export base types that don't need a discriminator
export type { _ModelUsageEntry as ModelUsageEntry };

// Individual event types with `type` discriminator added for construction
export type RunConfigEvent = _RunConfigEvent & { type: "run_config" };
export type RunInitEvent = _RunInitEvent & { type: "run_init" };
export type TurnUsageEvent = _TurnUsageEvent & { type: "turn_usage" };
export type CompactionEvent = _CompactionEvent & { type: "compaction" };
export type ContextWindowEvent = _ContextWindowEvent & { type: "context_window" };
export type SessionExhaustedEvent = _SessionExhaustedEvent & { type: "session_exhausted" };
export type InitProgressEvent = _InitProgressEvent & { type: "init_progress" };
export type TurnCompleteEvent = _TurnCompleteEvent & { type: "turn_complete" };
export type RunResultEvent = _RunResultEvent & { type: "run_result" };

export type AgentEvent =
  | RunConfigEvent
  | RunInitEvent
  | TurnUsageEvent
  | CompactionEvent
  | ContextWindowEvent
  | SessionExhaustedEvent
  | InitProgressEvent
  | TurnCompleteEvent
  | RunResultEvent;

export interface AgentEventEnvelope {
  type: "agent_event";
  event: AgentEvent;
  timestamp: number;
}

export const AGENT_EVENTS_VERSION = 3;

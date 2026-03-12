/**
 * Frontend mirror of sidecar AgentEvent types.
 *
 * READ-ONLY — the sidecar owns the canonical definition at
 * `app/sidecar/agent-events.ts`. This file must be kept in sync
 * via structural tests.
 *
 * @module agent-events
 */

export interface ModelUsageEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}

export interface RunConfigEvent {
  type: "run_config";
  thinkingEnabled: boolean;
  agentName?: string;
}

export interface RunInitEvent {
  type: "run_init";
  sessionId: string;
  model: string;
}

export interface TurnUsageEvent {
  type: "turn_usage";
  turn: number;
  inputTokens: number;
  outputTokens: number;
}

export interface CompactionEvent {
  type: "compaction";
  turn: number;
  preTokens: number;
  timestamp: number;
}

export interface ContextWindowEvent {
  type: "context_window";
  contextWindow: number;
}

export interface RunResultEvent {
  type: "run_result";
  skillName: string;
  stepId: number;
  workflowSessionId?: string;
  usageSessionId?: string;
  runSource?: "workflow" | "refine" | "test";
  sessionId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCostUsd: number;
  modelUsageBreakdown: ModelUsageEntry[];
  contextWindow: number;
  resultSubtype?: string;
  resultErrors?: string[];
  stopReason?: string;
  numTurns: number;
  durationMs: number;
  durationApiMs?: number;
  toolUseCount: number;
  compactionCount: number;
  status: "completed" | "error" | "shutdown";
}

export type AgentEvent =
  | RunConfigEvent
  | RunInitEvent
  | TurnUsageEvent
  | CompactionEvent
  | ContextWindowEvent
  | RunResultEvent;

export const AGENT_EVENTS_VERSION = 1;

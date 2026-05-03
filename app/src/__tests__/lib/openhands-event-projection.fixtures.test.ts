/**
 * Fixture-based integration tests for the OpenHands → DisplayItem projection.
 *
 * These tests load real JSONL transcripts captured from production OpenHands
 * runs and project them end-to-end through `projectConversationEvent` +
 * `summarizeCompletedRun`, asserting that the resulting DisplayItem stream
 * matches the expected shape.
 *
 * Fixtures live in `app/src/__tests__/fixtures/openhands-events/` and are
 * trimmed transcripts (one JSON envelope per line, plus a leading `config`
 * line that the loader skips).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import type { DisplayItem } from "@/lib/display-types";
import { groupDisplayItems } from "@/lib/group-display-items";
import {
  normalizeConversationEventMessage,
  normalizeConversationStateMessage,
  type OpenHandsConversationState,
} from "@/lib/openhands-conversation-events";
import {
  projectConversationEvent,
  type PendingActions,
} from "@/lib/openhands-event-projection";
import {
  summarizeCompletedRun,
  type ConversationStateForSummary,
} from "@/lib/openhands-result-summary";

interface ProjectAllResult {
  displayItems: DisplayItem[];
  pending: PendingActions;
  terminalState: OpenHandsConversationState | null;
}

function loadFixtureLines(name: string): Array<Record<string, unknown>> {
  const full = path.resolve(
    __dirname,
    "..",
    "fixtures",
    "openhands-events",
    name,
  );
  return fs
    .readFileSync(full, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function projectAll(
  fixtureLines: Array<Record<string, unknown>>,
): ProjectAllResult {
  const displayItems: DisplayItem[] = [];
  const pending: PendingActions = {};
  let terminalState: OpenHandsConversationState | null = null;

  for (const line of fixtureLines) {
    if (line.type === "config") continue;

    if (line.type === "conversation_state") {
      const state = normalizeConversationStateMessage(line);
      if (
        state &&
        (state.status === "completed" ||
          state.status === "error" ||
          state.status === "cancelled")
      ) {
        terminalState = state;
      }
      continue;
    }

    if (line.type !== "conversation_event") continue;

    const normalized = normalizeConversationEventMessage(line);
    if (!normalized) continue;

    const result = projectConversationEvent(normalized, pending);

    for (const newItem of result.add) {
      displayItems.push(newItem);
    }
    for (const upd of result.update) {
      const idx = displayItems.findIndex((di) => di.id === upd.id);
      if (idx >= 0) {
        displayItems[idx] = { ...displayItems[idx], ...upd.patch };
      }
    }
    if (result.pendingDelta.set) {
      for (const { key, value } of result.pendingDelta.set) {
        pending[key] = value;
      }
    }
    if (result.pendingDelta.delete) {
      for (const key of result.pendingDelta.delete) {
        delete pending[key];
      }
    }
  }

  return { displayItems, pending, terminalState };
}

/**
 * The terminal `conversation_state` envelopes captured in these fixtures store
 * structured output as a JSON string in `result_text` rather than as a parsed
 * object in `structured_output` (which is `null`). To exercise the tier-1 and
 * tier-2 detectors of `summarizeCompletedRun` we need to lift that JSON into a
 * real object before invoking the summarizer.
 */
function withStructuredOutputFromResultText(
  state: OpenHandsConversationState | null,
): ConversationStateForSummary {
  if (!state) {
    return { status: "completed" };
  }
  let structuredOutput: unknown = state.structuredOutput;
  if (
    structuredOutput == null &&
    typeof state.resultText === "string" &&
    state.resultText.trim().startsWith("{")
  ) {
    try {
      structuredOutput = JSON.parse(state.resultText);
    } catch {
      structuredOutput = undefined;
    }
  }
  return {
    status: state.status,
    resultText: state.resultText,
    structuredOutput,
    errorDetail: state.errorDetail,
  };
}

describe("openhands-event-projection (fixture-based)", () => {
  it("projects a research run with errors into a well-formed DisplayItem stream", () => {
    const lines = loadFixtureLines("research-with-errors.jsonl");
    const { displayItems, terminalState } = projectAll(lines);

    // Synthesize the terminal result item the way the agent-store does.
    expect(terminalState).not.toBeNull();
    const stateForSummary = withStructuredOutputFromResultText(terminalState);
    const { tier, summary } = summarizeCompletedRun(stateForSummary);
    displayItems.push({
      id: "terminal-result-item",
      type: "output",
      timestamp: terminalState!.timestamp,
      outputText: terminalState!.resultText ?? summary,
      outputText_result: summary,
    });

    // Tier 1 fires because the lifted research_complete payload carries
    // dimensions_selected + question_count.
    expect(tier).toBe(1);
    expect(summary).toBe("Research complete: 4 dimensions, 10 questions");

    // Exactly one user MessageEvent → one task_sent collapsed item.
    const taskSent = displayItems.filter(
      (item) => item.toolName === "task_sent",
    );
    expect(taskSent).toHaveLength(1);

    // Exactly one invoke_skill subagent item.
    const subagents = displayItems.filter(
      (item) => item.type === "subagent" && item.toolName === "invoke_skill",
    );
    expect(subagents).toHaveLength(1);

    // 15 file_editor tool_call items (paired with their observations →
    // toolStatus is either ok or error, never pending after projection).
    const fileEditorItems = displayItems.filter(
      (item) => item.toolName === "file_editor",
    );
    expect(fileEditorItems).toHaveLength(15);
    for (const item of fileEditorItems) {
      expect(["ok", "error"]).toContain(item.toolStatus);
    }

    // 2 errored tool calls (path-not-exist failures observed in this run).
    const erroredTools = displayItems.filter(
      (item) => item.toolStatus === "error",
    );
    expect(erroredTools).toHaveLength(2);

    // Exactly one think action → one thinking item.
    const thinking = displayItems.filter((item) => item.type === "thinking");
    expect(thinking).toHaveLength(1);

    // 2 terminal commands.
    const terminals = displayItems.filter(
      (item) => item.toolName === "terminal",
    );
    expect(terminals).toHaveLength(2);

    // The agent's final MessageEvent → one output item; plus the synthesized
    // terminal result item we pushed above. Together: 2 output items.
    const outputs = displayItems.filter((item) => item.type === "output");
    expect(outputs).toHaveLength(2);

    // SystemPromptEvent → one collapsed runtime-setup row.
    const systemPrompts = displayItems.filter(
      (item) => item.toolName === "system_prompt",
    );
    expect(systemPrompts).toHaveLength(1);

    // The fixture has 41 conversation_event lines. Of those:
    //   19 ActionEvents → 19 added items
    //   19 ObservationEvents → 19 in-place updates (no new items added)
    //   2 MessageEvents → 2 added items
    //   1 SystemPromptEvent → 1 added item
    // = 22 items from projection, plus the synthesized terminal result item.
    expect(displayItems).toHaveLength(23);
  });

  it("produces a tier-2 'Answers sufficient' summary for the gate-eval-sufficient transcript", () => {
    const lines = loadFixtureLines("gate-eval-sufficient.jsonl");
    const { terminalState } = projectAll(lines);
    expect(terminalState).not.toBeNull();
    expect(terminalState!.status).toBe("completed");

    const stateForSummary = withStructuredOutputFromResultText(terminalState);
    const { tier, summary } = summarizeCompletedRun(stateForSummary);

    expect(tier).toBe(2);
    expect(summary).toBe("Answers sufficient: 5/5");
  });

  it("produces a tier-2 'Answers insufficient' summary for the gate-eval-insufficient transcript", () => {
    const lines = loadFixtureLines("gate-eval-insufficient.jsonl");
    const { terminalState } = projectAll(lines);
    expect(terminalState).not.toBeNull();
    expect(terminalState!.status).toBe("completed");

    const stateForSummary = withStructuredOutputFromResultText(terminalState);
    const { tier, summary } = summarizeCompletedRun(stateForSummary);

    expect(tier).toBe(2);
    expect(summary).toBe("Answers insufficient: 5/10");
  });

  it("drains the pending actions map to empty after the research transcript", () => {
    const lines = loadFixtureLines("research-with-errors.jsonl");
    const { pending } = projectAll(lines);

    // Every ActionEvent in this transcript has its matching ObservationEvent
    // (the two errors are still paired observations, just with is_error=true).
    expect(Object.keys(pending)).toHaveLength(0);
  });

  it("preserves consecutive tool clusters as tool-activity groups", () => {
    const lines = loadFixtureLines("research-with-errors.jsonl");
    const { displayItems } = projectAll(lines);

    const groups = groupDisplayItems(displayItems);

    // Some ActionEvents share an llm_response_id (parallel-action clusters);
    // regardless, consecutive tool_call/thinking items collapse into a
    // tool-activity visual group.
    expect(groups.some((g) => g.type === "tool-activity")).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatModelName,
  formatTokenCount,
  getContextUtilization,
  getLatestContextTokens,
  resetSessionRuntimeStoreInternals,
  useSessionRuntimeStore,
} from "@/stores/session-runtime-store";

describe("useSessionRuntimeStore", () => {
  beforeEach(() => {
    resetSessionRuntimeStoreInternals();
    useSessionRuntimeStore.getState().clearSessionRuns();
    vi.restoreAllMocks();
  });

  it("has empty initial state", () => {
    const state = useSessionRuntimeStore.getState();
    expect(state.runs).toEqual({});
  });

  it("startSessionRun creates a running run", () => {
    const beforeTime = Date.now();

    useSessionRuntimeStore.getState().startSessionRun("agent-1", "sonnet");

    const run = useSessionRuntimeStore.getState().runs["agent-1"];
    expect(run).toBeDefined();
    expect(run.conversationId).toBe("agent-1");
    expect(run.model).toBe("sonnet");
    expect(run.status).toBe("running");
    expect(run.startTime).toBeGreaterThanOrEqual(beforeTime);
    expect(run.endTime).toBeUndefined();
    expect(run.contextHistory).toEqual([]);
  });

  it("replays queued completion when exit arrives before registration", () => {
    useSessionRuntimeStore.getState().completeRun("late-agent", true);
    expect(useSessionRuntimeStore.getState().runs["late-agent"]).toBeUndefined();

    useSessionRuntimeStore
      .getState()
      .registerSessionRun("late-agent", "sonnet", "my-skill", "workspace");

    expect(useSessionRuntimeStore.getState().runs["late-agent"].status).toBe("completed");
  });

  it("stores terminal conversation state on completed runs", () => {
    useSessionRuntimeStore.getState().startSessionRun("agent-1", "sonnet");

    useSessionRuntimeStore.getState().applyConversationState("agent-1", {
      type: "conversation_state",
      runtime: "openhands",
      status: "completed",
      timestamp: Date.now(),
      resultText: JSON.stringify({ verdict: "sufficient" }),
    });

    const run = useSessionRuntimeStore.getState().runs["agent-1"];
    expect(run.status).toBe("completed");
    expect(run.conversationState?.resultText).toContain("sufficient");
  });

  it("tracks turn usage and context window metadata without transcript state", () => {
    useSessionRuntimeStore.getState().startSessionRun("agent-1", "sonnet");

    useSessionRuntimeStore.getState().applyContextWindow("agent-1", {
      contextWindow: 200_000,
      timestamp: Date.now(),
    });
    useSessionRuntimeStore.getState().applyTurnUsage("agent-1", {
      turn: 1,
      inputTokens: 1_000,
      outputTokens: 250,
      timestamp: Date.now(),
    });

    const run = useSessionRuntimeStore.getState().runs["agent-1"];
    expect(run.contextWindow).toBe(200_000);
    expect(run.contextHistory).toEqual([
      { turn: 1, inputTokens: 1_000, outputTokens: 250 },
    ]);
    expect(getLatestContextTokens(run)).toBe(1_000);
    expect(getContextUtilization(run)).toBe(0.5);
  });

  it("formats model and token counts for workflow stats surfaces", () => {
    expect(formatModelName("anthropic/claude-sonnet-4")).toBe(
      "Anthropic/claude Sonnet 4",
    );
    expect(formatTokenCount(12_345)).toBe("12.3k");
  });
});

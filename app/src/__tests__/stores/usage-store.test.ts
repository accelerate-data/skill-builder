import { describe, it, expect, beforeEach } from "vitest";
import { mockInvoke } from "@/test/mocks/tauri";
import { useUsageStore } from "@/stores/usage-store";
import type { UsageSummary, WorkflowSessionRecord, UsageByStep, UsageByModel, UsageByDay, AgentRunRecord } from "@/lib/types";

const mockSummary: UsageSummary = {
  total_cost: 1.25,
  total_runs: 10,
  avg_cost_per_run: 0.125,
};

const mockSessions: WorkflowSessionRecord[] = [
  {
    session_id: "ws-1",
    skill_name: "my-skill",
    min_step: 0,
    max_step: 2,
    steps_csv: "0,1,2",
    agent_count: 3,
    total_cost: 0.15,
    total_input_tokens: 15000,
    total_output_tokens: 3000,
    total_cache_read: 8000,
    total_cache_write: 1500,
    total_duration_ms: 36000,
    started_at: "2026-02-15T10:00:00Z",
    completed_at: "2026-02-15T10:00:36Z",
  },
];

const mockByStep: UsageByStep[] = [
  { step_id: 0, step_name: "Research", total_cost: 0.50, run_count: 3 },
  { step_id: 2, step_name: "Detailed Research", total_cost: 0.75, run_count: 5 },
];

const mockByModel: UsageByModel[] = [
  { model: "sonnet", total_cost: 0.80, run_count: 6 },
  { model: "opus", total_cost: 0.45, run_count: 4 },
];

const mockByDay: UsageByDay[] = [
  { date: "2026-02-15", total_cost: 0.15, total_tokens: 18000, run_count: 1 },
  { date: "2026-02-16", total_cost: 0.30, total_tokens: 36000, run_count: 2 },
];

const mockAgentRuns: AgentRunRecord[] = [
  {
    agent_id: "run-1",
    skill_name: "my-skill",
    step_id: 0,
    model: "claude-sonnet-4-6",
    status: "completed",
    input_tokens: 5000,
    output_tokens: 1000,
    cache_read_tokens: 2000,
    cache_write_tokens: 500,
    total_cost: 0.05,
    duration_ms: 12000,
    num_turns: 3,
    stop_reason: "end_turn",
    duration_api_ms: 11000,
    tool_use_count: 2,
    compaction_count: 0,
    session_id: "sess-1",
    started_at: "2026-02-15T10:00:00Z",
    completed_at: "2026-02-15T10:00:12Z",
  },
];

function setupInvokeMock() {
  mockInvoke.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "get_usage_summary":
        return Promise.resolve(mockSummary);
      case "get_recent_workflow_sessions":
        return Promise.resolve(mockSessions);
      case "get_agent_runs":
        return Promise.resolve(mockAgentRuns);
      case "get_usage_by_step":
        return Promise.resolve(mockByStep);
      case "get_usage_by_model":
        return Promise.resolve(mockByModel);
      case "get_usage_by_day":
        return Promise.resolve(mockByDay);
      case "reset_usage":
        return Promise.resolve();
      default:
        return Promise.reject(new Error(`Unmocked command: ${cmd}`));
    }
  });
}

describe("useUsageStore", () => {
  beforeEach(() => {
    useUsageStore.setState({
      summary: null,
      recentSessions: [],
      agentRuns: [],
      byStep: [],
      byModel: [],
      byDay: [],
      loading: false,
      error: null,
      dateRange: "all",
      skillFilter: null,
      modelFamilyFilter: null,
      skillNames: [],
      loadGeneration: 0,
    });
    mockInvoke.mockReset();
  });

  it("has correct initial state", () => {
    const state = useUsageStore.getState();
    expect(state.summary).toBeNull();
    expect(state.recentSessions).toEqual([]);
    expect(state.byStep).toEqual([]);
    expect(state.byModel).toEqual([]);
    expect(state.byDay).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.dateRange).toBe("all");
    expect(state.skillFilter).toBeNull();
    expect(state.skillNames).toEqual([]);
  });

  describe("fetchUsage", () => {
    it("loads all data and sets loading states", async () => {
      setupInvokeMock();

      const fetchPromise = useUsageStore.getState().fetchUsage();

      // loading should be true while fetching
      expect(useUsageStore.getState().loading).toBe(true);
      expect(useUsageStore.getState().error).toBeNull();

      await fetchPromise;

      const state = useUsageStore.getState();
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.summary).toEqual(mockSummary);
      expect(state.recentSessions).toEqual(mockSessions);
      expect(state.agentRuns).toEqual(mockAgentRuns);
      expect(state.byStep).toEqual(mockByStep);
      expect(state.byModel).toEqual(mockByModel);
      expect(state.byDay).toEqual(mockByDay);
    });

    it("calls all six Tauri commands", async () => {
      setupInvokeMock();

      await useUsageStore.getState().fetchUsage();

      const calledCommands = mockInvoke.mock.calls.map((c) => c[0]);
      expect(calledCommands).toContain("get_usage_summary");
      expect(calledCommands).toContain("get_recent_workflow_sessions");
      expect(calledCommands).toContain("get_agent_runs");
      expect(calledCommands).toContain("get_usage_by_step");
      expect(calledCommands).toContain("get_usage_by_model");
      expect(calledCommands).toContain("get_usage_by_day");
    });

    it("passes limit to get_recent_workflow_sessions", async () => {
      setupInvokeMock();

      await useUsageStore.getState().fetchUsage();

      const sessionsCall = mockInvoke.mock.calls.find((c) => c[0] === "get_recent_workflow_sessions");
      expect(sessionsCall).toBeDefined();
      expect(sessionsCall![1]).toEqual({ limit: 50, hideCancelled: false, startDate: null, skillName: null });
    });

    it("sets error state on failure", async () => {
      mockInvoke.mockRejectedValue(new Error("DB connection failed"));

      await useUsageStore.getState().fetchUsage();

      const state = useUsageStore.getState();
      expect(state.loading).toBe(false);
      expect(state.error).toBe("Error: DB connection failed");
      expect(state.summary).toBeNull();
    });

    it("discards stale response when a newer fetch completes first", async () => {
      const staleSummary: UsageSummary = { total_cost: 0.01, total_runs: 1, avg_cost_per_run: 0.01 };
      const freshSummary: UsageSummary = { total_cost: 99.99, total_runs: 100, avg_cost_per_run: 0.9999 };

      let resolveBarrier!: () => void;
      const barrier = new Promise<void>((resolve) => { resolveBarrier = resolve; });

      let callCount = 0;
      mockInvoke.mockImplementation((cmd: string) => {
        callCount++;
        const batchIndex = callCount;
        switch (cmd) {
          case "get_usage_summary":
            // First batch (calls 1-6): block on barrier and return stale data
            // Second batch (calls 7-12): resolve immediately with fresh data
            if (batchIndex <= 6) {
              return barrier.then(() => staleSummary);
            }
            return Promise.resolve(freshSummary);
          case "get_recent_workflow_sessions":
            return Promise.resolve(mockSessions);
          case "get_agent_runs":
            return Promise.resolve(mockAgentRuns);
          case "get_usage_by_step":
            return Promise.resolve(mockByStep);
          case "get_usage_by_model":
            return Promise.resolve(mockByModel);
          case "get_usage_by_day":
            return Promise.resolve(mockByDay);
          default:
            return Promise.reject(new Error(`Unmocked command: ${cmd}`));
        }
      });

      // Start fetch #1 (slow — blocked on barrier)
      const fetch1 = useUsageStore.getState().fetchUsage();

      // Start and await fetch #2 (fast — resolves immediately with freshSummary)
      await useUsageStore.getState().fetchUsage();

      // Unblock fetch #1 (stale data)
      resolveBarrier();
      await fetch1;

      // fetch #2's data should win
      expect(useUsageStore.getState().summary).toEqual(freshSummary);
    });

    it("applies latest response when fetches complete in order", async () => {
      const firstSummary: UsageSummary = { total_cost: 1.00, total_runs: 5, avg_cost_per_run: 0.20 };
      const secondSummary: UsageSummary = { total_cost: 2.00, total_runs: 10, avg_cost_per_run: 0.20 };

      let callCount = 0;
      mockInvoke.mockImplementation((cmd: string) => {
        callCount++;
        const batchIndex = callCount;
        switch (cmd) {
          case "get_usage_summary":
            return Promise.resolve(batchIndex <= 6 ? firstSummary : secondSummary);
          case "get_recent_workflow_sessions":
            return Promise.resolve(mockSessions);
          case "get_agent_runs":
            return Promise.resolve(mockAgentRuns);
          case "get_usage_by_step":
            return Promise.resolve(mockByStep);
          case "get_usage_by_model":
            return Promise.resolve(mockByModel);
          case "get_usage_by_day":
            return Promise.resolve(mockByDay);
          default:
            return Promise.reject(new Error(`Unmocked command: ${cmd}`));
        }
      });

      await useUsageStore.getState().fetchUsage();
      expect(useUsageStore.getState().summary).toEqual(firstSummary);

      await useUsageStore.getState().fetchUsage();
      expect(useUsageStore.getState().summary).toEqual(secondSummary);
    });
  });

  describe("resetCounter", () => {
    it("calls resetUsage and refetches all data", async () => {
      setupInvokeMock();

      await useUsageStore.getState().resetCounter();

      const calledCommands = mockInvoke.mock.calls.map((c) => c[0]);
      expect(calledCommands).toContain("reset_usage");
      expect(calledCommands).toContain("get_usage_summary");
      expect(calledCommands).toContain("get_recent_workflow_sessions");
      expect(calledCommands).toContain("get_usage_by_step");
      expect(calledCommands).toContain("get_usage_by_model");

      const state = useUsageStore.getState();
      expect(state.summary).toEqual(mockSummary);
      expect(state.recentSessions).toEqual(mockSessions);
      expect(state.agentRuns).toEqual(mockAgentRuns);
      expect(state.byStep).toEqual(mockByStep);
      expect(state.byModel).toEqual(mockByModel);
      expect(state.byDay).toEqual(mockByDay);
    });

    it("calls reset_usage before refetching", async () => {
      setupInvokeMock();

      await useUsageStore.getState().resetCounter();

      // reset_usage should be called first
      const firstCall = mockInvoke.mock.calls[0][0];
      expect(firstCall).toBe("reset_usage");
    });

    it("sets error state when resetUsage fails", async () => {
      mockInvoke.mockRejectedValue(new Error("Reset failed"));

      await useUsageStore.getState().resetCounter();

      const state = useUsageStore.getState();
      expect(state.error).toBe("Error: Reset failed");
      expect(state.loading).toBe(false);
    });
  });
});

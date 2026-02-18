import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetTauriMocks } from "@/test/mocks/tauri";
import { useUsageStore } from "@/stores/usage-store";
import type { UsageSummary, WorkflowSessionRecord, UsageByStep, UsageByModel } from "@/lib/types";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
  Toaster: () => null,
}));

// Mock the tauri functions used by usage-store and usage page
vi.mock("@/lib/tauri", () => ({
  getUsageSummary: vi.fn(() => Promise.resolve({ total_cost: 0, total_runs: 0, avg_cost_per_run: 0 })),
  getRecentWorkflowSessions: vi.fn(() => Promise.resolve([])),
  getSessionAgentRuns: vi.fn(() => Promise.resolve([])),
  getUsageByStep: vi.fn(() => Promise.resolve([])),
  getUsageByModel: vi.fn(() => Promise.resolve([])),
  resetUsage: vi.fn(() => Promise.resolve()),
}));

import UsagePage from "@/pages/usage";

const mockSummary: UsageSummary = {
  total_cost: 12.5678,
  total_runs: 42,
  avg_cost_per_run: 0.2992,
};

const mockByStep: UsageByStep[] = [
  { step_id: 1, step_name: "Research", total_cost: 3.5, run_count: 10 },
  { step_id: 5, step_name: "Confirm Decisions", total_cost: 6.0, run_count: 8 },
  { step_id: 6, step_name: "Generate Skill", total_cost: 2.0, run_count: 5 },
];

const mockByModel: UsageByModel[] = [
  { model: "claude-sonnet-4-520250514", total_cost: 5.5, run_count: 20 },
  { model: "claude-opus-4-20250514", total_cost: 7.0, run_count: 12 },
];

const mockRecentSessions: WorkflowSessionRecord[] = [
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
    started_at: new Date(Date.now() - 120000).toISOString(), // 2 min ago
    completed_at: new Date(Date.now() - 84000).toISOString(),
  },
  {
    session_id: "ws-2",
    skill_name: "another-skill",
    min_step: 5,
    max_step: 5,
    steps_csv: "5",
    agent_count: 1,
    total_cost: 1.2345,
    total_input_tokens: 50000,
    total_output_tokens: 8000,
    total_cache_read: 20000,
    total_cache_write: 3000,
    total_duration_ms: 180000,
    started_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    completed_at: new Date(Date.now() - 3420000).toISOString(),
  },
];

function setStoreData(overrides?: {
  summary?: UsageSummary | null;
  recentSessions?: WorkflowSessionRecord[];
  byStep?: UsageByStep[];
  byModel?: UsageByModel[];
  loading?: boolean;
  error?: string | null;
}) {
  useUsageStore.setState({
    summary: overrides?.summary !== undefined ? overrides.summary : mockSummary,
    recentSessions: overrides?.recentSessions ?? mockRecentSessions,
    byStep: overrides?.byStep ?? mockByStep,
    byModel: overrides?.byModel ?? mockByModel,
    loading: overrides?.loading ?? false,
    error: overrides?.error ?? null,
    fetchUsage: vi.fn(() => Promise.resolve()),
    resetCounter: vi.fn(() => Promise.resolve()),
  });
}

describe("UsagePage", () => {
  beforeEach(() => {
    resetTauriMocks();
    // Reset to default populated state
    setStoreData();
  });

  it("renders summary cards with correct values", () => {
    render(<UsagePage />);

    expect(screen.getByTestId("total-cost")).toHaveTextContent("$12.57");
    expect(screen.getByTestId("total-runs")).toHaveTextContent("42");
    expect(screen.getByTestId("avg-cost")).toHaveTextContent("$0.30");
  });

  it("renders cost-by-step breakdown", () => {
    render(<UsagePage />);

    expect(screen.getByText("Cost by Step")).toBeInTheDocument();
    // Step names may appear multiple times (in breakdown and in session badges),
    // so use getAllByText to verify they exist
    expect(screen.getAllByText("Research").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Confirm Decisions").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Generate Skill").length).toBeGreaterThanOrEqual(1);
    // Check cost text is rendered (unique to the breakdown section)
    expect(screen.getByText(/\$3\.50 \(10 agents\)/)).toBeInTheDocument();
    expect(screen.getByText(/\$6\.00 \(8 agents\)/)).toBeInTheDocument();
  });

  it("renders cost-by-model breakdown", () => {
    render(<UsagePage />);

    expect(screen.getByText("Cost by Model")).toBeInTheDocument();
    // Model names may appear multiple times (in breakdown and in session badges)
    expect(screen.getAllByText("claude-sonnet-4-520250514").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("claude-opus-4-20250514").length).toBeGreaterThanOrEqual(1);
    // Cost text is unique to the breakdown section
    expect(screen.getByText(/\$5\.50 \(20 agents\)/)).toBeInTheDocument();
    expect(screen.getByText(/\$7\.00 \(12 agents\)/)).toBeInTheDocument();
  });

  it("renders recent workflow sessions list", () => {
    render(<UsagePage />);

    expect(screen.getByText("Recent Workflow Runs")).toBeInTheDocument();
    expect(screen.getByText("my-skill")).toBeInTheDocument();
    expect(screen.getByText("another-skill")).toBeInTheDocument();
    // Session header shows total tokens
    expect(screen.getByText("18,000 tokens")).toBeInTheDocument(); // 15000 + 3000
    expect(screen.getByText("58,000 tokens")).toBeInTheDocument(); // 50000 + 8000
  });

  it("renders session start time in accordion header", () => {
    // Use a fixed started_at so the formatted output is deterministic
    const fixedDate = "2025-02-15T07:30:00.000Z";
    const formatted = new Date(fixedDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      + " " + new Date(fixedDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

    setStoreData({
      recentSessions: [
        {
          ...mockRecentSessions[0],
          started_at: fixedDate,
        },
      ],
    });
    render(<UsagePage />);

    expect(screen.getByText(formatted)).toBeInTheDocument();
  });

  it("expanding a session shows step table", async () => {
    const { getSessionAgentRuns } = await import("@/lib/tauri");
    vi.mocked(getSessionAgentRuns).mockResolvedValueOnce([
      {
        agent_id: "a1",
        skill_name: "my-skill",
        step_id: 1,
        model: "sonnet",
        status: "completed",
        input_tokens: 10000,
        output_tokens: 2000,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_cost: 0.05,
        duration_ms: 10000,
        num_turns: 5,
        stop_reason: "end_turn",
        duration_api_ms: 8000,
        tool_use_count: 10,
        compaction_count: 0,
        session_id: "ws-1",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      },
      {
        agent_id: "a2",
        skill_name: "my-skill",
        step_id: 5,
        model: "opus",
        status: "completed",
        input_tokens: 5000,
        output_tokens: 1000,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_cost: 0.10,
        duration_ms: 20000,
        num_turns: 3,
        stop_reason: "end_turn",
        duration_api_ms: 15000,
        tool_use_count: 5,
        compaction_count: 0,
        session_id: "ws-1",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      },
    ]);

    const user = userEvent.setup();
    render(<UsagePage />);

    const expandButton = screen.getByLabelText(/Toggle details for my-skill workflow run/);
    expect(expandButton).toHaveAttribute("aria-expanded", "false");

    await user.click(expandButton);

    expect(expandButton).toHaveAttribute("aria-expanded", "true");

    // Step table should render with grouped data
    await waitFor(() => {
      const table = screen.getByTestId("step-table");
      expect(table).toBeInTheDocument();
      // Step names appear in both the breakdown chart and step table
      expect(screen.getAllByText("Research").length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText("Confirm Decisions").length).toBeGreaterThanOrEqual(2);
      // Model names appear only in the step table
      expect(table.textContent).toContain("sonnet");
      expect(table.textContent).toContain("opus");
    });
  });

  it("reset button shows confirmation dialog", async () => {
    const user = userEvent.setup();
    render(<UsagePage />);

    const resetButton = screen.getByRole("button", { name: /Reset/i });
    await user.click(resetButton);

    await waitFor(() => {
      expect(screen.getByText("Reset Usage Data")).toBeInTheDocument();
      expect(screen.getByText(/permanently delete all usage tracking data/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Cancel/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Reset All Data/i })).toBeInTheDocument();
    });
  });

  it("calls resetCounter when confirmation is accepted", async () => {
    const mockResetCounter = vi.fn(() => Promise.resolve());
    useUsageStore.setState({ resetCounter: mockResetCounter });

    const user = userEvent.setup();
    render(<UsagePage />);

    const resetButton = screen.getByRole("button", { name: /Reset/i });
    await user.click(resetButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Reset All Data/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Reset All Data/i }));

    await waitFor(() => {
      expect(mockResetCounter).toHaveBeenCalled();
    });
  });

  it("empty state shows when no data", () => {
    setStoreData({
      summary: { total_cost: 0, total_runs: 0, avg_cost_per_run: 0 },
      recentSessions: [],
      byStep: [],
      byModel: [],
    });
    render(<UsagePage />);

    expect(screen.getByText("No usage data yet.")).toBeInTheDocument();
    expect(screen.getByText("Run an agent to start tracking costs.")).toBeInTheDocument();
  });

  it("loading state renders correctly", () => {
    setStoreData({ loading: true });
    render(<UsagePage />);

    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
    // Should not show any data
    expect(screen.queryByText("Total Spent")).not.toBeInTheDocument();
  });

  it("error state shows error message", () => {
    setStoreData({ error: "Database connection failed" });
    render(<UsagePage />);

    expect(screen.getByText(/Failed to load usage data:/)).toBeInTheDocument();
    expect(screen.getByText(/Database connection failed/)).toBeInTheDocument();
  });

  it("calls fetchUsage on mount", () => {
    const mockFetchUsage = vi.fn(() => Promise.resolve());
    useUsageStore.setState({ fetchUsage: mockFetchUsage });
    render(<UsagePage />);

    expect(mockFetchUsage).toHaveBeenCalled();
  });

  it("collapsing an expanded session hides details", async () => {
    const { getSessionAgentRuns } = await import("@/lib/tauri");
    vi.mocked(getSessionAgentRuns).mockResolvedValueOnce([
      {
        agent_id: "a1",
        skill_name: "my-skill",
        step_id: 1,
        model: "sonnet",
        status: "completed",
        input_tokens: 10000,
        output_tokens: 2000,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_cost: 0.05,
        duration_ms: 10000,
        num_turns: 5,
        stop_reason: "end_turn",
        duration_api_ms: 8000,
        tool_use_count: 10,
        compaction_count: 0,
        session_id: "ws-1",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      },
    ]);

    const user = userEvent.setup();
    render(<UsagePage />);

    const expandButton = screen.getByLabelText(/Toggle details for my-skill workflow run/);

    // Expand
    await user.click(expandButton);
    await waitFor(() => {
      expect(screen.getByTestId("step-table")).toBeInTheDocument();
    });

    // Collapse
    await user.click(expandButton);
    await waitFor(() => {
      expect(screen.queryByTestId("step-table")).not.toBeInTheDocument();
    });
    expect(expandButton).toHaveAttribute("aria-expanded", "false");
  });

  it("shows null summary as zero values", () => {
    setStoreData({
      summary: null,
      recentSessions: [],
    });
    render(<UsagePage />);

    // null summary with no sessions triggers empty state
    expect(screen.getByText("No usage data yet.")).toBeInTheDocument();
  });
});

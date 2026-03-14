import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetTauriMocks } from "@/test/mocks/tauri";
import { useUsageStore } from "@/stores/usage-store";
import type { UsageSummary, UsageByStep, UsageByModel, AgentRunRecord } from "@/lib/types";

// Mock toast wrapper
vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    dismiss: vi.fn(),
  },
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
  { step_id: 0, step_name: "Research", total_cost: 3.5, run_count: 10 },
  { step_id: 2, step_name: "Confirm Decisions", total_cost: 6.0, run_count: 8 },
  { step_id: 3, step_name: "Generate Skill", total_cost: 2.0, run_count: 5 },
];

const mockByModel: UsageByModel[] = [
  { model: "claude-sonnet-4-520250514", total_cost: 5.5, run_count: 20 },
  { model: "claude-opus-4-20250514", total_cost: 7.0, run_count: 12 },
];

const mockAgentRuns: AgentRunRecord[] = [
  {
    agent_id: "run-1",
    skill_name: "my-skill",
    step_id: 0,
    model: "sonnet",
    status: "completed",
    input_tokens: 10000,
    output_tokens: 2000,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    total_cost: 0.15,
    duration_ms: 36000,
    num_turns: 4,
    stop_reason: "end_turn",
    duration_api_ms: 30000,
    tool_use_count: 2,
    compaction_count: 0,
    session_id: "ws-1",
    started_at: "2025-02-15T07:30:00.000Z",
    completed_at: "2025-02-15T07:31:00.000Z",
  },
  {
    agent_id: "run-2",
    skill_name: "another-skill",
    step_id: 4,
    model: "opus",
    status: "completed",
    input_tokens: 5000,
    output_tokens: 1000,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    total_cost: 1.2345,
    duration_ms: 180000,
    num_turns: 3,
    stop_reason: "end_turn",
    duration_api_ms: 140000,
    tool_use_count: 1,
    compaction_count: 0,
    session_id: "ws-2",
    started_at: "2025-02-15T08:00:00.000Z",
    completed_at: "2025-02-15T08:03:00.000Z",
  },
];

function setStoreData(overrides?: {
  summary?: UsageSummary | null;
  agentRuns?: AgentRunRecord[];
  byStep?: UsageByStep[];
  byModel?: UsageByModel[];
  loading?: boolean;
  error?: string | null;
}) {
  useUsageStore.setState({
    summary: overrides?.summary !== undefined ? overrides.summary : mockSummary,
    recentSessions: [],
    agentRuns: overrides?.agentRuns ?? mockAgentRuns,
    byDay: [],
    hideCancelled: false,
    dateRange: "all",
    skillFilter: null,
    modelFamilyFilter: null,
    skillNames: [],
    byStep: overrides?.byStep ?? mockByStep,
    byModel: overrides?.byModel ?? mockByModel,
    loading: overrides?.loading ?? false,
    error: overrides?.error ?? null,
    fetchUsage: vi.fn(() => Promise.resolve()),
    resetCounter: vi.fn(() => Promise.resolve()),
    fetchSkillNames: vi.fn(() => Promise.resolve()),
    toggleHideCancelled: vi.fn(),
    setDateRange: vi.fn(),
    setSkillFilter: vi.fn(),
    setModelFamilyFilter: vi.fn(),
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
    // Usage page renders shortened model-family labels in the chart/table UI.
    expect(screen.getAllByText("Sonnet").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Opus").length).toBeGreaterThanOrEqual(1);
    // Cost text is unique to the breakdown section
    expect(screen.getByText(/\$5\.50 \(20 agents\)/)).toBeInTheDocument();
    expect(screen.getByText(/\$7\.00 \(12 agents\)/)).toBeInTheDocument();
  });

  it("renders step history table with runs", () => {
    render(<UsagePage />);

    expect(screen.getByText("Step History")).toBeInTheDocument();
    expect(screen.getByText("my-skill")).toBeInTheDocument();
    expect(screen.getByText("another-skill")).toBeInTheDocument();
    expect(screen.getByText("12.0K")).toBeInTheDocument();
    expect(screen.getByText("6.0K")).toBeInTheDocument();
  });

  it("renders run start time in step history table", () => {
    const fixedDate = "2025-02-15T07:30:00.000Z";
    const formatted = new Date(fixedDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " + new Date(fixedDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

    setStoreData({ agentRuns: [{ ...mockAgentRuns[0], started_at: fixedDate }] });
    render(<UsagePage />);

    expect(screen.getByText(formatted)).toBeInTheDocument();
  });

  it("renders step history table columns", async () => {
    render(<UsagePage />);
    const table = await screen.findByTestId("step-table");
    expect(table).toBeInTheDocument();
    expect(table.textContent).toContain("Research");
    expect(table.textContent).toContain("Confirm Decisions");
    expect(table.textContent).toContain("Sonnet");
    expect(table.textContent).toContain("Opus");
  });

  it("maps canonical and synthetic step ids to stable labels in step history", async () => {
    setStoreData({
      agentRuns: [
        { ...mockAgentRuns[0], step_id: 2, agent_id: "run-3" },
        { ...mockAgentRuns[0], step_id: -11, agent_id: "run-4" },
      ],
    });
    render(<UsagePage />);

    const table = await screen.findByTestId("step-table");
    expect(table.textContent).toContain("Detailed Research");
    expect(table.textContent).toContain("Test");
    expect(table.textContent).not.toContain("Step 2");
    expect(table.textContent).not.toContain("Step -11");
  });

  it("maps legacy step ids 4 and 5 to canonical labels", async () => {
    setStoreData({
      agentRuns: [
        { ...mockAgentRuns[0], step_id: 4, agent_id: "run-5" },
        { ...mockAgentRuns[0], step_id: 5, agent_id: "run-6" },
      ],
    });
    render(<UsagePage />);

    const table = await screen.findByTestId("step-table");
    expect(table.textContent).toContain("Confirm Decisions");
    expect(table.textContent).toContain("Generate Skill");
    expect(table.textContent).not.toContain("Step 4");
    expect(table.textContent).not.toContain("Step 5");
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
      agentRuns: [],
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

  it("sorting by date toggles direction and keeps rows visible", async () => {
    const user = userEvent.setup();
    render(<UsagePage />);

    const dateHeader = screen.getByRole("button", { name: /^date/i });
    await user.click(dateHeader);
    await user.click(dateHeader);
    expect(screen.getByTestId("step-table")).toBeInTheDocument();
    expect(screen.getAllByText("my-skill").length).toBeGreaterThanOrEqual(1);
  });

  it("shows null summary as zero values", () => {
    setStoreData({
      summary: null,
      agentRuns: [],
    });
    render(<UsagePage />);

    // null summary with no sessions triggers empty state
    expect(screen.getByText("No usage data yet.")).toBeInTheDocument();
  });

  it("hide cancelled checkbox calls toggleHideCancelled when clicked", async () => {
    const mockToggle = vi.fn();
    useUsageStore.setState({ toggleHideCancelled: mockToggle });

    const user = userEvent.setup();
    render(<UsagePage />);

    const checkbox = screen.getByLabelText("Hide cancelled runs");
    expect(checkbox).toBeInTheDocument();
    await user.click(checkbox);

    expect(mockToggle).toHaveBeenCalled();
  });

  it("cancel button closes reset dialog without calling resetCounter", async () => {
    const mockResetCounter = vi.fn(() => Promise.resolve());
    useUsageStore.setState({ resetCounter: mockResetCounter });

    const user = userEvent.setup();
    render(<UsagePage />);

    const resetButton = screen.getByRole("button", { name: /Reset/i });
    await user.click(resetButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Cancel/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Cancel/i }));

    await waitFor(() => {
      expect(screen.queryByText("Reset Usage Data")).not.toBeInTheDocument();
    });

    expect(mockResetCounter).not.toHaveBeenCalled();
    // Data should remain visible after cancel
    expect(screen.getByTestId("total-cost")).toBeInTheDocument();
  });

  it("renders multi-model breakdown with correct costs and counts", () => {
    setStoreData({
      byModel: [
        { model: "claude-sonnet-4-520250514", total_cost: 1.85, run_count: 2 },
        { model: "claude-haiku-3-520250514", total_cost: 0.9, run_count: 1 },
      ],
    });
    render(<UsagePage />);

    expect(screen.getByText("Cost by Model")).toBeInTheDocument();
    // shortModelName() maps these to "Sonnet" and "Haiku"
    expect(screen.getAllByText("Sonnet").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Haiku").length).toBeGreaterThanOrEqual(1);
    // Per-model cost and count labels
    expect(screen.getByText(/\$1\.85 \(2 agents\)/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.90 \(1 agents\)/)).toBeInTheDocument();
  });

  it("shows no runs message when agentRuns is empty but summary has data", () => {
    setStoreData({
      summary: { total_cost: 2.75, total_runs: 3, avg_cost_per_run: 0.917 },
      agentRuns: [],
      byStep: [{ step_id: 1, step_name: "Research", total_cost: 2.75, run_count: 3 }],
      byModel: [
        { model: "claude-sonnet-4-520250514", total_cost: 1.85, run_count: 2 },
        { model: "claude-haiku-3-520250514", total_cost: 0.9, run_count: 1 },
      ],
    });
    render(<UsagePage />);

    expect(screen.getByText("Step History")).toBeInTheDocument();
    expect(screen.getByText("No runs in this period")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { AgentRunRecord } from "@/lib/types";

// Mock tauri before importing the component
const mockGetStepAgentRuns = vi.fn();
const mockReadFile = vi.fn();

vi.mock("@/lib/tauri", () => ({
  getStepAgentRuns: (...args: unknown[]) => mockGetStepAgentRuns(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// Mock react-markdown to avoid ESM issues in tests
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));

import { WorkflowStepComplete } from "@/components/workflow-step-complete";

function makeRun(totalCost: number): AgentRunRecord {
  return {
    agent_id: "agent-1",
    skill_name: "my-skill",
    step_id: 0,
    model: "claude-sonnet-4-5",
    status: "completed",
    stop_reason: "end_turn",
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    total_cost: totalCost,
    duration_ms: 1000,
    duration_api_ms: 900,
    num_turns: 2,
    tool_use_count: 3,
    compaction_count: 0,
    session_id: "session-1",
    started_at: "2024-01-01T00:00:00Z",
    completed_at: "2024-01-01T00:00:01Z",
  };
}

const baseProps = {
  stepName: "Research",
  stepId: 0,
  outputFiles: [],
  skillName: "my-skill",
  skillsPath: "/skills",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockReadFile.mockResolvedValue(null);
});

describe("WorkflowStepComplete — cost display", () => {
  // --- Non-review mode: Zustand (cost prop) is source of truth ---

  it("shows cost from cost prop in non-review mode (Zustand is source of truth)", async () => {
    mockGetStepAgentRuns.mockResolvedValue([makeRun(0.0)]);  // DB has stale data with 0

    render(<WorkflowStepComplete {...baseProps} cost={0.042} />);

    await waitFor(() => {
      expect(mockGetStepAgentRuns).toHaveBeenCalled();
    });
    // Should show the Zustand cost, NOT the stale DB value of 0
    expect(screen.getByText(/\$0\.0420/)).toBeInTheDocument();
  });

  it("shows no cost in non-review mode when cost prop is undefined", async () => {
    mockGetStepAgentRuns.mockResolvedValue([makeRun(0.042)]);

    render(<WorkflowStepComplete {...baseProps} />);  // no cost prop

    await waitFor(() => {
      expect(mockGetStepAgentRuns).toHaveBeenCalled();
    });
    // DB data is ignored in non-review mode; no cost prop means no display
    expect(screen.queryByText(/\$0\./)).not.toBeInTheDocument();
  });

  it("does not show AgentStatsBar in non-review mode", async () => {
    mockGetStepAgentRuns.mockResolvedValue([makeRun(0.042)]);

    render(<WorkflowStepComplete {...baseProps} cost={0.042} />);

    await waitFor(() => {
      expect(mockGetStepAgentRuns).toHaveBeenCalled();
    });
    // AgentStatsBar has a "Cost" label in its summary row — should not appear
    expect(screen.queryByText("Cost")).not.toBeInTheDocument();
  });

  // --- Review mode: DB is source of truth ---

  it("shows cost from DB in review mode", async () => {
    mockGetStepAgentRuns.mockResolvedValue([makeRun(0.042)]);

    render(<WorkflowStepComplete {...baseProps} reviewMode />);

    await waitFor(() => {
      expect(screen.getByText(/\$0\.0420/)).toBeInTheDocument();
    });
    expect(mockGetStepAgentRuns).toHaveBeenCalledWith("my-skill", 0);
  });

  it("sums multiple agent runs for the step cost in review mode", async () => {
    mockGetStepAgentRuns.mockResolvedValue([makeRun(0.03), makeRun(0.015)]);

    render(<WorkflowStepComplete {...baseProps} reviewMode />);

    await waitFor(() => {
      expect(screen.getByText(/\$0\.0450/)).toBeInTheDocument();
    });
  });

  it("shows no cost in review mode when DB returns empty", async () => {
    mockGetStepAgentRuns.mockResolvedValue([]);

    render(<WorkflowStepComplete {...baseProps} reviewMode cost={0.042} />);

    await waitFor(() => {
      expect(mockGetStepAgentRuns).toHaveBeenCalled();
    });
    // In review mode the cost prop is ignored; DB is empty so no cost shown
    expect(screen.queryByText(/\$0\./)).not.toBeInTheDocument();
  });

  // --- Both modes: agent runs are always loaded from DB ---

  it("loads agent runs in both review and non-review mode", async () => {
    mockGetStepAgentRuns.mockResolvedValue([]);

    render(<WorkflowStepComplete {...baseProps} reviewMode={false} />);
    await waitFor(() => expect(mockGetStepAgentRuns).toHaveBeenCalledWith("my-skill", 0));

    vi.clearAllMocks();
    mockGetStepAgentRuns.mockResolvedValue([]);

    render(<WorkflowStepComplete {...baseProps} reviewMode={true} />);
    await waitFor(() => expect(mockGetStepAgentRuns).toHaveBeenCalledWith("my-skill", 0));
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// Mock ClarificationsEditor to expose editable state in tests
const mockOnChange = vi.fn();
const mockOnContinue = vi.fn();
vi.mock("@/components/clarifications-editor", () => ({
  ClarificationsEditor: ({ data, onChange, onContinue, readOnly }: {
    data: unknown;
    onChange?: (updated: unknown) => void;
    onContinue?: () => void;
    readOnly?: boolean;
  }) => (
    <div data-testid="clarifications-editor" data-readonly={readOnly ?? false}>
      <span data-testid="clarifications-data">{JSON.stringify(data)}</span>
      {onChange && <button data-testid="clarifications-change" onClick={() => onChange(data)}>Edit</button>}
      {onContinue && <button data-testid="clarifications-continue" onClick={onContinue}>Continue</button>}
    </div>
  ),
}));

// Mock ResearchSummaryCard to check editable prop
vi.mock("@/components/research-summary-card", () => ({
  ResearchSummaryCard: ({ editable, onClarificationsContinue }: {
    editable?: boolean;
    onClarificationsContinue?: () => void;
    [key: string]: unknown;
  }) => (
    <div data-testid="research-summary-card" data-editable={!!editable}>
      {onClarificationsContinue && <button data-testid="rsc-continue" onClick={onClarificationsContinue}>Continue</button>}
    </div>
  ),
}));

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

describe("WorkflowStepComplete — clarificationsEditable", () => {
  const researchPlanMd = "# Research Plan\nTest research plan content";
  const clarificationsJson = JSON.stringify({
    version: "1",
    metadata: { title: "Test", question_count: 1, section_count: 1, refinement_count: 0, must_answer_count: 0, priority_questions: [] },
    sections: [{ id: "S1", title: "Section", questions: [{ id: "Q1", title: "Q1", must_answer: false, text: "Test?", choices: [], answer_choice: null, answer_text: null, refinements: [] }] }],
    notes: [],
  });

  const researchProps = {
    stepName: "Research",
    stepId: 0,
    outputFiles: ["context/clarifications.json"],
    skillName: "my-skill",
    skillsPath: "/skills",
  };

  const detailedResearchProps = {
    stepName: "Detailed Research",
    stepId: 1,
    outputFiles: ["context/clarifications.json"],
    skillName: "my-skill",
    skillsPath: "/skills",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStepAgentRuns.mockResolvedValue([]);
  });

  it("renders ResearchSummaryCard as editable when clarificationsEditable=true on research step", async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("research-plan.md")) return Promise.resolve(researchPlanMd);
      if (path.includes("clarifications.json")) return Promise.resolve(clarificationsJson);
      return Promise.resolve(null);
    });

    render(<WorkflowStepComplete {...researchProps} clarificationsEditable onClarificationsChange={mockOnChange} onClarificationsContinue={mockOnContinue} />);

    await waitFor(() => {
      expect(screen.getByTestId("research-summary-card")).toBeInTheDocument();
    });

    // Should be editable
    expect(screen.getByTestId("research-summary-card")).toHaveAttribute("data-editable", "true");
  });

  it("renders ResearchSummaryCard as read-only when clarificationsEditable is false", async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("research-plan.md")) return Promise.resolve(researchPlanMd);
      if (path.includes("clarifications.json")) return Promise.resolve(clarificationsJson);
      return Promise.resolve(null);
    });

    render(<WorkflowStepComplete {...researchProps} />);

    await waitFor(() => {
      expect(screen.getByTestId("research-summary-card")).toBeInTheDocument();
    });

    // Should NOT be editable
    expect(screen.getByTestId("research-summary-card")).toHaveAttribute("data-editable", "false");
  });

  it("renders ClarificationsEditor directly on detailed research step with clarificationsEditable=true", async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("clarifications.json")) return Promise.resolve(clarificationsJson);
      return Promise.resolve(null);
    });

    render(<WorkflowStepComplete {...detailedResearchProps} clarificationsEditable onClarificationsChange={mockOnChange} onClarificationsContinue={mockOnContinue} />);

    await waitFor(() => {
      expect(screen.getByTestId("clarifications-editor")).toBeInTheDocument();
    });

    // Continue button should be rendered (since onClarificationsContinue is provided)
    expect(screen.getByTestId("clarifications-continue")).toBeInTheDocument();
  });
});

describe("missing-files error state", () => {
  const researchProps = {
    stepName: "Research",
    stepId: 0,
    outputFiles: ["context/clarifications.json"],
    skillName: "my-skill",
    skillsPath: "/skills",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStepAgentRuns.mockResolvedValue([]);
    mockReadFile.mockResolvedValue("__NOT_FOUND__");
  });

  it("shows Reset Step button when research files are missing and onResetStep is provided", async () => {
    const onResetStep = vi.fn();

    render(<WorkflowStepComplete {...researchProps} onResetStep={onResetStep} />);

    await waitFor(() => {
      expect(screen.getByText("Reset Step")).toBeInTheDocument();
    });
    expect(screen.getByText("Research step completed but output files are missing")).toBeInTheDocument();
  });

  it("calls onResetStep when Reset Step button is clicked", async () => {
    const onResetStep = vi.fn();
    const user = userEvent.setup();

    render(<WorkflowStepComplete {...researchProps} onResetStep={onResetStep} />);

    await waitFor(() => {
      expect(screen.getByText("Reset Step")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Reset Step"));
    expect(onResetStep).toHaveBeenCalledOnce();
  });

  it("hides Reset Step button when onResetStep is not provided", async () => {
    render(<WorkflowStepComplete {...researchProps} />);

    await waitFor(() => {
      expect(screen.getByText("Research step completed but output files are missing")).toBeInTheDocument();
    });

    expect(screen.queryByText("Reset Step")).not.toBeInTheDocument();
  });

  it("does not render StepActionBar (Next Step) in missing-files error state", async () => {
    const onNextStep = vi.fn();

    render(<WorkflowStepComplete {...researchProps} onNextStep={onNextStep} isLastStep={false} reviewMode={false} />);

    await waitFor(() => {
      expect(screen.getByText("Research step completed but output files are missing")).toBeInTheDocument();
    });

    expect(screen.queryByText("Next Step")).not.toBeInTheDocument();
  });
});

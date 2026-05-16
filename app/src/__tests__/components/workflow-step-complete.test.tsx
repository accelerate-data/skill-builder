import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentRunRecord } from "@/lib/types";

// Mock useClarifications — ResearchStepComplete and DetailedResearchStepComplete use TanStack Query
const mockUseClarifications = vi.hoisted(() => vi.fn());
const mockUseRefinements = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries/clarifications", () => ({
  useClarifications: mockUseClarifications,
  useRefinements: mockUseRefinements,
}));

// Mock useDecisions — DecisionsStepComplete uses TanStack Query
const mockUseDecisions = vi.hoisted(() => vi.fn());
const mockUseSaveDecisionsEdit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries/decisions", () => ({
  useDecisions: mockUseDecisions,
  useSaveDecisionsEdit: mockUseSaveDecisionsEdit,
}));

// Minimal ClarificationsDto used by clarificationsEditable tests
const minimalClarDto = {
  skill_id: "my-skill",
  version: "1",
  refinement_count: 0,
  must_answer_count: 0,
  question_count: 1,
  section_count: 1,
  title: "Test",
  sections: [{ section_id: 1, ordinal: 0, title: "Section" }],
  questions: [
    {
      question_id: "Q1",
      section_id: 1,
      parent_question_id: null,
      ordinal: 0,
      title: "Q1",
      text: "Test?",
      must_answer: false,
      answer_choice: null,
      answer_text: null,
      choices: [],
      refinements: [],
    },
  ],
  notes: [],
};

const minimalRefinementsDto = {
  skill_id: "my-skill",
  version: "1",
  refinement_count: 1,
  must_answer_count: 0,
  question_count: 1,
  section_count: 1,
  title: "Refinements",
  created_at: 0,
  updated_at: 0,
  sections: [{ section_id: "refinement-section-1", ordinal: 0, title: "Refinement Section" }],
  questions: [
    {
      question_id: "R1.1",
      section_id: "refinement-section-1",
      ordinal: 0,
      title: "Follow-up question",
      text: "Need one more detail.",
      must_answer: false,
      answer_choice: null,
      answer_text: null,
      recommendation: null,
      choices: [],
    },
  ],
  notes: [],
};

// DecisionsDto matching the decisionsJson fixture in the decisions describe block
const decisionsDtoFixture = {
  skill_id: "my-skill",
  version: "1",
  round: 1,
  decision_count: 2,
  conflicts_resolved: 0,
  contradictory_inputs_state: "active",
  created_at: 0,
  updated_at: 0,
  items: [
    {
      decision_id: "D1",
      ordinal: 0,
      title: "Capability",
      original_question: "What should this skill enable Claude to do?",
      decision: "Draft capability text",
      implication: "Needs user confirmation before generation",
      status: "needs-review",
    },
    {
      decision_id: "D2",
      ordinal: 1,
      title: "Trigger",
      original_question: "When should this skill trigger?",
      decision: "Trigger on planning requests",
      implication: "Used to draft the skill description",
      status: "resolved",
    },
  ],
};

// Mock tauri before importing the component
const mockGetStepAgentRuns = vi.fn();
const mockReadFile = vi.fn();
const mockGetContextFileContent = vi.fn();
const mockSaveDecisionsContent = vi.fn();
const mockGetDisabledSteps = vi.fn();

vi.mock("@/lib/tauri", () => ({
  getStepAgentRuns: (...args: unknown[]) => mockGetStepAgentRuns(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  getContextFileContent: (...args: unknown[]) =>
    mockGetContextFileContent(...args),
  saveDecisionsContent: (...args: unknown[]) =>
    mockSaveDecisionsContent(...args),
  getDisabledSteps: (...args: unknown[]) => mockGetDisabledSteps(...args),
  listSkillFiles: vi.fn().mockResolvedValue([]),
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
  ClarificationsEditor: ({
    data,
    onChange,
    onContinue,
    readOnly,
  }: {
    data: unknown;
    onChange?: (updated: unknown) => void;
    onContinue?: () => void;
    readOnly?: boolean;
  }) => (
    <div data-testid="clarifications-editor" data-readonly={readOnly ?? false}>
      <span data-testid="clarifications-data">{JSON.stringify(data)}</span>
      {onChange && (
        <button
          data-testid="clarifications-change"
          onClick={() => onChange(data)}
        >
          Edit
        </button>
      )}
      {onContinue && (
        <button data-testid="clarifications-continue" onClick={onContinue}>
          Continue
        </button>
      )}
    </div>
  ),
}));

// Mock ResearchSummaryCard to check editable prop
vi.mock("@/components/research-summary-card", () => ({
  ResearchSummaryCard: ({
    editable,
    onClarificationsContinue,
  }: {
    editable?: boolean;
    onClarificationsContinue?: () => void;
    [key: string]: unknown;
  }) => (
    <div data-testid="research-summary-card" data-editable={!!editable}>
      {onClarificationsContinue && (
        <button data-testid="rsc-continue" onClick={onClarificationsContinue}>
          Continue
        </button>
      )}
    </div>
  ),
}));

import { WorkflowStepComplete } from "@/components/step-complete";
import { listSkillFiles } from "@/lib/tauri";

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
  skillId: 42,
  skillName: "my-skill",
  skillsPath: "/skills",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseClarifications.mockReturnValue({
    data: null,
    isLoading: false,
    isError: false,
  });
  mockUseDecisions.mockReturnValue({
    data: null,
    isLoading: false,
    isError: false,
  });
  mockUseSaveDecisionsEdit.mockReturnValue({ mutate: vi.fn() });
  mockReadFile.mockResolvedValue(null);
  mockGetContextFileContent.mockResolvedValue(null);
  mockSaveDecisionsContent.mockResolvedValue(undefined);
  mockGetDisabledSteps.mockResolvedValue([]);
});

describe("WorkflowStepComplete — agent runs", () => {
  it("does not show AgentStatsBar in non-review mode", async () => {
    mockGetStepAgentRuns.mockResolvedValue([makeRun(0.042)]);

    render(<WorkflowStepComplete {...baseProps} />);

    await waitFor(() => {
      expect(mockGetStepAgentRuns).toHaveBeenCalled();
    });
    // AgentStatsBar has a "Cost" label in its summary row — should not appear
    expect(screen.queryByText("Cost")).not.toBeInTheDocument();
  });

  it("does not display inline cost in non-review mode", async () => {
    mockGetStepAgentRuns.mockResolvedValue([makeRun(0.042)]);

    render(<WorkflowStepComplete {...baseProps} />);

    await waitFor(() => {
      expect(mockGetStepAgentRuns).toHaveBeenCalled();
    });
    expect(screen.queryByText(/\$0\./)).not.toBeInTheDocument();
  });

  it("does not display inline cost in review mode", async () => {
    mockGetStepAgentRuns.mockResolvedValue([makeRun(0.042)]);

    render(<WorkflowStepComplete {...baseProps} reviewMode />);

    await waitFor(() => {
      expect(mockGetStepAgentRuns).toHaveBeenCalled();
    });
    // Cost is only shown via AgentStatsBar in review mode, not inline
    expect(screen.queryByText(/\$0\.0420/)).not.toBeInTheDocument();
  });

  it("loads agent runs in both review and non-review mode", async () => {
    mockGetStepAgentRuns.mockResolvedValue([]);

    render(<WorkflowStepComplete {...baseProps} reviewMode={false} />);
    await waitFor(() =>
      expect(mockGetStepAgentRuns).toHaveBeenCalledWith(42, 0),
    );

    vi.clearAllMocks();
    mockGetStepAgentRuns.mockResolvedValue([]);

    render(<WorkflowStepComplete {...baseProps} reviewMode={true} />);
    await waitFor(() =>
      expect(mockGetStepAgentRuns).toHaveBeenCalledWith(42, 0),
    );
  });
});

describe("WorkflowStepComplete — plugin-aware file lookup", () => {
  it("passes plugin slug through listSkillFiles for completed-step file loading", async () => {
    vi.mocked(listSkillFiles).mockResolvedValue([
      {
        name: "SKILL.md",
        relative_path: "SKILL.md",
        absolute_path: "/skills/analytics/skills/my-skill/SKILL.md",
        is_directory: false,
        is_readonly: false,
        size_bytes: 12,
      },
    ]);
    mockReadFile.mockResolvedValue("# My Skill");
    mockGetStepAgentRuns.mockResolvedValue([]);

    render(
      <WorkflowStepComplete
        stepName="Generate Skill"
        stepId={3}
        outputFiles={["skill/SKILL.md"]}
        skillName="my-skill"
        pluginSlug="analytics"
        skillsPath="/skills"
      />,
    );

    await waitFor(() => {
      expect(listSkillFiles).toHaveBeenCalledWith(
        "/skills",
        "my-skill",
        "analytics",
      );
    });
  });
});

describe("WorkflowStepComplete — clarificationsEditable", () => {
  const researchPlanMd = "# Research Plan\nTest research plan content";
  const clarificationsJson = JSON.stringify({
    version: "1",
    metadata: {
      title: "Test",
      question_count: 1,
      section_count: 1,
      refinement_count: 0,
      must_answer_count: 0,
      priority_questions: [],
    },
    sections: [
      {
        id: "S1",
        title: "Section",
        questions: [
          {
            id: "Q1",
            title: "Q1",
            must_answer: false,
            text: "Test?",
            choices: [],
            answer_choice: null,
            answer_text: null,
            refinements: [],
          },
        ],
      },
    ],
    notes: [],
  });

  const researchProps = {
    stepName: "Research",
    stepId: 0,
    outputFiles: ["context/clarifications.json"],
    skillId: 42,
    skillName: "my-skill",
    workspacePath: "/workspace",
    skillsPath: "/skills",
  };

  const detailedResearchProps = {
    stepName: "Detailed Research",
    stepId: 1,
    outputFiles: ["context/clarifications.json"],
    skillId: 42,
    skillName: "my-skill",
    workspacePath: "/workspace",
    skillsPath: "/skills",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStepAgentRuns.mockResolvedValue([]);
    mockUseClarifications.mockReturnValue({
      data: minimalClarDto,
      isLoading: false,
      isError: false,
    });
    mockUseRefinements.mockReturnValue({ data: null, isLoading: false });
    mockGetContextFileContent.mockImplementation(
      (_skill: string, _workspace: string, filename: string) => {
        if (filename === "clarifications.json")
          return Promise.resolve(clarificationsJson);
        return Promise.resolve(null);
      },
    );
  });

  it("renders ResearchSummaryCard as editable when clarificationsEditable=true on research step", async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("research-plan.md"))
        return Promise.resolve(researchPlanMd);
      if (path.includes("clarifications.json"))
        return Promise.resolve(clarificationsJson);
      return Promise.resolve(null);
    });

    render(
      <WorkflowStepComplete
        {...researchProps}
        clarificationsEditable
        onClarificationsChange={mockOnChange}
        onClarificationsContinue={mockOnContinue}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("research-summary-card")).toBeInTheDocument();
    });

    // Should be editable
    expect(screen.getByTestId("research-summary-card")).toHaveAttribute(
      "data-editable",
      "true",
    );
    expect(mockUseClarifications).toHaveBeenCalledWith("42");
  });

  it("renders ResearchSummaryCard as read-only when clarificationsEditable is false", async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("research-plan.md"))
        return Promise.resolve(researchPlanMd);
      if (path.includes("clarifications.json"))
        return Promise.resolve(clarificationsJson);
      return Promise.resolve(null);
    });

    render(<WorkflowStepComplete {...researchProps} />);

    await waitFor(() => {
      expect(screen.getByTestId("research-summary-card")).toBeInTheDocument();
    });

    // Should NOT be editable
    expect(screen.getByTestId("research-summary-card")).toHaveAttribute(
      "data-editable",
      "false",
    );
  });

  it("renders ClarificationsEditor directly on detailed research step with clarificationsEditable=true", async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("clarifications.json"))
        return Promise.resolve(clarificationsJson);
      return Promise.resolve(null);
    });

    render(
      <WorkflowStepComplete
        {...detailedResearchProps}
        clarificationsEditable
        onClarificationsChange={mockOnChange}
        onClarificationsContinue={mockOnContinue}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("clarifications-editor")).toBeInTheDocument();
    });

    // Continue button should be rendered (since onClarificationsContinue is provided)
    expect(screen.getByTestId("clarifications-continue")).toBeInTheDocument();
    expect(mockUseClarifications).toHaveBeenCalledWith("42");
  });

  it("merges refinement questions into editable Detailed Research data", async () => {
    mockUseRefinements.mockReturnValue({
      data: minimalRefinementsDto,
      isLoading: false,
    });

    render(
      <WorkflowStepComplete
        {...detailedResearchProps}
        clarificationsEditable
        clarificationsData={{
          version: "1",
          metadata: {
            title: "Test",
            question_count: 1,
            section_count: 1,
            refinement_count: 0,
            must_answer_count: 0,
            priority_questions: [],
          },
          sections: [
            {
              id: 1,
              title: "Section",
              questions: [
                {
                  id: "Q1",
                  title: "Q1",
                  must_answer: false,
                  text: "Test?",
                  choices: [],
                  answer_choice: null,
                  answer_text: null,
                  refinements: [],
                },
              ],
            },
          ],
          notes: [],
          answer_evaluator_notes: [],
        }}
        onClarificationsChange={mockOnChange}
        onClarificationsContinue={mockOnContinue}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("clarifications-editor")).toBeInTheDocument();
    });

    expect(screen.getByTestId("clarifications-data").textContent).toContain("R1.1");
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
    mockUseClarifications.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
    });
    mockReadFile.mockResolvedValue("__NOT_FOUND__");
  });

  it("shows Reset Step button when research files are missing and onResetStep is provided", async () => {
    const onResetStep = vi.fn();

    render(
      <WorkflowStepComplete {...researchProps} onResetStep={onResetStep} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Reset Step")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Clarifications not found in database"),
    ).toBeInTheDocument();
  });

  it("calls onResetStep when Reset Step button is clicked", async () => {
    const onResetStep = vi.fn();
    const user = userEvent.setup();

    render(
      <WorkflowStepComplete {...researchProps} onResetStep={onResetStep} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Reset Step")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Reset Step"));
    expect(onResetStep).toHaveBeenCalledOnce();
  });

  it("hides Reset Step button when onResetStep is not provided", async () => {
    render(<WorkflowStepComplete {...researchProps} />);

    await waitFor(() => {
      expect(
        screen.getByText("Clarifications not found in database"),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("Reset Step")).not.toBeInTheDocument();
  });

  it("does not render StepActionBar (Next Step) in missing-files error state", async () => {
    const onNextStep = vi.fn();

    render(
      <WorkflowStepComplete
        {...researchProps}
        onNextStep={onNextStep}
        isLastStep={false}
        reviewMode={false}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Clarifications not found in database"),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("Next Step")).not.toBeInTheDocument();
  });
});

describe("WorkflowStepComplete — decisions step conflict resolution flow", () => {
  const decisionsJson = JSON.stringify({
    version: "1",
    metadata: {
      decision_count: 2,
      conflicts_resolved: 0,
      round: 1,
      contradictory_inputs: true,
    },
    decisions: [
      {
        id: "D1",
        title: "Capability",
        original_question: "What should this skill enable Claude to do?",
        decision: "Draft capability text",
        implication: "Needs user confirmation before generation",
        status: "needs-review",
      },
      {
        id: "D2",
        title: "Trigger",
        original_question: "When should this skill trigger?",
        decision: "Trigger on planning requests",
        implication: "Used to draft the skill description",
        status: "resolved",
      },
    ],
  });

  const decisionsProps = {
    stepName: "Confirm Decisions",
    stepId: 2,
    outputFiles: ["context/decisions.json"],
    skillName: "my-skill",
    workspacePath: "/workspace",
    skillsPath: "/skills",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStepAgentRuns.mockResolvedValue([]);
    mockUseClarifications.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
    });
    mockUseDecisions.mockReturnValue({
      data: decisionsDtoFixture,
      isLoading: false,
      isError: false,
    });
    mockGetContextFileContent.mockImplementation(
      (_skillName: string, _workspacePath: string, relativePath: string) => {
        if (relativePath === "decisions.json")
          return Promise.resolve(decisionsJson);
        return Promise.resolve(null);
      },
    );
  });

  it("shows an explicit blocked Generate Skill action instead of Done when the next step is blocked", async () => {
    render(
      <WorkflowStepComplete
        {...decisionsProps}
        nextStepBlocked
        nextStepLabel="Generate Skill"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Generate Skill" }),
      ).toBeInTheDocument();
    });

    const lockedButton = screen.getByRole("button", { name: "Generate Skill" });
    expect(lockedButton).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Done" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Generate Skill is blocked until you review the decisions marked needs-review below.",
      ),
    ).not.toBeInTheDocument();
  });

  it("shows Next Step when the next step is available", async () => {
    const onNextStep = vi.fn();

    render(
      <WorkflowStepComplete {...decisionsProps} onNextStep={onNextStep} />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Next Step" }),
      ).toBeInTheDocument();
    });
  });

  it("renders decisions and can rerender into an unblocked next-step state", async () => {
    const { rerender } = render(
      <WorkflowStepComplete
        {...decisionsProps}
        nextStepBlocked
        nextStepLabel="Generate Skill"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Capability")).toBeInTheDocument();
    });

    rerender(
      <WorkflowStepComplete
        {...decisionsProps}
        nextStepBlocked={false}
        nextStepLabel="Generate Skill"
        onNextStep={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Next Step" }),
      ).toBeInTheDocument();
    });
  });

  it("passes the numeric skill id to the decisions query for step 2", async () => {
    render(<WorkflowStepComplete {...decisionsProps} skillId={2740} />);

    await waitFor(() => {
      expect(mockUseDecisions).toHaveBeenCalledWith("2740");
    });
  });
});

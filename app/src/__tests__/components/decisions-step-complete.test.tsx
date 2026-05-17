import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, act, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/query-test-utils";
import { useWorkflowStore } from "@/stores/workflow-store";

// ─── Tauri mock ──────────────────────────────────────────────────────────────

vi.mock("@/lib/tauri", () => ({
  invokeCommand: vi.fn(),
  getDisabledSteps: vi.fn(),
  logFrontend: vi.fn(),
}));

import { invokeCommand, getDisabledSteps } from "@/lib/tauri";

// ─── decisions-summary-card mock — exposes a trigger button ─────────────────

const mockOnDecisionsChange = vi.hoisted(() => vi.fn());
vi.mock("@/components/decisions-summary-card", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/decisions-summary-card")>();
  return {
    ...real,
    DecisionsSummaryCard: ({ onDecisionsChange }: { onDecisionsChange?: (s: string) => void }) => {
      mockOnDecisionsChange.mockImplementation((s: string) => onDecisionsChange?.(s));
      return <button data-testid="trigger-save" onClick={() => onDecisionsChange?.(
        JSON.stringify({
          decisions: [{
            id: "d1",
            title: "Revenue tracking",
            original_question: "How to track?",
            decision: "Use ARR",
            implication: "Updated",
            status: "revised",
          }],
        })
      )}>Trigger Save</button>;
    },
  };
});

// ─── StepActionBar mock — renders a simple indicator ─────────────────────────

vi.mock("@/components/step-complete/step-action-bar", () => ({
  StepActionBar: ({ nextStepBlocked }: { nextStepBlocked?: boolean }) => (
    <button data-testid="next-step-button" disabled={!!nextStepBlocked}>
      {nextStepBlocked ? "Blocked" : "Next Step"}
    </button>
  ),
}));

// ─── AgentStatsBar mock ──────────────────────────────────────────────────────

vi.mock("@/components/agent-stats-bar", () => ({
  AgentStatsBar: () => <div data-testid="agent-stats-bar" />,
}));

// ─── Import under test AFTER mocks ───────────────────────────────────────────

import { DecisionsStepComplete } from "@/components/step-complete/decisions-step-complete";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SKILL_NAME = "test-skill";

const DECISIONS_DTO = {
  version: "1",
  decision_count: 1,
  conflicts_resolved: 0,
  round: 1,
  contradictory_inputs_state: "active",
  items: [{
    decision_id: "d1",
    ordinal: 0,
    title: "Revenue tracking",
    original_question: "How to track?",
    decision: "Use ARR",
    implication: "Needs update",
    status: "needs-review",
  }],
};

function renderDecisionsStep({ nextStepBlocked = true }: { nextStepBlocked?: boolean } = {}) {
  return renderWithQueryClient(
    <DecisionsStepComplete
      skillId={42}
      skillName={SKILL_NAME}
      stepName="Design Decisions"
      conversationRuns={[]}
      reviewMode={false}
      isLastStep={false}
      nextStepBlocked={nextStepBlocked}
      nextStepLabel="Generate Skill"
      onNextStep={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("DecisionsStepComplete — disabled-steps refresh after decisions save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkflowStore.getState().reset();
    useWorkflowStore.getState().setDisabledSteps([3]);

    vi.mocked(invokeCommand).mockImplementation(async (command) => {
      if (command === "get_decisions") return DECISIONS_DTO;
      if (command === "save_decisions_edit") return undefined;
      return undefined;
    });

    vi.mocked(getDisabledSteps).mockResolvedValue([]);
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
  });

  it("calls getDisabledSteps after decisions save and clears the block in the workflow store", async () => {
    renderDecisionsStep();

    // Wait for decisions to load
    await waitFor(() => expect(screen.getByTestId("trigger-save")).toBeInTheDocument());

    // Trigger save (simulates user blurring an edited decision field)
    await act(async () => {
      screen.getByTestId("trigger-save").click();
    });

    // After save, getDisabledSteps must be called with the numeric skill id
    await waitFor(() => {
      expect(vi.mocked(getDisabledSteps)).toHaveBeenCalledWith(42);
    });

    // The workflow store's disabledSteps must be cleared
    expect(useWorkflowStore.getState().disabledSteps).toEqual([]);
  });

  it("does not call getDisabledSteps when skillName is absent", async () => {
    renderWithQueryClient(
      <DecisionsStepComplete
        skillName={undefined}
        stepName="Design Decisions"
        conversationRuns={[]}
        reviewMode={false}
        isLastStep={false}
        nextStepBlocked={true}
        onNextStep={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(vi.mocked(getDisabledSteps)).not.toHaveBeenCalled();
  });
});

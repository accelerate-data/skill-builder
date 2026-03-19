import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowSidebar } from "@/components/workflow-sidebar";

// Steps use canonical IDs 0-3 — sidebar resolves display names from WORKFLOW_STEP_DEFINITIONS.
const steps = [
  { id: 0, name: "Research", description: "Research inputs", status: "completed" },
  { id: 1, name: "Detailed Research", description: "Detailed research", status: "in_progress" },
  { id: 2, name: "Confirm Decisions", description: "Confirm decisions", status: "waiting_for_user" },
  { id: 3, name: "Generate Skill", description: "Generate skill", status: "error" },
] as const;

describe("WorkflowSidebar", () => {
  it("renders workflow steps and highlights the current step", () => {
    render(<WorkflowSidebar steps={[...steps]} currentStep={1} />);

    expect(screen.getByText("Steps")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2\. Detailed Research/i })).toHaveClass("bg-accent");
  });

  it("allows clicking completed steps only when a click handler is provided", async () => {
    const user = userEvent.setup({ delay: null });
    const onStepClick = vi.fn();

    render(<WorkflowSidebar steps={[...steps]} currentStep={1} onStepClick={onStepClick} />);

    const completedStep = screen.getByRole("button", { name: /1\. Research/i });
    const waitingStep = screen.getByRole("button", { name: /3\. Confirm Decisions/i });

    expect(completedStep).toBeEnabled();
    expect(waitingStep).toBeDisabled();

    await user.click(completedStep);
    await user.click(waitingStep);

    expect(onStepClick).toHaveBeenCalledTimes(1);
    expect(onStepClick).toHaveBeenCalledWith(0);
  });

  it("marks disabled steps as skipped and blocks navigation", async () => {
    const user = userEvent.setup({ delay: null });
    const onStepClick = vi.fn();

    render(
      <WorkflowSidebar
        steps={[...steps]}
        currentStep={1}
        onStepClick={onStepClick}
        disabledSteps={[0, 2]}
      />,
    );

    const skippedButtons = screen.getAllByText("Skipped");
    const skippedCompletedStep = screen.getByRole("button", { name: /1\. Research/i });

    expect(skippedButtons).toHaveLength(2);
    expect(skippedCompletedStep).toBeDisabled();
    expect(skippedCompletedStep).toHaveClass("cursor-not-allowed");

    await user.click(skippedCompletedStep);

    expect(onStepClick).not.toHaveBeenCalled();
  });

  it("shows canonical step name even when store step.name has been mutated (benchmark phase)", () => {
    // Simulate what happens when updateStepLabel(3, "Benchmark Skill", ...) is called:
    // the store step.name becomes "Benchmark Skill", but the sidebar must still show "Generate Skill".
    const stepsWithMutatedLabel = [
      { id: 0, name: "Research", description: "", status: "completed" },
      { id: 1, name: "Detailed Research", description: "", status: "completed" },
      { id: 2, name: "Confirm Decisions", description: "", status: "completed" },
      { id: 3, name: "Benchmark Skill", description: "Running evaluations and grading results", status: "in_progress" },
    ] as const;

    render(<WorkflowSidebar steps={[...stepsWithMutatedLabel]} currentStep={3} />);

    // Sidebar must show the canonical name, not the mutated runtime label
    expect(screen.getByRole("button", { name: /4\. Generate Skill/i })).toBeInTheDocument();
    expect(screen.queryByText(/Benchmark Skill/i)).not.toBeInTheDocument();
  });
});

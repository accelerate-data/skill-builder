import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowSidebar } from "@/components/workflow-sidebar";

const steps = [
  { id: 0, name: "Prepare", description: "Prepare inputs", status: "completed" },
  { id: 1, name: "Review", description: "Review outputs", status: "in_progress" },
  { id: 2, name: "Approve", description: "Approve changes", status: "waiting_for_user" },
  { id: 3, name: "Ship", description: "Ship result", status: "error" },
] as const;

describe("WorkflowSidebar", () => {
  it("renders workflow steps and highlights the current step", () => {
    render(<WorkflowSidebar steps={[...steps]} currentStep={1} />);

    expect(screen.getByText("Workflow Steps")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2\. Review/i })).toHaveClass("bg-accent");
  });

  it("allows clicking completed steps only when a click handler is provided", async () => {
    const user = userEvent.setup({ delay: null });
    const onStepClick = vi.fn();

    render(<WorkflowSidebar steps={[...steps]} currentStep={1} onStepClick={onStepClick} />);

    const completedStep = screen.getByRole("button", { name: /1\. Prepare/i });
    const waitingStep = screen.getByRole("button", { name: /3\. Approve/i });

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
    const skippedCompletedStep = screen.getByRole("button", { name: /1\. Prepare/i });

    expect(skippedButtons).toHaveLength(2);
    expect(skippedCompletedStep).toBeDisabled();
    expect(skippedCompletedStep).toHaveClass("cursor-not-allowed");

    await user.click(skippedCompletedStep);

    expect(onStepClick).not.toHaveBeenCalled();
  });
});

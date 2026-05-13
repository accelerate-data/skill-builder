import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReconciliationAckDialog from "@/components/reconciliation-ack-dialog";

describe("ReconciliationAckDialog", () => {
  it("renders notifications", () => {
    render(
      <ReconciliationAckDialog
        notifications={["Database updated", "Workspace synced"]}
        open={true}
        requireApply={false}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Startup Reconciliation")).toBeInTheDocument();
    expect(screen.getByText("Database updated")).toBeInTheDocument();
    expect(screen.getByText("Workspace synced")).toBeInTheDocument();
  });

  it("calls onApply when acknowledge is clicked", async () => {
    const user = userEvent.setup({ delay: null });
    const onApply = vi.fn();

    render(
      <ReconciliationAckDialog
        notifications={["Something changed"]}
        open={true}
        requireApply={false}
        onApply={onApply}
        onCancel={vi.fn()}
      />,
    );

    const acknowledgeButton = screen.getByRole("button", { name: /Acknowledge/i });
    await user.click(acknowledgeButton);

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("shows apply/cancel buttons when requireApply is true", async () => {
    const user = userEvent.setup({ delay: null });
    const onApply = vi.fn();
    const onCancel = vi.fn();

    render(
      <ReconciliationAckDialog
        notifications={["Something changed"]}
        open={true}
        requireApply={true}
        onApply={onApply}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("button", { name: /Continue Without Applying/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Apply Reconciliation/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Continue Without Applying/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables apply button when applying is true", () => {
    render(
      <ReconciliationAckDialog
        notifications={["Something changed"]}
        open={true}
        requireApply={true}
        applying={true}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const applyButton = screen.getByRole("button", { name: /Applying/i });
    expect(applyButton).toBeDisabled();
  });

  it("calls onCancel when apply is required and the user continues without applying", async () => {
    const user = userEvent.setup({ delay: null });
    const onCancel = vi.fn();

    render(
      <ReconciliationAckDialog
        notifications={[]}
        open={true}
        requireApply={true}
        onApply={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Continue Without Applying/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReconciliationAckDialog from "@/components/reconciliation-ack-dialog";

const resolveDiscoveryMock = vi.fn();

vi.mock("@/lib/tauri", () => ({
  resolveDiscovery: (...args: unknown[]) => resolveDiscoveryMock(...args),
}));

describe("ReconciliationAckDialog", () => {
  beforeEach(() => {
    resolveDiscoveryMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders notifications and discovered skill descriptions", () => {
    render(
      <ReconciliationAckDialog
        notifications={["Database updated", "Workspace synced"]}
        discoveredSkills={[
          { name: "full-skill", detected_step: 5, scenario: "9b" },
          { name: "partial-skill", detected_step: 2, scenario: "7a" },
        ]}
        open={true}
        requireApply={true}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Startup Reconciliation")).toBeInTheDocument();
    expect(screen.getByText("Database updated")).toBeInTheDocument();
    expect(screen.getByText("Workspace synced")).toBeInTheDocument();
    expect(screen.getByText("Complete skill with all artifacts")).toBeInTheDocument();
    expect(screen.getByText("Skill with partial artifacts")).toBeInTheDocument();
  });

  it("uses scenario-specific add actions and enables apply after all discoveries are resolved", async () => {
    const user = userEvent.setup({ delay: null });
    const onApply = vi.fn();
    resolveDiscoveryMock.mockResolvedValue(undefined);

    render(
      <ReconciliationAckDialog
        notifications={[]}
        discoveredSkills={[
          { name: "full-skill", detected_step: 5, scenario: "9b" },
          { name: "partial-skill", detected_step: 2, scenario: "7a" },
        ]}
        open={true}
        requireApply={true}
        onApply={onApply}
        onCancel={vi.fn()}
      />,
    );

    const applyButton = screen.getByRole("button", { name: /Apply Reconciliation/i });
    expect(applyButton).toBeDisabled();

    const addButtons = screen.getAllByRole("button", { name: /Add to Library/i });
    await user.click(addButtons[0]);
    await user.click(addButtons[1]);

    await waitFor(() => {
      expect(resolveDiscoveryMock).toHaveBeenNthCalledWith(1, "full-skill", "add-skill-builder");
      expect(resolveDiscoveryMock).toHaveBeenNthCalledWith(2, "partial-skill", "add-imported");
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Add to Library/i })).not.toBeInTheDocument();
      expect(applyButton).toBeEnabled();
    });

    await user.click(applyButton);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("restores pending state after a failed resolution attempt", async () => {
    const user = userEvent.setup({ delay: null });
    resolveDiscoveryMock.mockRejectedValue(new Error("Disk error"));

    render(
      <ReconciliationAckDialog
        notifications={[]}
        discoveredSkills={[{ name: "partial-skill", detected_step: 2, scenario: "7a" }]}
        open={true}
        requireApply={false}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const acknowledgeButton = screen.getByRole("button", { name: /Acknowledge/i });
    expect(acknowledgeButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Remove/i }));

    await waitFor(() => {
      expect(resolveDiscoveryMock).toHaveBeenCalledWith("partial-skill", "remove");
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add to Library/i })).toBeEnabled();
      expect(screen.getByRole("button", { name: /Remove/i })).toBeEnabled();
      expect(acknowledgeButton).toBeDisabled();
    });
  });

  it("calls onCancel when apply is required and the user continues without applying", async () => {
    const user = userEvent.setup({ delay: null });
    const onCancel = vi.fn();

    render(
      <ReconciliationAckDialog
        notifications={[]}
        discoveredSkills={[]}
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

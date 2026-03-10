import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, resetTauriMocks } from "@/test/mocks/tauri";
import { toast } from "@/lib/toast";

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

import ResetStepDialog from "@/components/reset-step-dialog";

const mockPreview = [
  { step_id: 1, step_name: "Detailed Research", files: ["context/clarifications.json"] },
  { step_id: 2, step_name: "Confirm Decisions", files: ["context/decisions.json"] },
];

describe("ResetStepDialog", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "preview_step_reset") return Promise.resolve(mockPreview);
      if (cmd === "reset_workflow_step") return Promise.resolve(undefined);
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });
  });

  it("renders dialog when open", async () => {
    render(
      <ResetStepDialog
        targetStep={2}
        workspacePath="/workspace"
        skillName="test-skill"
        open={true}
        onOpenChange={vi.fn()}
        onReset={vi.fn()}
      />
    );
    expect(screen.getByText("Reset to Earlier Step")).toBeInTheDocument();
  });

  it("shows artifact preview grouped by step", async () => {
    render(
      <ResetStepDialog
        targetStep={2}
        workspacePath="/workspace"
        skillName="test-skill"
        open={true}
        onOpenChange={vi.fn()}
        onReset={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByText("Detailed Research")).toBeInTheDocument();
      expect(screen.getByText("context/clarifications.json")).toBeInTheDocument();
      expect(screen.getByText("Confirm Decisions")).toBeInTheDocument();
      expect(screen.getByText("context/decisions.json")).toBeInTheDocument();
    });
  });

  it("does not render when open is false", () => {
    render(
      <ResetStepDialog
        targetStep={2}
        workspacePath="/workspace"
        skillName="test-skill"
        open={false}
        onOpenChange={vi.fn()}
        onReset={vi.fn()}
      />
    );
    expect(screen.queryByText("Reset to Earlier Step")).not.toBeInTheDocument();
  });

  it("calls reset and callbacks on confirm", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onReset = vi.fn();

    render(
      <ResetStepDialog
        targetStep={2}
        workspacePath="/workspace"
        skillName="test-skill"
        open={true}
        onOpenChange={onOpenChange}
        onReset={onReset}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Detailed Research")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Reset/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("reset_workflow_step", {
        workspacePath: "/workspace",
        skillName: "test-skill",
        fromStepId: 2,
      });
    });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onReset).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith("Workflow reset successfully");
    });
  });

  it("calls onOpenChange(false) on cancel", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <ResetStepDialog
        targetStep={2}
        workspacePath="/workspace"
        skillName="test-skill"
        open={true}
        onOpenChange={onOpenChange}
        onReset={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows empty state when no files exist", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "preview_step_reset") return Promise.resolve([]);
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });

    render(
      <ResetStepDialog
        targetStep={2}
        workspacePath="/workspace"
        skillName="test-skill"
        open={true}
        onOpenChange={vi.fn()}
        onReset={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/No files to delete/)).toBeInTheDocument();
    });
  });

  it("shows error toast on failed reset", async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "preview_step_reset") return Promise.resolve(mockPreview);
      if (cmd === "reset_workflow_step") return Promise.reject(new Error("DB locked"));
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });

    render(
      <ResetStepDialog
        targetStep={2}
        workspacePath="/workspace"
        skillName="test-skill"
        open={true}
        onOpenChange={vi.fn()}
        onReset={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Detailed Research")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Reset/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to reset: DB locked",
        { duration: Infinity },
      );
    });
  });
});

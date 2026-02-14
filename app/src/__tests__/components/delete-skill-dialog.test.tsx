import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, resetTauriMocks } from "@/test/mocks/tauri";
import { toast } from "sonner";

// Mock sonner
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

import DeleteSkillDialog from "@/components/delete-skill-dialog";
import type { SkillSummary } from "@/lib/types";

const sampleSkill: SkillSummary = {
  name: "sales-pipeline",
  domain: "sales",
  current_step: "Step 3",
  status: "in_progress",
  last_modified: new Date().toISOString(),
  tags: [],
  skill_type: null,
  author_login: null,
  author_avatar: null,
};

describe("DeleteSkillDialog", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("renders dialog title when open", () => {
    render(
      <DeleteSkillDialog
        skill={sampleSkill}
        workspacePath="/workspace"
        open={true}
        onOpenChange={vi.fn()}
        onDeleted={vi.fn()}
      />
    );
    expect(screen.getByText("Delete Skill")).toBeInTheDocument();
  });

  it("renders skill name in confirmation text", () => {
    render(
      <DeleteSkillDialog
        skill={sampleSkill}
        workspacePath="/workspace"
        open={true}
        onOpenChange={vi.fn()}
        onDeleted={vi.fn()}
      />
    );
    expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    expect(
      screen.getByText(/permanently remove all files/)
    ).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(
      <DeleteSkillDialog
        skill={sampleSkill}
        workspacePath="/workspace"
        open={false}
        onOpenChange={vi.fn()}
        onDeleted={vi.fn()}
      />
    );
    expect(screen.queryByText("Delete Skill")).not.toBeInTheDocument();
  });

  it("has Cancel and Delete buttons", () => {
    render(
      <DeleteSkillDialog
        skill={sampleSkill}
        workspacePath="/workspace"
        open={true}
        onOpenChange={vi.fn()}
        onDeleted={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: /Cancel/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Delete/i })
    ).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <DeleteSkillDialog
        skill={sampleSkill}
        workspacePath="/workspace"
        open={true}
        onOpenChange={onOpenChange}
        onDeleted={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls invoke delete_skill and callbacks on successful delete", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onDeleted = vi.fn();
    mockInvoke.mockResolvedValue(undefined);

    render(
      <DeleteSkillDialog
        skill={sampleSkill}
        workspacePath="/workspace"
        open={true}
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
      />
    );

    await user.click(screen.getByRole("button", { name: /Delete/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("delete_skill", {
        workspacePath: "/workspace",
        name: "sales-pipeline",
      });
    });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(onDeleted).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      'Skill "sales-pipeline" deleted'
    );
  });

  it("shows error toast on failed delete", async () => {
    const user = userEvent.setup();
    mockInvoke.mockRejectedValue(new Error("Permission denied"));

    render(
      <DeleteSkillDialog
        skill={sampleSkill}
        workspacePath="/workspace"
        open={true}
        onOpenChange={vi.fn()}
        onDeleted={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Delete/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to delete skill: Permission denied",
        { duration: Infinity },
      );
    });
  });

  it("handles null skill gracefully", () => {
    render(
      <DeleteSkillDialog
        skill={null}
        workspacePath="/workspace"
        open={true}
        onOpenChange={vi.fn()}
        onDeleted={vi.fn()}
      />
    );
    // Dialog still renders but skill name area is empty
    expect(screen.getByText("Delete Skill")).toBeInTheDocument();
  });
});

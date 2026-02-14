import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, resetTauriMocks } from "@/test/mocks/tauri";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

import EditTagsDialog from "@/components/edit-tags-dialog";
import type { SkillSummary } from "@/lib/types";

const sampleSkill: SkillSummary = {
  name: "sales-pipeline",
  domain: "sales",
  current_step: "Step 3",
  status: "in_progress",
  last_modified: new Date().toISOString(),
  tags: ["analytics", "crm"],
  skill_type: null,
  author_login: null,
  author_avatar: null,
};

describe("EditTagsDialog", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("renders dialog title when open", () => {
    render(
      <EditTagsDialog
        skill={sampleSkill}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        availableTags={[]}
      />
    );
    expect(screen.getByText("Edit Tags")).toBeInTheDocument();
  });

  it("renders skill name in description", () => {
    render(
      <EditTagsDialog
        skill={sampleSkill}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        availableTags={[]}
      />
    );
    expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(
      <EditTagsDialog
        skill={sampleSkill}
        open={false}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        availableTags={[]}
      />
    );
    expect(screen.queryByText("Edit Tags")).not.toBeInTheDocument();
  });

  it("shows existing tags as badges", () => {
    render(
      <EditTagsDialog
        skill={sampleSkill}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        availableTags={[]}
      />
    );
    expect(screen.getByText("analytics")).toBeInTheDocument();
    expect(screen.getByText("crm")).toBeInTheDocument();
  });

  it("has Cancel and Save buttons", () => {
    render(
      <EditTagsDialog
        skill={sampleSkill}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        availableTags={[]}
      />
    );
    expect(screen.getByRole("button", { name: /Cancel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save/i })).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <EditTagsDialog
        skill={sampleSkill}
        open={true}
        onOpenChange={onOpenChange}
        onSaved={vi.fn()}
        availableTags={[]}
      />
    );

    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls updateSkillTags and callbacks on successful save", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    mockInvoke.mockResolvedValue(undefined);

    render(
      <EditTagsDialog
        skill={sampleSkill}
        open={true}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
        availableTags={[]}
      />
    );

    await user.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("update_skill_tags", {
        skillName: "sales-pipeline",
        tags: ["analytics", "crm"],
      });
    });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(onSaved).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Tags updated");
  });

  it("shows error toast on failed save", async () => {
    const user = userEvent.setup();
    mockInvoke.mockRejectedValue(new Error("DB error"));

    render(
      <EditTagsDialog
        skill={sampleSkill}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        availableTags={[]}
      />
    );

    await user.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to update tags: DB error",
        { duration: Infinity },
      );
    });
  });

  it("handles null skill gracefully", () => {
    render(
      <EditTagsDialog
        skill={null}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        availableTags={[]}
      />
    );
    expect(screen.getByText("Edit Tags")).toBeInTheDocument();
  });
});

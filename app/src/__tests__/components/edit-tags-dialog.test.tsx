import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, resetTauriMocks } from "@/test/mocks/tauri";
import { toast } from "sonner";
import { useSettingsStore } from "@/stores/settings-store";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

import SkillDialog from "@/components/skill-dialog";
import type { SkillSummary } from "@/lib/types";

const sampleSkill: SkillSummary = {
  name: "sales-pipeline",
  current_step: "Step 3",
  status: "in_progress",
  last_modified: new Date().toISOString(),
  tags: ["analytics", "crm"],
  purpose: "domain",
  author_login: null,
  author_avatar: null,
  intake_json: null,
  description: "A skill for managing sales pipelines",
};

/** Navigate to step 2 by clicking Next */
async function goToStep2(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Next/i }));
}

describe("SkillDialog (edit mode)", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    useSettingsStore.getState().reset();
    useSettingsStore.getState().setSettings({ workspacePath: "/test/workspace" });
  });

  it("renders dialog title when open", () => {
    render(
      <SkillDialog
        mode="edit"
        skill={sampleSkill}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        tagSuggestions={[]}
      />
    );
    expect(screen.getByText("Edit Skill")).toBeInTheDocument();
  });

  it("shows step 1 description by default", () => {
    render(
      <SkillDialog
        mode="edit"
        skill={sampleSkill}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        tagSuggestions={[]}
      />
    );
    expect(screen.getByText("Update name, purpose, and description.")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(
      <SkillDialog
        mode="edit"
        skill={sampleSkill}
        open={false}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        tagSuggestions={[]}
      />
    );
    expect(screen.queryByText("Edit Skill")).not.toBeInTheDocument();
  });

  it("shows existing tags as badges on step 1", () => {
    render(
      <SkillDialog
        mode="edit"
        skill={sampleSkill}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        tagSuggestions={[]}
      />
    );
    expect(screen.getByText("analytics")).toBeInTheDocument();
    expect(screen.getByText("crm")).toBeInTheDocument();
  });

  it("has Cancel and Next buttons on step 1", () => {
    render(
      <SkillDialog
        mode="edit"
        skill={sampleSkill}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        tagSuggestions={[]}
      />
    );
    expect(screen.getByRole("button", { name: /Cancel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/i })).toBeInTheDocument();
  });

  it("has Back and Save buttons on step 2 (no Skip)", async () => {
    const user = userEvent.setup();
    render(
      <SkillDialog
        mode="edit"
        skill={sampleSkill}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        tagSuggestions={[]}
      />
    );
    await goToStep2(user);
    expect(screen.getByRole("button", { name: /Back/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Skip/i })).not.toBeInTheDocument();
  });

  it("calls onOpenChange(false) when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <SkillDialog
        mode="edit"
        skill={sampleSkill}
        open={true}
        onOpenChange={onOpenChange}
        onSaved={vi.fn()}
        tagSuggestions={[]}
      />
    );

    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("navigates between steps with Next and Back", async () => {
    const user = userEvent.setup();
    render(
      <SkillDialog
        mode="edit"
        skill={sampleSkill}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        tagSuggestions={[]}
      />
    );

    // Step 1
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Skill Name/)).toBeInTheDocument();

    // Go to step 2
    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Version")).toBeInTheDocument();

    // Go back to step 1
    await user.click(screen.getByRole("button", { name: /Back/i }));
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
  });

  it("calls update_skill_metadata and callbacks on successful save from step 2", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    mockInvoke.mockResolvedValue(undefined);

    render(
      <SkillDialog
        mode="edit"
        skill={sampleSkill}
        open={true}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
        tagSuggestions={[]}
      />
    );

    await goToStep2(user);
    await user.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("update_skill_metadata", {
        skillName: "sales-pipeline",
        purpose: "domain",
        tags: ["analytics", "crm"],
        intakeJson: null,
        description: "A skill for managing sales pipelines",
        version: "1.0.0",
        model: null,
        argumentHint: null,
        userInvocable: true,
        disableModelInvocation: false,
      });
    });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(onSaved).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Skill updated");
  });

  it("shows error toast on failed save", async () => {
    const user = userEvent.setup();
    mockInvoke.mockRejectedValue(new Error("DB error"));

    render(
      <SkillDialog
        mode="edit"
        skill={sampleSkill}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        tagSuggestions={[]}
      />
    );

    await goToStep2(user);
    await user.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to update skill: DB error",
        { duration: Infinity },
      );
    });
  });

  it("handles null skill gracefully", () => {
    render(
      <SkillDialog
        mode="edit"
        skill={null}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        tagSuggestions={[]}
      />
    );
    expect(screen.getByText("Edit Skill")).toBeInTheDocument();
  });

  it("shows skill name input pre-filled with current name", () => {
    render(
      <SkillDialog
        mode="edit"
        skill={sampleSkill}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        tagSuggestions={[]}
      />
    );
    expect(screen.getByLabelText(/^Skill Name/)).toHaveValue("sales-pipeline");
  });

  it("shows purpose dropdown on step 1", () => {
    render(
      <SkillDialog
        mode="edit"
        skill={sampleSkill}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        tagSuggestions={[]}
      />
    );
    expect(screen.getByLabelText(/What are you trying to capture/)).toBeInTheDocument();
  });

  it("shows context questions field on step 1", () => {
    render(
      <SkillDialog
        mode="edit"
        skill={sampleSkill}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        tagSuggestions={[]}
      />
    );
    expect(screen.getByLabelText("What Claude needs to know")).toBeInTheDocument();
  });

  it("pre-fills context from intake_json", () => {
    const skillWithIntake: SkillSummary = {
      ...sampleSkill,
      intake_json: JSON.stringify({ context: "Custom setup details" }),
    };
    render(
      <SkillDialog
        mode="edit"
        skill={skillWithIntake}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        tagSuggestions={[]}
      />
    );
    expect(screen.getByLabelText("What Claude needs to know")).toHaveValue("Custom setup details");
  });

  // --- isLocked prop ---

  describe("isLocked", () => {
    it("shows lock banner when isLocked is true", () => {
      render(
        <SkillDialog
          mode="edit"
          skill={sampleSkill}
          open={true}
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
          tagSuggestions={[]}
          isLocked={true}
        />
      );
      expect(
        screen.getByText("This skill is being edited in another window")
      ).toBeInTheDocument();
    });

    it("disables Next button on step 1 when isLocked is true", () => {
      render(
        <SkillDialog
          mode="edit"
          skill={sampleSkill}
          open={true}
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
          tagSuggestions={[]}
          isLocked={true}
        />
      );
      expect(screen.getByRole("button", { name: /Next/i })).toBeDisabled();
    });

    it("disables Save button on step 2 when isLocked is true", async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <SkillDialog
          mode="edit"
          skill={sampleSkill}
          open={true}
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
          tagSuggestions={[]}
          isLocked={false}
        />
      );
      await goToStep2(user);
      rerender(
        <SkillDialog
          mode="edit"
          skill={sampleSkill}
          open={true}
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
          tagSuggestions={[]}
          isLocked={true}
        />
      );
      expect(screen.getByRole("button", { name: /Save/i })).toBeDisabled();
    });

    it("does not invoke save when isLocked is true and Save is clicked", async () => {
      const user = userEvent.setup();
      mockInvoke.mockResolvedValue(undefined);

      const { rerender } = render(
        <SkillDialog
          mode="edit"
          skill={sampleSkill}
          open={true}
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
          tagSuggestions={[]}
          isLocked={false}
        />
      );
      await goToStep2(user);
      rerender(
        <SkillDialog
          mode="edit"
          skill={sampleSkill}
          open={true}
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
          tagSuggestions={[]}
          isLocked={true}
        />
      );

      const saveBtn = screen.getByRole("button", { name: /Save/i });
      expect(saveBtn).toBeDisabled();
      await user.click(saveBtn);

      expect(mockInvoke).not.toHaveBeenCalledWith(
        "update_skill_metadata",
        expect.anything()
      );
    });
  });

  describe("rename flow", () => {
    it("calls rename_skill before update_skill_metadata when name changes", async () => {
      const user = userEvent.setup();
      const onSaved = vi.fn();
      mockInvoke.mockResolvedValue(undefined);

      render(
        <SkillDialog
        mode="edit"
          skill={sampleSkill}
          open={true}
          onOpenChange={vi.fn()}
          onSaved={onSaved}
          tagSuggestions={[]}
        />
      );

      const nameInput = screen.getByLabelText(/^Skill Name/);
      await user.clear(nameInput);
      await user.type(nameInput, "revenue-tracker");

      // Navigate to step 2 to access Save
      await goToStep2(user);
      await user.click(screen.getByRole("button", { name: /Save/i }));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("rename_skill", {
          oldName: "sales-pipeline",
          newName: "revenue-tracker",
          workspacePath: "/test/workspace",
        });
      });

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("update_skill_metadata", expect.objectContaining({
          skillName: "revenue-tracker",
        }));
      });

      // Verify rename_skill was called before update_skill_metadata
      const calls = mockInvoke.mock.calls.map((c) => c[0]);
      const renameIndex = calls.indexOf("rename_skill");
      const updateIndex = calls.indexOf("update_skill_metadata");
      expect(renameIndex).toBeLessThan(updateIndex);
    });

    it("does not call rename_skill when name is unchanged", async () => {
      const user = userEvent.setup();
      const onSaved = vi.fn();
      mockInvoke.mockResolvedValue(undefined);

      render(
        <SkillDialog
        mode="edit"
          skill={sampleSkill}
          open={true}
          onOpenChange={vi.fn()}
          onSaved={onSaved}
          tagSuggestions={[]}
        />
      );

      await goToStep2(user);
      await user.click(screen.getByRole("button", { name: /Save/i }));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("update_skill_metadata", expect.objectContaining({
          skillName: "sales-pipeline",
        }));
      });

      expect(mockInvoke).not.toHaveBeenCalledWith(
        "rename_skill",
        expect.anything()
      );
    });
  });
});

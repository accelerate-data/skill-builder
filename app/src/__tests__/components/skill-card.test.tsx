import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SkillCard, {
  parseStepProgress,
  isWorkflowComplete,
} from "@/components/skill-card";
import type { SkillSummary } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const createdComplete: SkillSummary = {
  name: "my-skill",
  current_step: null,
  status: "completed",
  last_modified: null,
  tags: [],
  purpose: "skill-builder",
  skill_source: "skill-builder",
  author_login: null,
  author_avatar: null,
  intake_json: null,
  source: "created",
};

const createdIncomplete: SkillSummary = {
  ...createdComplete,
  status: "running",
  current_step: "step 2",
};

const marketplaceSkill: SkillSummary = {
  ...createdComplete,
  skill_source: "marketplace",
  source: "marketplace",
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderCard(
  skill: SkillSummary,
  overrides: Partial<React.ComponentProps<typeof SkillCard>> = {}
) {
  const onContinue = vi.fn();
  const onDelete = vi.fn();
  const onDownload = vi.fn();
  const onEdit = vi.fn();
  const onEditWorkflow = vi.fn();
  const onRefine = vi.fn();

  render(
    <SkillCard
      skill={skill}
      onContinue={onContinue}
      onDelete={onDelete}
      onDownload={onDownload}
      onEdit={onEdit}
      onEditWorkflow={onEditWorkflow}
      onRefine={onRefine}
      {...overrides}
    />
  );

  return { onContinue, onDelete, onDownload, onEdit, onEditWorkflow, onRefine };
}

// ---------------------------------------------------------------------------
// parseStepProgress (pure function)
// ---------------------------------------------------------------------------

describe("parseStepProgress", () => {
  it("returns 100 when status is completed", () => {
    expect(parseStepProgress(null, "completed")).toBe(100);
  });

  it("returns 0 when no step and status is not completed", () => {
    expect(parseStepProgress(null, "running")).toBe(0);
  });

  it("maps step 0 to ~17%", () => {
    expect(parseStepProgress("step 0", null)).toBe(17);
  });

  it("maps step 5 to 100%", () => {
    expect(parseStepProgress("step 5", null)).toBe(100);
  });

  it("returns 100 for current_step containing 'completed'", () => {
    expect(parseStepProgress("completed", null)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// isWorkflowComplete (pure function)
// ---------------------------------------------------------------------------

describe("isWorkflowComplete", () => {
  it("returns true when status is 'completed'", () => {
    expect(isWorkflowComplete(createdComplete)).toBe(true);
  });

  it("returns false when status is not completed and no step", () => {
    expect(isWorkflowComplete({ ...createdComplete, status: "running", current_step: null })).toBe(false);
  });

  it("returns true when current_step text is 'completed'", () => {
    expect(isWorkflowComplete({ ...createdComplete, status: "running", current_step: "completed" })).toBe(true);
  });

  it("returns true when current_step is step 5", () => {
    expect(isWorkflowComplete({ ...createdComplete, status: "running", current_step: "step 5" })).toBe(true);
  });

  it("returns false when current_step is step 2", () => {
    expect(isWorkflowComplete({ ...createdComplete, status: "running", current_step: "step 2" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SkillCard — created skill
// ---------------------------------------------------------------------------

describe("SkillCard — created skill", () => {
  it("shows Edit Workflow button", () => {
    renderCard(createdComplete);
    expect(screen.getByRole("button", { name: /Edit workflow/i })).toBeInTheDocument();
  });

  it("shows Refine button when workflow is complete", () => {
    renderCard(createdComplete);
    expect(screen.getByRole("button", { name: /Refine skill/i })).toBeInTheDocument();
  });

  it("shows Download button when workflow is complete", () => {
    renderCard(createdComplete);
    expect(screen.getByRole("button", { name: /Download skill/i })).toBeInTheDocument();
  });

  it("shows Delete button", () => {
    renderCard(createdComplete);
    expect(screen.getByRole("button", { name: /Delete skill/i })).toBeInTheDocument();
  });

  it("hides Refine button when workflow is incomplete", () => {
    renderCard(createdIncomplete);
    expect(screen.queryByRole("button", { name: /Refine skill/i })).not.toBeInTheDocument();
  });

  it("hides Download button when workflow is incomplete", () => {
    renderCard(createdIncomplete);
    expect(screen.queryByRole("button", { name: /Download skill/i })).not.toBeInTheDocument();
  });

  it("still shows Edit Workflow and Delete when incomplete", () => {
    renderCard(createdIncomplete);
    expect(screen.getByRole("button", { name: /Edit workflow/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete skill/i })).toBeInTheDocument();
  });

  it("shows progress based on current_step", () => {
    renderCard(createdIncomplete); // step 2 → 50%
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("shows 100% progress when complete", () => {
    renderCard(createdComplete);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("calls onContinue when card is clicked", async () => {
    const user = userEvent.setup();
    const { onContinue } = renderCard(createdComplete);
    await user.click(screen.getByText("my-skill"));
    expect(onContinue).toHaveBeenCalledWith(createdComplete);
  });

  it("calls onEditWorkflow when Edit Workflow button is clicked", async () => {
    const user = userEvent.setup();
    const { onEditWorkflow } = renderCard(createdComplete);
    await user.click(screen.getByRole("button", { name: /Edit workflow/i }));
    expect(onEditWorkflow).toHaveBeenCalledWith(createdComplete);
  });

  it("calls onRefine when Refine button is clicked", async () => {
    const user = userEvent.setup();
    const { onRefine } = renderCard(createdComplete);
    await user.click(screen.getByRole("button", { name: /Refine skill/i }));
    expect(onRefine).toHaveBeenCalledWith(createdComplete);
  });

  it("calls onDelete when Delete button is clicked", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderCard(createdComplete);
    await user.click(screen.getByRole("button", { name: /Delete skill/i }));
    expect(onDelete).toHaveBeenCalledWith(createdComplete);
  });

  it("shows Edit Details in context menu on right-click", () => {
    renderCard(createdComplete);
    fireEvent.contextMenu(screen.getByText("my-skill"));
    expect(screen.getByText("Edit details")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SkillCard — marketplace skill (source='marketplace')
// ---------------------------------------------------------------------------

describe("SkillCard — marketplace skill", () => {
  it("hides Edit Workflow button", () => {
    renderCard(marketplaceSkill);
    expect(screen.queryByRole("button", { name: /Edit workflow/i })).not.toBeInTheDocument();
  });

  it("shows Refine button", () => {
    renderCard(marketplaceSkill);
    expect(screen.getByRole("button", { name: /Refine skill/i })).toBeInTheDocument();
  });

  it("shows Download button", () => {
    renderCard(marketplaceSkill);
    expect(screen.getByRole("button", { name: /Download skill/i })).toBeInTheDocument();
  });

  it("shows Delete button", () => {
    renderCard(marketplaceSkill);
    expect(screen.getByRole("button", { name: /Delete skill/i })).toBeInTheDocument();
  });

  it("always shows 100% progress regardless of step data", () => {
    renderCard({ ...marketplaceSkill, status: "running", current_step: "step 1" });
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("does not show Edit Details on right-click", () => {
    renderCard(marketplaceSkill);
    fireEvent.contextMenu(screen.getByText("my-skill"));
    expect(screen.queryByText("Edit details")).not.toBeInTheDocument();
  });

  it("calls onContinue when card is clicked", async () => {
    const user = userEvent.setup();
    const { onContinue } = renderCard(marketplaceSkill);
    await user.click(screen.getByText("my-skill"));
    expect(onContinue).toHaveBeenCalledWith(marketplaceSkill);
  });

  it("calls onRefine when Refine button is clicked", async () => {
    const user = userEvent.setup();
    const { onRefine } = renderCard(marketplaceSkill);
    await user.click(screen.getByRole("button", { name: /Refine skill/i }));
    expect(onRefine).toHaveBeenCalledWith(marketplaceSkill);
  });

  it("calls onDownload when Download button is clicked", async () => {
    const user = userEvent.setup();
    const { onDownload } = renderCard(marketplaceSkill);
    await user.click(screen.getByRole("button", { name: /Download skill/i }));
    expect(onDownload).toHaveBeenCalledWith(marketplaceSkill);
  });
});

// ---------------------------------------------------------------------------
// SkillCard — null/undefined source treated as created
// ---------------------------------------------------------------------------

describe("SkillCard — null/undefined skill_source defaults to created behaviour", () => {
  it("shows Edit Workflow when skill_source is skill-builder", () => {
    renderCard({ ...createdComplete, skill_source: "skill-builder" });
    expect(screen.getByRole("button", { name: /Edit workflow/i })).toBeInTheDocument();
  });

  it("hides Edit Workflow when skill_source is null", () => {
    renderCard({ ...createdComplete, skill_source: null });
    expect(screen.queryByRole("button", { name: /Edit workflow/i })).not.toBeInTheDocument();
  });

  it("hides Edit Workflow when skill_source is undefined", () => {
    renderCard({ ...createdComplete, skill_source: undefined });
    expect(screen.queryByRole("button", { name: /Edit workflow/i })).not.toBeInTheDocument();
  });
});

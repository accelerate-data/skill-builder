import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SkillListRow from "@/components/skill-list-row";
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

function renderRow(
  skill: SkillSummary,
  overrides: Partial<React.ComponentProps<typeof SkillListRow>> = {}
) {
  const onContinue = vi.fn();
  const onDelete = vi.fn();
  const onDownload = vi.fn();
  const onEdit = vi.fn();
  const onEditWorkflow = vi.fn();
  const onRefine = vi.fn();

  // SkillListRow renders a <tr>, so it must be mounted inside a valid table context.
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  document.body.appendChild(table);

  render(
    <SkillListRow
      skill={skill}
      onContinue={onContinue}
      onDelete={onDelete}
      onDownload={onDownload}
      onEdit={onEdit}
      onEditWorkflow={onEditWorkflow}
      onRefine={onRefine}
      {...overrides}
    />,
    { container: tbody }
  );

  return { onContinue, onDelete, onDownload, onEdit, onEditWorkflow, onRefine };
}

// ---------------------------------------------------------------------------
// SkillListRow — created skill
// ---------------------------------------------------------------------------

describe("SkillListRow — created skill", () => {
  it("shows Edit Workflow button", () => {
    renderRow(createdComplete);
    expect(screen.getByRole("button", { name: /Edit workflow/i })).toBeInTheDocument();
  });

  it("shows Refine button when workflow is complete", () => {
    renderRow(createdComplete);
    expect(screen.getByRole("button", { name: /Refine skill/i })).toBeInTheDocument();
  });

  it("shows Download button when workflow is complete", () => {
    renderRow(createdComplete);
    expect(screen.getByRole("button", { name: /Download skill/i })).toBeInTheDocument();
  });

  it("shows Delete button", () => {
    renderRow(createdComplete);
    expect(screen.getByRole("button", { name: /Delete skill/i })).toBeInTheDocument();
  });

  it("shows More Actions button", () => {
    renderRow(createdComplete);
    expect(screen.getByRole("button", { name: /More actions/i })).toBeInTheDocument();
  });

  it("hides Refine when workflow is incomplete", () => {
    renderRow(createdIncomplete);
    expect(screen.queryByRole("button", { name: /Refine skill/i })).not.toBeInTheDocument();
  });

  it("hides Download when workflow is incomplete", () => {
    renderRow(createdIncomplete);
    expect(screen.queryByRole("button", { name: /Download skill/i })).not.toBeInTheDocument();
  });

  it("shows Edit Workflow and Delete when incomplete", () => {
    renderRow(createdIncomplete);
    expect(screen.getByRole("button", { name: /Edit workflow/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete skill/i })).toBeInTheDocument();
  });

  it("shows progress based on current_step", () => {
    renderRow(createdIncomplete); // step 2 → "Step 2/5"
    expect(screen.getAllByText("Step 2/5").length).toBeGreaterThan(0);
  });

  it("shows Completed when complete", () => {
    renderRow(createdComplete);
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
  });

  it("calls onContinue when row is clicked", async () => {
    const user = userEvent.setup();
    const { onContinue } = renderRow(createdComplete);
    await user.click(screen.getByText("my-skill"));
    expect(onContinue).toHaveBeenCalledWith(createdComplete);
  });

  it("calls onEditWorkflow when Edit Workflow is clicked", async () => {
    const user = userEvent.setup();
    const { onEditWorkflow } = renderRow(createdComplete);
    await user.click(screen.getByRole("button", { name: /Edit workflow/i }));
    expect(onEditWorkflow).toHaveBeenCalledWith(createdComplete);
  });

  it("calls onDelete when Delete is clicked", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderRow(createdComplete);
    await user.click(screen.getByRole("button", { name: /Delete skill/i }));
    expect(onDelete).toHaveBeenCalledWith(createdComplete);
  });

  it("shows Edit Details inside More Actions dropdown", async () => {
    const user = userEvent.setup();
    renderRow(createdComplete);
    await user.click(screen.getByRole("button", { name: /More actions/i }));
    expect(screen.getByText("Edit details")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SkillListRow — marketplace skill (source='marketplace')
// ---------------------------------------------------------------------------

describe("SkillListRow — marketplace skill", () => {
  it("hides Edit Workflow button", () => {
    renderRow(marketplaceSkill);
    expect(screen.queryByRole("button", { name: /Edit workflow/i })).not.toBeInTheDocument();
  });

  it("shows Refine button", () => {
    renderRow(marketplaceSkill);
    expect(screen.getByRole("button", { name: /Refine skill/i })).toBeInTheDocument();
  });

  it("shows Download button", () => {
    renderRow(marketplaceSkill);
    expect(screen.getByRole("button", { name: /Download skill/i })).toBeInTheDocument();
  });

  it("shows Delete button", () => {
    renderRow(marketplaceSkill);
    expect(screen.getByRole("button", { name: /Delete skill/i })).toBeInTheDocument();
  });

  it("hides More Actions button", () => {
    renderRow(marketplaceSkill);
    expect(screen.queryByRole("button", { name: /More actions/i })).not.toBeInTheDocument();
  });

  it("always shows Completed regardless of step data", () => {
    renderRow({ ...marketplaceSkill, status: "running", current_step: "step 1" });
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
  });

  it("calls onContinue when row is clicked", async () => {
    const user = userEvent.setup();
    const { onContinue } = renderRow(marketplaceSkill);
    await user.click(screen.getByText("my-skill"));
    expect(onContinue).toHaveBeenCalledWith(marketplaceSkill);
  });

  it("calls onRefine when Refine is clicked", async () => {
    const user = userEvent.setup();
    const { onRefine } = renderRow(marketplaceSkill);
    await user.click(screen.getByRole("button", { name: /Refine skill/i }));
    expect(onRefine).toHaveBeenCalledWith(marketplaceSkill);
  });

  it("calls onDownload when Download is clicked", async () => {
    const user = userEvent.setup();
    const { onDownload } = renderRow(marketplaceSkill);
    await user.click(screen.getByRole("button", { name: /Download skill/i }));
    expect(onDownload).toHaveBeenCalledWith(marketplaceSkill);
  });
});

// ---------------------------------------------------------------------------
// SkillListRow — null/undefined source defaults to created behaviour
// ---------------------------------------------------------------------------

describe("SkillListRow — null/undefined skill_source defaults to non-editable behaviour", () => {
  it("shows Edit Workflow when skill_source is skill-builder", () => {
    renderRow({ ...createdComplete, skill_source: "skill-builder" });
    expect(screen.getByRole("button", { name: /Edit workflow/i })).toBeInTheDocument();
  });

  it("hides Edit Workflow when skill_source is null", () => {
    renderRow({ ...createdComplete, skill_source: null });
    expect(screen.queryByRole("button", { name: /Edit workflow/i })).not.toBeInTheDocument();
  });

  it("hides Edit Workflow when skill_source is undefined", () => {
    renderRow({ ...createdComplete, skill_source: undefined });
    expect(screen.queryByRole("button", { name: /Edit workflow/i })).not.toBeInTheDocument();
  });
});

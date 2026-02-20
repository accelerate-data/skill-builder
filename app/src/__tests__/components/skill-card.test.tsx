import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SkillCard, { isWorkflowComplete } from "@/components/skill-card";
import type { SkillSummary } from "@/lib/types";

const baseSkill: SkillSummary = {
  name: "sales-pipeline",
  domain: "sales",
  current_step: "Step 3",
  status: "in_progress",
  last_modified: new Date().toISOString(),
  tags: [],
  skill_type: null,
  author_login: null,
  author_avatar: null,
  intake_json: null,
};

const completedSkill: SkillSummary = {
  ...baseSkill,
  current_step: "Step 5",
  status: "completed",
};

describe("SkillCard", () => {
  it("renders skill name", () => {
    render(
      <SkillCard skill={baseSkill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
  });

  it("renders domain badge when domain is present", () => {
    render(
      <SkillCard skill={baseSkill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("sales")).toBeInTheDocument();
  });

  it("does not render domain badge when domain is null", () => {
    const skill = { ...baseSkill, domain: null };
    render(
      <SkillCard skill={skill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.queryByText("sales")).not.toBeInTheDocument();
  });

  it("shows progress percentage from step number", () => {
    render(
      <SkillCard skill={baseSkill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    // Step 3 => Math.round(((3+1)/6)*100) = 67%
    expect(screen.getByText("67%")).toBeInTheDocument();
  });

  it("shows 100% for completed step", () => {
    const skill = { ...baseSkill, current_step: "completed" };
    render(
      <SkillCard skill={skill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("shows 0% for null step", () => {
    const skill = { ...baseSkill, current_step: null };
    render(
      <SkillCard skill={skill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("calls onContinue when the card is clicked", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(
      <SkillCard skill={baseSkill} onContinue={onContinue} onDelete={vi.fn()} />
    );

    await user.click(screen.getByText("sales-pipeline"));
    expect(onContinue).toHaveBeenCalledWith(baseSkill);
  });

  it("calls onDelete with skill when delete button is clicked", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <SkillCard skill={baseSkill} onContinue={vi.fn()} onDelete={onDelete} />
    );

    const deleteButton = screen.getByRole("button", { name: /Delete skill/i });
    await user.click(deleteButton);
    expect(onDelete).toHaveBeenCalledWith(baseSkill);
  });

  it("does not trigger onContinue when an icon button is clicked", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onDelete = vi.fn();
    render(
      <SkillCard skill={baseSkill} onContinue={onContinue} onDelete={onDelete} />
    );

    await user.click(screen.getByRole("button", { name: /Delete skill/i }));
    expect(onDelete).toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("always shows Edit icon button", () => {
    render(
      <SkillCard skill={baseSkill} onContinue={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /Edit workflow/i })).toBeInTheDocument();
  });

  it("shows Refine icon only when workflow is complete", () => {
    const { rerender } = render(
      <SkillCard skill={baseSkill} onContinue={vi.fn()} onDelete={vi.fn()} onRefine={vi.fn()} />
    );
    expect(screen.queryByRole("button", { name: /Refine skill/i })).not.toBeInTheDocument();

    rerender(
      <SkillCard skill={completedSkill} onContinue={vi.fn()} onDelete={vi.fn()} onRefine={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /Refine skill/i })).toBeInTheDocument();
  });

  it("shows Download icon only when workflow is complete", () => {
    const { rerender } = render(
      <SkillCard skill={baseSkill} onContinue={vi.fn()} onDelete={vi.fn()} onDownload={vi.fn()} />
    );
    expect(screen.queryByRole("button", { name: /Download skill/i })).not.toBeInTheDocument();

    rerender(
      <SkillCard skill={completedSkill} onContinue={vi.fn()} onDelete={vi.fn()} onDownload={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /Download skill/i })).toBeInTheDocument();
  });

  it("shows Push to remote disabled when GitHub not configured", () => {
    render(
      <SkillCard
        skill={completedSkill}
        onContinue={vi.fn()}
        onDelete={vi.fn()}
        onPushToRemote={vi.fn()}
        isGitHubLoggedIn={false}
        remoteConfigured={false}
      />
    );
    const pushButton = screen.getByRole("button", { name: /Push to remote/i });
    expect(pushButton).toBeDisabled();
  });

  it("shows Push to remote enabled when GitHub is configured", () => {
    render(
      <SkillCard
        skill={completedSkill}
        onContinue={vi.fn()}
        onDelete={vi.fn()}
        onPushToRemote={vi.fn()}
        isGitHubLoggedIn={true}
        remoteConfigured={true}
      />
    );
    const pushButton = screen.getByRole("button", { name: /Push to remote/i });
    expect(pushButton).not.toBeDisabled();
  });

  it("renders tag badges when tags are present", () => {
    const skill = { ...baseSkill, tags: ["analytics", "salesforce"] };
    render(
      <SkillCard skill={skill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("analytics")).toBeInTheDocument();
    expect(screen.getByText("salesforce")).toBeInTheDocument();
  });

  it("does not render tags section when tags are empty", () => {
    render(
      <SkillCard skill={baseSkill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    // Only domain badge should be present (no status badge, no tag badges)
    const badges = document.querySelectorAll('[data-slot="badge"]');
    expect(badges.length).toBe(1);
  });

  it("renders skill type badge with correct color when skill_type is set", () => {
    const skill = { ...baseSkill, skill_type: "platform" };
    render(
      <SkillCard skill={skill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    const typeBadge = screen.getByText("Platform");
    expect(typeBadge).toBeInTheDocument();
  });

  it("does not render type badge when skill_type is null", () => {
    render(
      <SkillCard skill={baseSkill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.queryByText("Platform")).not.toBeInTheDocument();
    expect(screen.queryByText("Domain")).not.toBeInTheDocument();
    expect(screen.queryByText("Source")).not.toBeInTheDocument();
    expect(screen.queryByText("Data Engineering")).not.toBeInTheDocument();
  });
});

describe("isWorkflowComplete", () => {
  it("returns false for null current_step", () => {
    const skill = { ...baseSkill, current_step: null, status: "in_progress" };
    expect(isWorkflowComplete(skill)).toBe(false);
  });

  it("returns false for early steps (step 3)", () => {
    const skill = { ...baseSkill, current_step: "Step 3", status: "in_progress" };
    expect(isWorkflowComplete(skill)).toBe(false);
  });

  it("returns false for step 4 (Confirm Decisions step)", () => {
    const skill = { ...baseSkill, current_step: "Step 4", status: "in_progress" };
    expect(isWorkflowComplete(skill)).toBe(false);
  });

  it("returns true for step 5 (Generate Skill -- last step, 100%)", () => {
    const skill = { ...baseSkill, current_step: "Step 5", status: "in_progress" };
    expect(isWorkflowComplete(skill)).toBe(true);
  });

  it("returns true when status is completed", () => {
    const skill = { ...baseSkill, current_step: "Step 3", status: "completed" };
    expect(isWorkflowComplete(skill)).toBe(true);
  });

  it("returns true when current_step text says completed", () => {
    const skill = { ...baseSkill, current_step: "completed", status: "in_progress" };
    expect(isWorkflowComplete(skill)).toBe(true);
  });

  it("returns false for initialization step", () => {
    const skill = { ...baseSkill, current_step: "initialization", status: "in_progress" };
    expect(isWorkflowComplete(skill)).toBe(false);
  });

  it("returns true for completed status even with null step", () => {
    const skill = { ...baseSkill, current_step: null, status: "completed" };
    expect(isWorkflowComplete(skill)).toBe(true);
  });

  it("returns false for step 0 (not started)", () => {
    const skill = { ...baseSkill, current_step: "Step 0", status: "in_progress" };
    expect(isWorkflowComplete(skill)).toBe(false);
  });

  it("returns true for step numbers above 5", () => {
    const skill = { ...baseSkill, current_step: "Step 6", status: "in_progress" };
    expect(isWorkflowComplete(skill)).toBe(true);
  });
});

describe("parseStepProgress boundary tests", () => {
  it("null step shows 0%", () => {
    const skill = { ...baseSkill, current_step: null };
    render(
      <SkillCard skill={skill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("Step 4 shows 83%", () => {
    const skill = { ...baseSkill, current_step: "Step 4" };
    render(
      <SkillCard skill={skill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("83%")).toBeInTheDocument();
  });

  it("completed shows 100%", () => {
    const skill = { ...baseSkill, current_step: "completed" };
    render(
      <SkillCard skill={skill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});

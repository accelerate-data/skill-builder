import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SkillCard, { hasBuildOutput } from "@/components/skill-card";
import type { SkillSummary } from "@/lib/types";

const baseSkill: SkillSummary = {
  name: "sales-pipeline",
  domain: "sales",
  current_step: "Step 3",
  status: "in_progress",
  last_modified: new Date().toISOString(),
  tags: [],
  skill_type: null,
};

describe("SkillCard", () => {
  it("renders formatted skill name", () => {
    render(
      <SkillCard skill={baseSkill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
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
    // Only status badge should exist, not a domain badge
    expect(screen.queryByText("sales")).not.toBeInTheDocument();
  });

  it("renders status badge for in_progress", () => {
    render(
      <SkillCard skill={baseSkill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("renders status badge for completed", () => {
    const skill = { ...baseSkill, status: "completed" };
    render(
      <SkillCard skill={skill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("renders status badge for waiting_for_user", () => {
    const skill = { ...baseSkill, status: "waiting_for_user" };
    render(
      <SkillCard skill={skill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("Needs Input")).toBeInTheDocument();
  });

  it("renders Unknown for null status", () => {
    const skill = { ...baseSkill, status: null };
    render(
      <SkillCard skill={skill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("shows current step text", () => {
    render(
      <SkillCard skill={baseSkill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("Step 3")).toBeInTheDocument();
  });

  it("shows Not started when current_step is null", () => {
    const skill = { ...baseSkill, current_step: null };
    render(
      <SkillCard skill={skill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("Not started")).toBeInTheDocument();
  });

  it("shows progress percentage from step number", () => {
    render(
      <SkillCard skill={baseSkill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    // Step 3 => Math.round((4/8)*100) = 50%
    expect(screen.getByText("50%")).toBeInTheDocument();
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

  it("calls onContinue with skill when Continue is clicked", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(
      <SkillCard skill={baseSkill} onContinue={onContinue} onDelete={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /Continue/i }));
    expect(onContinue).toHaveBeenCalledWith(baseSkill);
  });

  it("calls onDelete with skill when delete button is clicked", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <SkillCard skill={baseSkill} onContinue={vi.fn()} onDelete={onDelete} />
    );

    // The delete button is the ghost icon button (second button)
    const buttons = screen.getAllByRole("button");
    const deleteButton = buttons[1]; // Continue is first, delete is second
    await user.click(deleteButton);
    expect(onDelete).toHaveBeenCalledWith(baseSkill);
  });

  it("renders Continue button", () => {
    render(
      <SkillCard skill={baseSkill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    expect(
      screen.getByRole("button", { name: /Continue/i })
    ).toBeInTheDocument();
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
    // Only "sales" domain badge and status badge should be present
    const badges = document.querySelectorAll('[data-slot="badge"]');
    // Status badge + domain badge = 2
    expect(badges.length).toBe(2);
  });

  it("renders skill type badge with correct color when skill_type is set", () => {
    const skill = { ...baseSkill, skill_type: "platform" };
    render(
      <SkillCard skill={skill} onContinue={vi.fn()} onDelete={vi.fn()} />
    );
    const typeBadge = screen.getByText("Platform");
    expect(typeBadge).toBeInTheDocument();
    expect(typeBadge.className).toContain("bg-blue-100");
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

describe("hasBuildOutput", () => {
  it("returns false for null current_step", () => {
    const skill = { ...baseSkill, current_step: null, status: "in_progress" };
    expect(hasBuildOutput(skill)).toBe(false);
  });

  it("returns false for step less than 6", () => {
    const skill = { ...baseSkill, current_step: "Step 3", status: "in_progress" };
    expect(hasBuildOutput(skill)).toBe(false);
  });

  it("returns false for step 5 (Build step itself is in progress)", () => {
    const skill = { ...baseSkill, current_step: "Step 5", status: "in_progress" };
    expect(hasBuildOutput(skill)).toBe(false);
  });

  it("returns true for step 6 (past Build)", () => {
    const skill = { ...baseSkill, current_step: "Step 6", status: "in_progress" };
    expect(hasBuildOutput(skill)).toBe(true);
  });

  it("returns true for step 7", () => {
    const skill = { ...baseSkill, current_step: "Step 7", status: "in_progress" };
    expect(hasBuildOutput(skill)).toBe(true);
  });

  it("returns true when status is completed", () => {
    const skill = { ...baseSkill, current_step: "Step 3", status: "completed" };
    expect(hasBuildOutput(skill)).toBe(true);
  });

  it("returns true when current_step text says completed", () => {
    const skill = { ...baseSkill, current_step: "completed", status: "in_progress" };
    expect(hasBuildOutput(skill)).toBe(true);
  });

  it("returns false for initialization step", () => {
    const skill = { ...baseSkill, current_step: "initialization", status: "in_progress" };
    expect(hasBuildOutput(skill)).toBe(false);
  });

  it("returns true for completed status even with null step", () => {
    const skill = { ...baseSkill, current_step: null, status: "completed" };
    expect(hasBuildOutput(skill)).toBe(true);
  });
});

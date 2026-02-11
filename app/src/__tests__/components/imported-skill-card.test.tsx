import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportedSkillCard from "@/components/imported-skill-card";
import type { ImportedSkill } from "@/stores/imported-skills-store";

const baseSkill: ImportedSkill = {
  skill_id: "id-1",
  skill_name: "sales-analytics",
  domain: "sales",
  description: "Analytics skill for sales data pipelines",
  is_active: true,
  disk_path: "/skills/sales-analytics",
  imported_at: new Date().toISOString(),
};

describe("ImportedSkillCard", () => {
  it("renders skill name", () => {
    render(
      <ImportedSkillCard
        skill={baseSkill}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );
    expect(screen.getByText("sales-analytics")).toBeInTheDocument();
  });

  it("renders domain badge when domain is present", () => {
    render(
      <ImportedSkillCard
        skill={baseSkill}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );
    expect(screen.getByText("sales")).toBeInTheDocument();
  });

  it("does not render domain badge when domain is null", () => {
    const skill = { ...baseSkill, domain: null };
    render(
      <ImportedSkillCard
        skill={skill}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );
    expect(screen.queryByText("sales")).not.toBeInTheDocument();
  });

  it("renders description when present", () => {
    render(
      <ImportedSkillCard
        skill={baseSkill}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );
    expect(
      screen.getByText("Analytics skill for sales data pipelines")
    ).toBeInTheDocument();
  });

  it("renders 'No description' when description is null", () => {
    const skill = { ...baseSkill, description: null };
    render(
      <ImportedSkillCard
        skill={skill}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );
    expect(screen.getByText("No description")).toBeInTheDocument();
  });

  it("renders Preview button", () => {
    render(
      <ImportedSkillCard
        skill={baseSkill}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /Preview/i })).toBeInTheDocument();
  });

  it("calls onPreview when Preview is clicked", async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    render(
      <ImportedSkillCard
        skill={baseSkill}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        onPreview={onPreview}
      />
    );

    await user.click(screen.getByRole("button", { name: /Preview/i }));
    expect(onPreview).toHaveBeenCalledWith(baseSkill);
  });

  it("calls onToggleActive when switch is toggled", async () => {
    const user = userEvent.setup();
    const onToggleActive = vi.fn();
    render(
      <ImportedSkillCard
        skill={baseSkill}
        onToggleActive={onToggleActive}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );

    const toggle = screen.getByRole("switch");
    await user.click(toggle);
    expect(onToggleActive).toHaveBeenCalledWith("sales-analytics", false);
  });

  it("calls onToggleActive with true when inactive skill is toggled", async () => {
    const user = userEvent.setup();
    const onToggleActive = vi.fn();
    const inactiveSkill = { ...baseSkill, is_active: false };
    render(
      <ImportedSkillCard
        skill={inactiveSkill}
        onToggleActive={onToggleActive}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );

    const toggle = screen.getByRole("switch");
    await user.click(toggle);
    expect(onToggleActive).toHaveBeenCalledWith("sales-analytics", true);
  });

  it("requires double-click to delete (confirmation pattern)", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <ImportedSkillCard
        skill={baseSkill}
        onToggleActive={vi.fn()}
        onDelete={onDelete}
        onPreview={vi.fn()}
      />
    );

    const deleteButton = screen.getByRole("button", { name: /Delete skill/i });

    // First click: enter confirmation state
    await user.click(deleteButton);
    expect(onDelete).not.toHaveBeenCalled();

    // Second click: confirm delete
    const confirmButton = screen.getByRole("button", { name: /Confirm delete/i });
    await user.click(confirmButton);
    expect(onDelete).toHaveBeenCalledWith(baseSkill);
  });

  it("applies dimmed styling when skill is inactive", () => {
    const inactiveSkill = { ...baseSkill, is_active: false };
    const { container } = render(
      <ImportedSkillCard
        skill={inactiveSkill}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );

    const card = container.querySelector("[data-slot='card']");
    expect(card?.className).toContain("opacity-60");
  });

  it("does not apply dimmed styling when skill is active", () => {
    const { container } = render(
      <ImportedSkillCard
        skill={baseSkill}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );

    const card = container.querySelector("[data-slot='card']");
    expect(card?.className).not.toContain("opacity-60");
  });
});

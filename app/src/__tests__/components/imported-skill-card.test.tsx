import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkspaceSkillCard from "@/components/imported-skill-card";
import type { WorkspaceSkill } from "@/stores/imported-skills-store";

const baseSkill: WorkspaceSkill = {
  skill_id: "id-1",
  skill_name: "sales-analytics",
  description: "Analytics skill for sales data pipelines",
  is_active: true,
  disk_path: "/skills/sales-analytics",
  imported_at: new Date().toISOString(),
  is_bundled: false,
  purpose: null,
  version: null,
  model: null,
  argument_hint: null,
  user_invocable: null,
  disable_model_invocation: null,
};

describe("WorkspaceSkillCard", () => {
  it("renders skill name", () => {
    render(
      <WorkspaceSkillCard
        skill={baseSkill}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );
    expect(screen.getByText("sales-analytics")).toBeInTheDocument();
  });

  it("renders skill name", () => {
    render(
      <WorkspaceSkillCard
        skill={baseSkill}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );
    expect(screen.getByText("sales-analytics")).toBeInTheDocument();
  });

  it("renders description fallback when no trigger text", () => {
    render(
      <WorkspaceSkillCard
        skill={baseSkill}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );
    expect(
      screen.getByText(/Analytics skill for sales data pipelines/)
    ).toBeInTheDocument();
  });

  it("renders argument_hint when set", () => {
    const skill = { ...baseSkill, argument_hint: "Use when analyzing sales data" };
    render(
      <WorkspaceSkillCard
        skill={skill}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );
    expect(screen.getByText("Use when analyzing sales data")).toBeInTheDocument();
  });

  it("renders description with 'no trigger set' when argument_hint is null", () => {
    render(
      <WorkspaceSkillCard
        skill={baseSkill}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );
    expect(
      screen.getByText(/Analytics skill for sales data pipelines/)
    ).toBeInTheDocument();
    expect(screen.getByText(/no trigger set/)).toBeInTheDocument();
  });

  it("renders 'No trigger set' when both trigger_text and description are null", () => {
    const skill = { ...baseSkill, description: null };
    render(
      <WorkspaceSkillCard
        skill={skill}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );
    expect(screen.getByText("No trigger set")).toBeInTheDocument();
  });

  it("renders Preview button", () => {
    render(
      <WorkspaceSkillCard
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
      <WorkspaceSkillCard
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
      <WorkspaceSkillCard
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
      <WorkspaceSkillCard
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
      <WorkspaceSkillCard
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
      <WorkspaceSkillCard
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
      <WorkspaceSkillCard
        skill={baseSkill}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
      />
    );

    const card = container.querySelector("[data-slot='card']");
    expect(card?.className).not.toContain("opacity-60");
  });

  describe("bundled skills", () => {
    const bundledSkill: WorkspaceSkill = {
      ...baseSkill,
      skill_id: "bundled-1",
      skill_name: "skill-builder-practices",
      is_bundled: true,
      argument_hint: null,
    };

    it("shows Built-in badge for bundled skills", () => {
      render(
        <WorkspaceSkillCard
          skill={bundledSkill}
          onToggleActive={vi.fn()}
          onDelete={vi.fn()}
          onPreview={vi.fn()}
        />
      );
      expect(screen.getByText("Built-in")).toBeInTheDocument();
    });

    it("does not show Built-in badge for non-bundled skills", () => {
      render(
        <WorkspaceSkillCard
          skill={baseSkill}
          onToggleActive={vi.fn()}
          onDelete={vi.fn()}
          onPreview={vi.fn()}
        />
      );
      expect(screen.queryByText("Built-in")).not.toBeInTheDocument();
    });

    it("hides delete button for bundled skills", () => {
      render(
        <WorkspaceSkillCard
          skill={bundledSkill}
          onToggleActive={vi.fn()}
          onDelete={vi.fn()}
          onPreview={vi.fn()}
        />
      );
      expect(screen.queryByRole("button", { name: /Delete skill/i })).not.toBeInTheDocument();
    });

    it("toggle still works for bundled skills", async () => {
      const user = userEvent.setup();
      const onToggleActive = vi.fn();
      render(
        <WorkspaceSkillCard
          skill={bundledSkill}
          onToggleActive={onToggleActive}
          onDelete={vi.fn()}
          onPreview={vi.fn()}
        />
      );

      const toggle = screen.getByRole("switch");
      expect(toggle).toBeInTheDocument();
      await user.click(toggle);
      expect(onToggleActive).toHaveBeenCalledWith("skill-builder-practices", false);
    });
  });

  describe("research bundled skill", () => {
    const researchSkill: WorkspaceSkill = {
      ...baseSkill,
      skill_id: "bundled-research",
      skill_name: "research",
      is_bundled: true,
      is_active: true,
      description: "Research skill for the Skill Builder workflow",
    };

    it("shows Built-in badge for research skill", () => {
      render(
        <WorkspaceSkillCard
          skill={researchSkill}
          onToggleActive={vi.fn()}
          onDelete={vi.fn()}
          onPreview={vi.fn()}
        />
      );
      expect(screen.getByText("Built-in")).toBeInTheDocument();
    });

    it("does not show delete button for research skill", () => {
      render(
        <WorkspaceSkillCard
          skill={researchSkill}
          onToggleActive={vi.fn()}
          onDelete={vi.fn()}
          onPreview={vi.fn()}
        />
      );
      expect(screen.queryByRole("button", { name: /Delete skill/i })).not.toBeInTheDocument();
    });

    it("shows toggle active switch for research skill", () => {
      render(
        <WorkspaceSkillCard
          skill={researchSkill}
          onToggleActive={vi.fn()}
          onDelete={vi.fn()}
          onPreview={vi.fn()}
        />
      );
      const toggle = screen.getByRole("switch");
      expect(toggle).toBeInTheDocument();
      expect(toggle).not.toBeDisabled();
    });

    it("calls onToggleActive when research skill toggle is clicked", async () => {
      const user = userEvent.setup();
      const onToggleActive = vi.fn();
      render(
        <WorkspaceSkillCard
          skill={researchSkill}
          onToggleActive={onToggleActive}
          onDelete={vi.fn()}
          onPreview={vi.fn()}
        />
      );

      const toggle = screen.getByRole("switch");
      await user.click(toggle);
      expect(onToggleActive).toHaveBeenCalledWith("research", false);
    });
  });

  describe("validate-skill bundled skill", () => {
    const validateSkill: WorkspaceSkill = {
      ...baseSkill,
      skill_id: "bundled-validate-skill",
      skill_name: "validate-skill",
      is_bundled: true,
      is_active: true,
      description: "Validates a completed skill against its decisions and clarifications",
    };

    it("shows Built-in badge for validate-skill", () => {
      render(
        <WorkspaceSkillCard
          skill={validateSkill}
          onToggleActive={vi.fn()}
          onDelete={vi.fn()}
          onPreview={vi.fn()}
        />
      );
      expect(screen.getByText("Built-in")).toBeInTheDocument();
    });

    it("does not show delete button for validate-skill", () => {
      render(
        <WorkspaceSkillCard
          skill={validateSkill}
          onToggleActive={vi.fn()}
          onDelete={vi.fn()}
          onPreview={vi.fn()}
        />
      );
      expect(screen.queryByRole("button", { name: /Delete skill/i })).not.toBeInTheDocument();
    });

    it("shows toggle active switch for validate-skill", () => {
      render(
        <WorkspaceSkillCard
          skill={validateSkill}
          onToggleActive={vi.fn()}
          onDelete={vi.fn()}
          onPreview={vi.fn()}
        />
      );
      const toggle = screen.getByRole("switch");
      expect(toggle).toBeInTheDocument();
      expect(toggle).not.toBeDisabled();
    });

    it("calls onToggleActive when validate-skill toggle is clicked", async () => {
      const user = userEvent.setup();
      const onToggleActive = vi.fn();
      render(
        <WorkspaceSkillCard
          skill={validateSkill}
          onToggleActive={onToggleActive}
          onDelete={vi.fn()}
          onPreview={vi.fn()}
        />
      );
      const toggle = screen.getByRole("switch");
      await user.click(toggle);
      expect(onToggleActive).toHaveBeenCalledWith("validate-skill", false);
    });
  });
});

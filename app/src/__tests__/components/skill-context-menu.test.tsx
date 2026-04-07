import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SkillContextMenu } from "@/components/skill-context-menu";
import type { UnifiedSkill, SkillMenuState } from "@/hooks/use-unified-skills";

function makeSkill(overrides: Partial<UnifiedSkill> = {}): UnifiedSkill {
  return {
    key: "skill-builder:skills:test-skill",
    name: "test-skill",
    description: "A test skill",
    purpose: "domain",
    lastModified: null,
    createdAt: null,
    source: "builder",
    pluginSlug: "skills",
    pluginDisplayName: "Skills",
    isDefaultPlugin: true,
    importedSkillId: null,
    status: "complete",
    currentStep: null,
    ...overrides,
  };
}

function makeMenuState(overrides: Partial<SkillMenuState> = {}): SkillMenuState {
  return {
    isBuilder: true,
    isComplete: true,
    showsLifecycleActions: true,
    ...overrides,
  };
}

function renderMenu(skill: UnifiedSkill, menuState: SkillMenuState, onExport = vi.fn()) {
  return render(
    <SkillContextMenu
      skill={skill}
      menuState={menuState}
      onReview={vi.fn()}
      onRedo={vi.fn()}
      onOverview={vi.fn()}
      onEval={vi.fn()}
      onRefine={vi.fn()}
      onContinueBuilding={vi.fn()}
      onRestore={vi.fn()}
      onDelete={vi.fn()}
      onCreatePlugin={vi.fn()}
      onMoveToPlugin={vi.fn()}
      onRemoveFromPlugin={vi.fn()}
      onExport={onExport}
      pluginOptions={[]}
    />,
  );
}

describe("SkillContextMenu", () => {
  it("shows Export as .skill for a complete builder skill", async () => {
    const user = userEvent.setup();
    renderMenu(makeSkill(), makeMenuState());
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByText("Export as .skill")).toBeInTheDocument();
  });

  it("shows Export as .skill for a complete imported skill", async () => {
    const user = userEvent.setup();
    renderMenu(
      makeSkill({ source: "imported", importedSkillId: "imp-123" }),
      makeMenuState({ isBuilder: false, showsLifecycleActions: false }),
    );
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByText("Export as .skill")).toBeInTheDocument();
  });

  it("does not show Export as .skill for an incomplete skill", async () => {
    const user = userEvent.setup();
    renderMenu(makeSkill(), makeMenuState({ isComplete: false }));
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.queryByText("Export as .skill")).not.toBeInTheDocument();
  });

  it("calls onExport with the skill when Export as .skill is selected", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    const skill = makeSkill();
    renderMenu(skill, makeMenuState(), onExport);
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    await user.click(screen.getByText("Export as .skill"));
    expect(onExport).toHaveBeenCalledWith(skill);
  });
});

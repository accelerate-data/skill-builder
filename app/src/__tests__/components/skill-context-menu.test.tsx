import { fireEvent, render, screen } from "@testing-library/react";
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
    >
      <div data-testid="skill-row">{skill.name}</div>
    </SkillContextMenu>,
  );
}

describe("SkillContextMenu", () => {
  it("shows Export as .skill for a complete builder skill", async () => {
    renderMenu(makeSkill(), makeMenuState());
    fireEvent.contextMenu(screen.getByTestId("skill-row"));
    expect(screen.getByText("Export as .skill")).toBeInTheDocument();
  });

  it("shows Export as .skill for a complete imported skill", async () => {
    renderMenu(
      makeSkill({ source: "imported", importedSkillId: "imp-123" }),
      makeMenuState({ isBuilder: false, showsLifecycleActions: false }),
    );
    fireEvent.contextMenu(screen.getByTestId("skill-row"));
    expect(screen.getByText("Export as .skill")).toBeInTheDocument();
  });

  it("does not show Export as .skill for a marketplace skill", async () => {
    renderMenu(
      makeSkill({ source: "marketplace", isDefaultPlugin: false }),
      makeMenuState({ isBuilder: false, showsLifecycleActions: false }),
    );
    fireEvent.contextMenu(screen.getByTestId("skill-row"));
    expect(screen.queryByText("Export as .skill")).not.toBeInTheDocument();
  });

  it("does not show Export as .skill for an incomplete skill", async () => {
    renderMenu(makeSkill(), makeMenuState({ isComplete: false }));
    fireEvent.contextMenu(screen.getByTestId("skill-row"));
    expect(screen.queryByText("Export as .skill")).not.toBeInTheDocument();
  });

  it("calls onExport with the skill when Export as .skill is selected", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    const skill = makeSkill();
    renderMenu(skill, makeMenuState(), onExport);
    fireEvent.contextMenu(screen.getByTestId("skill-row"));
    await user.click(screen.getByText("Export as .skill"));
    expect(onExport).toHaveBeenCalledWith(skill);
  });
});

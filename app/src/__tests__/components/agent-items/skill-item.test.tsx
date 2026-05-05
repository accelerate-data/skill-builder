import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkillItem } from "@/components/agent-items/skill-item";
import type { DisplayItem } from "@/lib/display-types";

vi.mock("@/components/agent-items/base-item", () => ({
  BaseItem: ({
    label,
    summary,
  }: {
    icon: React.ReactNode;
    label: string;
    summary?: string;
  }) => (
    <div>
      <div data-testid="skill-base-item-label">{label}</div>
      <div data-testid="skill-base-item-summary">{summary}</div>
    </div>
  ),
}));

function createItem(overrides: Partial<DisplayItem> = {}): DisplayItem {
  return {
    id: "skill-1",
    type: "skill",
    timestamp: 1,
    ...overrides,
  };
}

describe("SkillItem", () => {
  it("shows skill name as label when skillName is set", () => {
    render(
      <SkillItem
        item={createItem({
          skillName: "research",
          subagentDescription: "Researching pricing",
          subagentStatus: "running",
        })}
      />,
    );

    expect(screen.getByTestId("skill-base-item-label")).toHaveTextContent("research");
    expect(screen.getByTestId("skill-base-item-summary")).toHaveTextContent("Researching pricing");
  });

  it("falls back to 'Skill' label when skillName is absent", () => {
    render(
      <SkillItem
        item={createItem({
          toolSummary: "Using skill: generate-skill",
          subagentDescription: "Generating skill files",
          subagentStatus: "complete",
        })}
      />,
    );

    expect(screen.getByTestId("skill-base-item-label")).toHaveTextContent("Skill");
    expect(screen.getByTestId("skill-base-item-summary")).toHaveTextContent("Generating skill files");
  });

  it("falls back to toolSummary when both skillName and subagentDescription are absent", () => {
    render(
      <SkillItem
        item={createItem({
          skillName: "decisions",
          toolSummary: "Using skill: decisions",
        })}
      />,
    );

    expect(screen.getByTestId("skill-base-item-label")).toHaveTextContent("decisions");
    expect(screen.getByTestId("skill-base-item-summary")).toHaveTextContent("Using skill: decisions");
  });
});

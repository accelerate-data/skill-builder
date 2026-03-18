import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkillSourceBadge } from "@/components/skill-source-badge";

describe("SkillSourceBadge", () => {
  it("renders 'Skill Builder' badge for skill-builder source", () => {
    render(<SkillSourceBadge skillSource="skill-builder" />);
    expect(screen.getByText("Skill Builder")).toBeInTheDocument();
  });

  it("renders 'Marketplace' badge for marketplace source", () => {
    render(<SkillSourceBadge skillSource="marketplace" />);
    expect(screen.getByText("Marketplace")).toBeInTheDocument();
  });

  it("renders 'Uploaded' badge for imported source", () => {
    render(<SkillSourceBadge skillSource="imported" />);
    expect(screen.getByText("Uploaded")).toBeInTheDocument();
  });

  it("renders nothing for null source", () => {
    const { container } = render(<SkillSourceBadge skillSource={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for undefined source", () => {
    const { container } = render(<SkillSourceBadge skillSource={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for unknown source", () => {
    const { container } = render(<SkillSourceBadge skillSource="unknown" />);
    expect(container.innerHTML).toBe("");
  });
});

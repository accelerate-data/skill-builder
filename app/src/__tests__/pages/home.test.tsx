import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useSkillStore } from "@/stores/skill-store";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: "/" } }),
}));

vi.mock("@/pages/dashboard", () => ({
  default: () => <div data-testid="dashboard-page">dashboard</div>,
}));

import HomePage from "@/pages/home";

describe("HomePage", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    useSkillStore.setState({
      activeSkillId: "2740",
      lockedSkills: new Set(),
      latestVersion: null,
    });
  });

  it("renders the dashboard and does not redirect when an active skill exists", () => {
    render(<HomePage />);

    expect(screen.getByTestId("dashboard-page")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("stays on the dashboard when activeSkillId changes after mount", () => {
    useSkillStore.setState({
      activeSkillId: null,
      lockedSkills: new Set(),
      latestVersion: null,
    });

    render(<HomePage />);

    useSkillStore.setState({
      activeSkillId: "3001",
      lockedSkills: new Set(),
      latestVersion: null,
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

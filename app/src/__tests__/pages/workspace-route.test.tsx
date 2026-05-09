import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import WorkspaceRoutePage, { surfaceFromRoute } from "@/pages/workspace-route";
import { vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  useParams: vi.fn(() => ({ skillName: "test-skill" })),
  useSearch: vi.fn(() => ({})),
  useRouterState: vi.fn(({ select }) =>
    select({ location: { pathname: "/workspace/test-skill" } })
  ),
  useNavigate: vi.fn(() => vi.fn()),
}));

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: vi.fn(() => "/test/workspace"),
}));

vi.mock("@/lib/queries/skills", () => ({
  useBuilderSkillsQuery: vi.fn(() => ({ data: [] })),
  useImportedSkillsQuery: vi.fn(() => ({ data: [] })),
}));

vi.mock("@/components/workspace/workspace-shell", () => ({
  WorkspaceShell: vi.fn(() => <div data-testid="workspace-shell" />),
}));

describe("surfaceFromRoute", () => {
  it("returns refine when pathname ends with /refine", () => {
    expect(surfaceFromRoute("/workspace/test/refine")).toBe("refine");
  });

  it("returns evals when pathname ends with /evals", () => {
    expect(surfaceFromRoute("/workspace/test/evals")).toBe("evals");
  });

  it("returns refine when tab search param is refine", () => {
    expect(surfaceFromRoute("/workspace/test", "refine")).toBe("refine");
  });

  it("returns evals when tab search param is evals", () => {
    expect(surfaceFromRoute("/workspace/test", "evals")).toBe("evals");
  });

  it("returns evals when tab search param is description", () => {
    expect(surfaceFromRoute("/workspace/test", "description")).toBe("evals");
  });

  it("returns overview for root workspace path", () => {
    expect(surfaceFromRoute("/workspace/test")).toBe("overview");
  });

  it("returns overview when tab is undefined", () => {
    expect(surfaceFromRoute("/workspace/test", undefined)).toBe("overview");
  });
});

describe("WorkspaceRoutePage", () => {
  it("shows 'Skill not found' when skill is not in queries", () => {
    render(<WorkspaceRoutePage />);
    expect(screen.getByText("Skill not found")).toBeInTheDocument();
  });
});

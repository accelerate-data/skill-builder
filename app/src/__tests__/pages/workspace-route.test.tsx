import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import WorkspaceRoutePage, { surfaceFromRoute } from "@/pages/workspace-route";
import type { SkillSummary, ImportedSkill } from "@/lib/types";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

const mockUseParams = vi.fn(() => ({ skillId: "101" }));
const mockUseSearch = vi.fn(() => ({}));
const mockUseRouterState = vi.fn(({ select }) =>
  select({ location: { pathname: "/workspace/101" } })
);
const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useParams: (...args: unknown[]) => mockUseParams(...args),
  useSearch: (...args: unknown[]) => mockUseSearch(...args),
  useRouterState: (...args: unknown[]) => mockUseRouterState(...args),
  useNavigate: () => mockNavigate,
}));

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: vi.fn(() => "/test/workspace"),
}));

let mockBuilderSkills: SkillSummary[] = [];
let mockImportedSkills: ImportedSkill[] = [];
let mockBuilderPending = false;
let mockImportedPending = false;

vi.mock("@/lib/queries/skills", () => ({
  useBuilderSkillsQuery: vi.fn(() => ({ data: mockBuilderSkills, isPending: mockBuilderPending })),
  useImportedSkillsQuery: vi.fn(() => ({ data: mockImportedSkills, isPending: mockImportedPending })),
}));

vi.mock("@/components/workspace/workspace-shell", () => ({
  WorkspaceShell: vi.fn(() => <div data-testid="workspace-shell" />),
}));

beforeEach(() => {
  mockBuilderSkills = [];
  mockImportedSkills = [];
  mockBuilderPending = false;
  mockImportedPending = false;
  mockUseParams.mockReturnValue({ skillId: "101" });
  mockUseSearch.mockReturnValue({});
  mockUseRouterState.mockImplementation(({ select }) =>
    select({ location: { pathname: "/workspace/101" } })
  );
  mockNavigate.mockClear();
});

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

  it("shows loading state while queries are pending", () => {
    mockBuilderPending = true;
    render(<WorkspaceRoutePage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("finds builder skill by skill_id", () => {
    mockUseParams.mockReturnValue({ skillId: "101" });
    mockBuilderSkills = [
      {
        id: 101,
        name: "petstore-sales-v2",
        library_key: "petstore-sales",
        skill_source: "skill-builder",
        plugin_slug: "default",
        plugin_display_name: "Default",
        is_default_plugin: true,
        status: "completed",
        current_step: null,
        last_modified: null,
        created_at: null,
        purpose: null,
        tags: [],
        intake_json: null,
      },
    ];

    render(<WorkspaceRoutePage />);
    expect(screen.getByTestId("workspace-shell")).toBeInTheDocument();
  });

  it("finds builder skill by skill_id when library_key is null", () => {
    mockUseParams.mockReturnValue({ skillId: "102" });
    mockBuilderSkills = [
      {
        id: 102,
        name: "sales-skill",
        library_key: null,
        skill_source: "skill-builder",
        plugin_slug: "default",
        plugin_display_name: "Default",
        is_default_plugin: true,
        status: "completed",
        current_step: null,
        last_modified: null,
        created_at: null,
        purpose: null,
        tags: [],
        intake_json: null,
      },
    ];

    render(<WorkspaceRoutePage />);
    expect(screen.getByTestId("workspace-shell")).toBeInTheDocument();
  });

  it("finds imported skill by skill_id", () => {
    mockUseParams.mockReturnValue({ skillId: "uuid-123" });
    mockImportedSkills = [
      {
        skill_id: "uuid-123",
        skill_name: "petstore-imported",
        library_key: "imported-petstore",
        plugin_slug: "default",
        plugin_display_name: "Default",
        is_default_plugin: true,
        description: null,
        purpose: null,
        version: null,
        user_invocable: null,
        disable_model_invocation: null,
        disk_path: "/some/path",
        imported_at: "2026-01-01T00:00:00Z",
        marketplace_source_url: null,
      },
    ];

    render(<WorkspaceRoutePage />);
    expect(screen.getByTestId("workspace-shell")).toBeInTheDocument();
  });

  it("finds imported skill by skill_id when library_key is null", () => {
    mockUseParams.mockReturnValue({ skillId: "uuid-123" });
    mockImportedSkills = [
      {
        skill_id: "uuid-123",
        skill_name: "some-skill",
        library_key: null,
        plugin_slug: "default",
        plugin_display_name: "Default",
        is_default_plugin: true,
        description: null,
        purpose: null,
        version: null,
        user_invocable: null,
        disable_model_invocation: null,
        disk_path: "/some/path",
        imported_at: "2026-01-01T00:00:00Z",
        marketplace_source_url: null,
      },
    ];

    render(<WorkspaceRoutePage />);
    expect(screen.getByTestId("workspace-shell")).toBeInTheDocument();
  });

  it("passes skillType='marketplace' for marketplace-imported skills", () => {
    mockUseParams.mockReturnValue({ skillId: "uuid-mkt-1" });
    mockImportedSkills = [
      {
        skill_id: "uuid-mkt-1",
        skill_name: "marketplace-plugin-skill",
        library_key: "imported:uuid-mkt-1",
        plugin_slug: "analytics-pack",
        plugin_display_name: "Analytics Pack",
        is_default_plugin: false,
        description: "Marketplace skill",
        purpose: "domain",
        version: "1.0.0",
        user_invocable: true,
        disable_model_invocation: false,
        disk_path: "/some/plugin/path",
        imported_at: "2026-01-01T00:00:00Z",
        marketplace_source_url: "https://github.com/acme/skills",
      },
    ];

    render(<WorkspaceRoutePage />);

    expect(screen.getByTestId("workspace-shell")).toBeInTheDocument();
    expect(vi.mocked(WorkspaceShell)).toHaveBeenCalledWith(
      expect.objectContaining({
        skillType: "marketplace",
        initialSurface: "overview",
      }),
      undefined,
    );
  });
});

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkillSummary, ImportedSkill } from "@/lib/types";
import { renderWithQueryClient as render } from "@/test/query-test-utils";

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: vi.fn((selector) =>
    selector({ workspacePath: "/workspace", isConfigured: true }),
  ),
}));

vi.mock("@/lib/tauri", () => ({
  getSkillHistory: vi.fn().mockResolvedValue([]),
  readLatestBenchmark: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/components/skill-dialog", () => ({
  default: ({ open }: { open: boolean }) => (
    <div data-testid="skill-dialog" data-open={String(open)} />
  ),
}));

vi.mock("@/components/workspace/benchmark-overview-card", () => ({
  BenchmarkOverviewCard: () => <div data-testid="benchmark-overview-card" />,
}));

import { WorkspaceOverview } from "@/components/workspace/workspace-overview";
import { getSkillHistory, readLatestBenchmark } from "@/lib/tauri";

const baseSkill: SkillSummary = {
  name: "sales-pipeline",
  current_step: null,
  status: "completed",
  last_modified: "2026-01-15T10:00:00Z",
  tags: ["crm", "salesforce"],
  purpose: "domain",
  skill_source: "skill-builder",
  author_login: null,
  author_avatar: null,
  intake_json: null,
  source: null,
  description: "Automates sales pipeline tracking",
  version: "1.0.0",
  userInvocable: null,
  disableModelInvocation: null,
  plugin_slug: "skills",
  plugin_display_name: "Skills",
  is_default_plugin: true,
};

const baseImportedSkill: ImportedSkill = {
  skill_id: 1,
  skill_name: "crm-connector",
  library_key: null,
  description: "Connects to CRM systems",
  is_active: true,
  disk_path: "/skills/crm-connector",
  imported_at: "2026-01-15T10:00:00Z",
  is_bundled: false,
  purpose: "domain",
  version: "1.0.0",
  user_invocable: null,
  disable_model_invocation: null,
  marketplace_source_url: "https://github.com/test-org/skills",
  plugin_slug: "test-pkg",
  plugin_display_name: "Test Pkg",
  is_default_plugin: false,
};

describe("WorkspaceOverview", () => {
  it("shows Edit button for imported marketplace skill", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceOverview
        skill={baseImportedSkill}
        skillType="marketplace"
      />,
    );

    const editBtn = screen.getByRole("button", { name: /Edit/i });
    expect(editBtn).toBeInTheDocument();
    expect(editBtn).not.toBeDisabled();

    await user.click(editBtn);
    const dialog = screen.getByTestId("skill-dialog");
    expect(dialog).toHaveAttribute("data-open", "true");
  });

  it("shows skill purpose, tags, description, and dates", () => {
    render(
      <WorkspaceOverview
        skill={baseSkill}
        skillType="builder"
      />,
    );

    expect(screen.getByText("Automates sales pipeline tracking")).toBeInTheDocument();
    expect(screen.getByText("crm")).toBeInTheDocument();
    expect(screen.getByText("salesforce")).toBeInTheDocument();

    // Purpose label from PURPOSE_LABELS["domain"]
    expect(screen.getByText("Business process knowledge")).toBeInTheDocument();

    // Just check the "Created" and "Modified" labels exist
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Modified")).toBeInTheDocument();
  });

  it("opens SkillDialog when Edit button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceOverview
        skill={baseSkill}
        skillType="builder"
      />,
    );

    expect(screen.queryByTestId("skill-dialog")).not.toBeInTheDocument();

    const editBtn = screen.getByRole("button", { name: /Edit/i });
    await user.click(editBtn);

    const dialog = screen.getByTestId("skill-dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("data-open", "true");
  });

  it("renders version history without selectable checkboxes", async () => {
    vi.mocked(getSkillHistory).mockResolvedValueOnce([
      {
        sha: "1b66e7d8",
        message: "Update analyzing-leads description via optimization",
        timestamp: new Date().toISOString(),
        version: "0.0.3",
      },
      {
        sha: "0ae7c6ee",
        message: "generated skill",
        timestamp: new Date(Date.now() - 60_000).toISOString(),
        version: null,
      },
    ]);

    render(
      <WorkspaceOverview
        skill={baseSkill}
        skillType="builder"
      />,
    );

    expect(await screen.findByText("v0.0.3")).toBeInTheDocument();
    expect(screen.getByText("generated skill")).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /compare/i })).not.toBeInTheDocument();
  });

  it("does not load or render legacy benchmark overview artifacts", async () => {
    vi.mocked(readLatestBenchmark).mockResolvedValueOnce({
      iteration: 7,
      data: { legacy: true },
    });

    render(
      <WorkspaceOverview
        skill={baseSkill}
        skillType="builder"
      />,
    );

    await waitFor(() =>
      expect(getSkillHistory).toHaveBeenCalledWith(
        "/workspace",
        "sales-pipeline",
        "skills",
        50,
      ),
    );

    expect(readLatestBenchmark).not.toHaveBeenCalled();
    expect(screen.queryByTestId("benchmark-overview-card")).not.toBeInTheDocument();
  });
});

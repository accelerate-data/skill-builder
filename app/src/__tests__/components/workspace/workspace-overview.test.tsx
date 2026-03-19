import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkillSummary } from "@/lib/types";

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: vi.fn((selector) =>
    selector({ workspacePath: "/workspace", isConfigured: true }),
  ),
}));

vi.mock("@/lib/tauri", () => ({
  getSkillHistory: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/components/skill-dialog", () => ({
  default: ({ open }: { open: boolean }) => (
    <div data-testid="skill-dialog" data-open={String(open)} />
  ),
}));

import { WorkspaceOverview } from "@/components/workspace/workspace-overview";

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
  model: null,
  argumentHint: null,
  userInvocable: null,
  disableModelInvocation: null,
};

describe("WorkspaceOverview", () => {
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
});

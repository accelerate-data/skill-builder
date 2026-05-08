import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkillSummary } from "@/lib/types";
import { resetTauriMocks } from "@/test/mocks/tauri";

const mockGenerateScenarios = vi.fn();

vi.mock("@/lib/eval-workbench", async () => {
  const actual = await vi.importActual<typeof import("@/lib/eval-workbench")>(
    "@/lib/eval-workbench",
  );

  return {
    ...actual,
    generateScenarios: (...args: unknown[]) => mockGenerateScenarios(...args),
  };
});

import { WorkspaceEvals } from "@/components/workspace/workspace-evals";

const skill: SkillSummary = {
  name: "forecast-skill",
  plugin_slug: "skills",
  plugin_display_name: "Skills",
  is_default_plugin: true,
  description: "Forecast revenue trends",
  version: "1.2.3",
  current_step: null,
  status: "completed",
  last_modified: "2026-05-04T00:00:00Z",
  tags: [],
  purpose: "domain",
  skill_source: "skill-builder",
  author_login: null,
  author_avatar: null,
  intake_json: null,
  source: null,
  userInvocable: null,
  disableModelInvocation: null,
};

const performanceScenario = {
  id: "case-1",
  name: "Regression",
  tags: ["performance"] as const,
  prompt: "Forecast next quarter revenue",
  assertions: ["Explains the forecast assumptions."],
};

const alternatePerformanceScenario = {
  id: "case-2",
  name: "Smoke",
  tags: ["performance"] as const,
  prompt: "Summarize pipeline risk",
  assertions: ["Summarizes the main pipeline blockers."],
};

describe("WorkspaceEvals", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.clearAllMocks();
  });

  it("renders scenario list and detail", async () => {
    const user = userEvent.setup();
    const onSaveScenario = vi.fn().mockResolvedValue(performanceScenario);
    const onStartNewScenario = vi.fn();

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath={null}
        scenario={performanceScenario}
        hasScenarios={true}
        onStartNewScenario={onStartNewScenario}
        onSaveScenario={onSaveScenario}
      />,
    );

    expect(screen.getByDisplayValue("Forecast next quarter revenue")).toBeInTheDocument();
    expect(screen.getByText("Assertion 1")).toBeInTheDocument();
  });

  it("allows editing and saving a scenario", async () => {
    const user = userEvent.setup();
    const onSaveScenario = vi.fn().mockResolvedValue({
      ...performanceScenario,
      prompt: "Updated prompt",
    });
    const onStartNewScenario = vi.fn();

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath={null}
        scenario={performanceScenario}
        hasScenarios={true}
        onStartNewScenario={onStartNewScenario}
        onSaveScenario={onSaveScenario}
      />,
    );

    const promptInput = screen.getByDisplayValue("Forecast next quarter revenue");
    await user.clear(promptInput);
    await user.type(promptInput, "Updated prompt");

    await user.click(screen.getByRole("button", { name: /save scenario/i }));

    await waitFor(() => expect(onSaveScenario).toHaveBeenCalled());
  });

  it("calls onStartNewScenario when creating new", async () => {
    const user = userEvent.setup();
    const onStartNewScenario = vi.fn();
    const onCreateScenario = vi.fn().mockResolvedValue(alternatePerformanceScenario);

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath={null}
        scenario={null}
        hasScenarios={false}
        onStartNewScenario={onStartNewScenario}
        onCreateScenario={onCreateScenario}
        onSaveScenario={vi.fn()}
      />,
    );

    expect(screen.getByText(/no scenarios yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /new scenario/i }));
    expect(onCreateScenario).toHaveBeenCalledWith();
  });

  it("shows no scenarios message when hasScenarios is false", () => {
    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath={null}
        scenario={null}
        hasScenarios={false}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
      />,
    );

    expect(screen.getByText(/no scenarios yet/i)).toBeInTheDocument();
  });
});

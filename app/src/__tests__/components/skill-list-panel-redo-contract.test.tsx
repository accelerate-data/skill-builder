import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { createTestQueryClient } from "@/test/query-test-utils";
import { queryKeys } from "@/lib/queries/query-keys";
import { useSettingsStore } from "@/stores/settings-store";
import { useSkillStore } from "@/stores/skill-store";
import { useRefineStore } from "@/stores/refine-store";
import type { SkillSummary } from "@/lib/types";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: "/" } }),
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/skill-dialog", () => ({
  default: () => null,
}));

const tauriMocks = vi.hoisted(() => ({
  listSkills: vi.fn(),
  listImportedSkills: vi.fn(),
  deleteImportedSkill: vi.fn(),
  getExternallyLockedSkills: vi.fn(),
  listPlugins: vi.fn(),
  resetWorkflowStep: vi.fn(),
  createPluginFromSkills: vi.fn(),
  moveSkillToPlugin: vi.fn(),
  removeSkillFromPlugin: vi.fn(),
  selectSkillOpenHandsSession: vi.fn(),
}));

vi.mock("@/lib/tauri", () => tauriMocks);

import { SkillListPanel } from "@/components/skill-list-panel";

function makeBuilderSkill(name: string): SkillSummary {
  return {
    id: 42,
    name,
    library_key: `skill-builder:skills:${name}`,
    current_step: null,
    status: "completed",
    last_modified: new Date().toISOString(),
    tags: [],
    purpose: null,
    skill_source: "skill-builder",
    author_login: null,
    author_avatar: null,
    intake_json: null,
    source: null,
    description: null,
    version: null,
    userInvocable: null,
    disableModelInvocation: null,
    plugin_slug: "skills",
    plugin_display_name: "Skills",
    is_default_plugin: true,
  };
}

function renderWithSkills(skills: SkillSummary[]) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(queryKeys.skills.builder(), skills);
  queryClient.setQueryData(queryKeys.skills.imported(), []);

  return render(
    <QueryClientProvider client={queryClient}>
      <SkillListPanel />
    </QueryClientProvider>,
  );
}

describe("SkillListPanel redo restart contract", () => {
  beforeEach(() => {
    useSettingsStore.setState({ workspacePath: "/tmp/workspace" });
    useSkillStore.setState({ activeSkill: null, lockedSkills: new Set(), latestVersion: null });
    useRefineStore.getState().clearSession();
    mockNavigate.mockReset();

    tauriMocks.listSkills.mockResolvedValue([]);
    tauriMocks.listImportedSkills.mockResolvedValue([]);
    tauriMocks.getExternallyLockedSkills.mockResolvedValue([]);
    tauriMocks.resetWorkflowStep.mockResolvedValue(undefined);
    tauriMocks.selectSkillOpenHandsSession.mockResolvedValue({
      conversation_id: "conv-redo-123",
      skill_name: "redo-builder",
      created_at: new Date().toISOString(),
      available_agents: ["skill-creator"],
      restored_messages: [
        { role: "user", content: "Redo the workflow from scratch" },
        { role: "agent", content: "Restarted workflow context." },
      ],
      restored_transcript_events: [],
    });
  });

  it("redo recreates the OpenHands session and hydrates refine state before navigation", async () => {
    const user = userEvent.setup();
    const skill = makeBuilderSkill("redo-builder");
    tauriMocks.listSkills.mockResolvedValue([skill]);
    renderWithSkills([skill]);

    const row = await screen.findByText("redo-builder");
    await user.click(row);
    await user.pointer({ keys: "[MouseRight]", target: row.closest('[role=\"button\"]')! });
    await user.click(screen.getByRole("menuitem", { name: "Redo workflow" }));
    await user.click(screen.getByRole("button", { name: "Redo" }));

    await waitFor(() => {
      expect(tauriMocks.resetWorkflowStep).toHaveBeenCalledWith(
        "/tmp/workspace",
        "redo-builder",
        0,
      );
    });

    await waitFor(() => {
      expect(tauriMocks.selectSkillOpenHandsSession).toHaveBeenCalledWith(
        42,
      );
    });

    const refine = useRefineStore.getState();
    expect(refine.selectedSkill?.name).toBe("redo-builder");
    expect(refine.conversationId).toBe("conv-redo-123");
    expect(refine.messages).toHaveLength(2);
    expect(refine.messages[0]?.role).toBe("user");
    expect(refine.messages[1]?.role).toBe("agent");

    // Navigation is handled by AppLayout via onActivateSkill callback
  });

  it("redo still resets and recreates the session when workspacePath is null", async () => {
    const user = userEvent.setup();
    const skill = makeBuilderSkill("redo-builder");
    useSettingsStore.setState({ workspacePath: null });
    tauriMocks.listSkills.mockResolvedValue([skill]);
    renderWithSkills([skill]);

    const row = await screen.findByText("redo-builder");
    await user.click(row);
    await user.pointer({ keys: "[MouseRight]", target: row.closest('[role=\"button\"]')! });
    await user.click(screen.getByRole("menuitem", { name: "Redo workflow" }));
    await user.click(screen.getByRole("button", { name: "Redo" }));

    await waitFor(() => {
      expect(tauriMocks.resetWorkflowStep).toHaveBeenCalledWith(
        "",
        "redo-builder",
        0,
      );
    });

    await waitFor(() => {
      expect(tauriMocks.selectSkillOpenHandsSession).toHaveBeenCalledWith(42);
    });
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkillSummary } from "@/lib/types";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouterState: () => "/",
}));

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: vi.fn((selector) =>
    selector({ workspacePath: "/workspace", isConfigured: true, availableModels: [], preferredModel: null }),
  ),
}));

vi.mock("@/stores/skill-store", () => ({
  useSkillStore: vi.fn((selector) => selector({ skills: [], lockedSkills: new Set() })),
}));

const refineState = vi.hoisted(() => ({
  selectedSkill: null,
  refinableSkills: [],
  isLoadingSkills: false,
  skillFiles: [],
  previewRevision: 0,
  isRunning: false,
  activeAgentId: null,
  sessionId: null,
}));

vi.mock("@/stores/refine-store", () => ({
  useRefineStore: Object.assign(
    vi.fn((selector: (s: typeof refineState) => unknown) => selector(refineState)),
    { getState: () => refineState },
  ),
}));

vi.mock("@/stores/agent-store", () => ({
  useAgentStore: vi.fn((selector) => selector({ runs: {} })),
}));

vi.mock("@/hooks/use-leave-guard", () => ({
  useLeaveGuard: () => ({ blockerStatus: "idle", handleNavStay: vi.fn(), handleNavLeave: vi.fn() }),
}));

vi.mock("@/hooks/use-scope-blocked", () => ({
  useScopeBlocked: () => false,
}));

vi.mock("@/hooks/use-agent-stream", () => ({}));

vi.mock("@/lib/tauri", () => ({
  acquireLock: vi.fn().mockResolvedValue(undefined),
  releaseLock: vi.fn().mockResolvedValue(undefined),
  startRefineSession: vi.fn().mockResolvedValue({ session_id: "test-session" }),
  closeRefineSession: vi.fn().mockResolvedValue(undefined),
  cleanupSkillSidecar: vi.fn().mockResolvedValue(undefined),
  getSkillContentForRefine: vi.fn().mockResolvedValue([]),
  sendRefineMessage: vi.fn().mockResolvedValue("agent-1"),
  finalizeRefineRun: vi.fn().mockResolvedValue({ files: [], diff: null }),
  getSkillHistory: vi.fn().mockResolvedValue([]),
  readLatestBenchmark: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/agent-results", () => ({
  extractStructuredResultPayload: vi.fn().mockReturnValue(null),
}));

vi.mock("@/components/workspace/workspace-refine", () => ({
  WorkspaceRefine: () => <div data-testid="workspace-refine" />,
}));

vi.mock("@/components/refine/chat-panel", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));

vi.mock("@/components/refine/preview-panel", () => ({
  PreviewPanel: () => <div data-testid="preview-panel" />,
}));

vi.mock("@/components/refine/resizable-split-pane", () => ({
  ResizableSplitPane: ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => (
    <div>
      {left}
      {right}
    </div>
  ),
}));

import { WorkspaceShell } from "@/components/workspace/workspace-shell";

const baseBuilderSkill: SkillSummary = {
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
  plugin_slug: "skills",
  plugin_display_name: "Skills",
  is_default_plugin: true,
};

describe("WorkspaceShell", () => {
  it("renders skill name in header", () => {
    render(<WorkspaceShell skill={baseBuilderSkill} skillType="builder" />);

    expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
  });

  it("Overview tab is active by default", () => {
    render(<WorkspaceShell skill={baseBuilderSkill} skillType="builder" />);

    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    const evalsTab = screen.getByRole("tab", { name: "Evals" });
    const descriptionTab = screen.getByRole("tab", { name: "Optimize Description" });

    expect(overviewTab).toHaveAttribute("data-state", "active");
    expect(evalsTab).not.toBeDisabled();
    expect(descriptionTab).not.toBeDisabled();
  });

  it("shows dialog when switching away from Refine while agent is running", async () => {
    const user = userEvent.setup();
    refineState.isRunning = true;

    const { container } = render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="refine" />,
    );

    // Refine tab is active
    const refineTab = container.querySelector('[role="tab"][data-state="active"]');
    expect(refineTab?.textContent).toBe("Refine");

    // Try to switch to Overview — click the first tab trigger
    const overviewTab = container.querySelector('[role="tab"]');
    await user.click(overviewTab!);

    // Dialog should appear
    expect(screen.getByText("Agent Running")).toBeInTheDocument();
    expect(screen.getByText(/agent is still running/i)).toBeInTheDocument();

    // Refine tab should still be active (check via container, not role query — dialog captures aria)
    const stillActive = container.querySelector('[role="tab"][data-state="active"]');
    expect(stillActive?.textContent).toBe("Refine");

    refineState.isRunning = false;
  });

  it("switches tab after confirming Leave in the guard dialog", async () => {
    const user = userEvent.setup();
    refineState.isRunning = true;

    const { container } = render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="refine" />,
    );

    const overviewTab = container.querySelector('[role="tab"]');
    await user.click(overviewTab!);
    expect(screen.getByText("Agent Running")).toBeInTheDocument();

    // Click Leave
    await user.click(screen.getByRole("button", { name: "Leave" }));

    // Overview should now be active
    const activeTab = container.querySelector('[role="tab"][data-state="active"]');
    expect(activeTab?.textContent).toBe("Overview");

    refineState.isRunning = false;
  });

  it("stays on Refine tab when clicking Stay in the guard dialog", async () => {
    const user = userEvent.setup();
    refineState.isRunning = true;

    const { container } = render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="refine" />,
    );

    const overviewTab = container.querySelector('[role="tab"]');
    await user.click(overviewTab!);
    expect(screen.getByText("Agent Running")).toBeInTheDocument();

    // Click Stay
    await user.click(screen.getByRole("button", { name: "Stay" }));

    // Dialog should close, Refine still active
    expect(screen.queryByText("Agent Running")).not.toBeInTheDocument();
    const activeTab = container.querySelector('[role="tab"][data-state="active"]');
    expect(activeTab?.textContent).toBe("Refine");

    refineState.isRunning = false;
  });
});

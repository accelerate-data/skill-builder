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

vi.mock("@/stores/refine-store", () => ({
  useRefineStore: vi.fn((selector) =>
    selector({
      selectedSkill: null,
      refinableSkills: [],
      isLoadingSkills: false,
      skillFiles: [],
      previewRevision: 0,
      isRunning: false,
      activeAgentId: null,
      sessionId: null,
    }),
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
  materializeRefineValidationOutput: vi.fn().mockResolvedValue(undefined),
  getSkillHistory: vi.fn().mockResolvedValue([]),
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
};

describe("WorkspaceShell", () => {
  it("renders skill name, seafoam dot, and Builder badge", () => {
    render(<WorkspaceShell skill={baseBuilderSkill} skillType="builder" />);

    expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    // Version badge removed from header — version history is in overview card
    expect(screen.getByText("Builder")).toBeInTheDocument();

    // Seafoam dot — rendered as a div with seafoam background style
    const dot = document.querySelector('[style*="var(--color-seafoam)"]');
    expect(dot).toBeInTheDocument();
  });

  it("Overview tab is active by default; Evals and Description triggers are disabled", () => {
    render(<WorkspaceShell skill={baseBuilderSkill} skillType="builder" />);

    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    const evalsTab = screen.getByRole("tab", { name: "Evals" });
    const descriptionTab = screen.getByRole("tab", { name: "Description" });

    expect(overviewTab).toHaveAttribute("data-state", "active");
    expect(evalsTab).toBeDisabled();
    expect(descriptionTab).toBeDisabled();
  });

  it('clicking "Open Refine" in WorkspaceOverview switches active tab to Refine', async () => {
    const user = userEvent.setup();
    render(<WorkspaceShell skill={baseBuilderSkill} skillType="builder" />);

    // Overview is showing — find the "Open Refine" button
    const openRefineBtn = screen.getByRole("button", { name: /Open Refine/i });
    await user.click(openRefineBtn);

    const refineTab = screen.getByRole("tab", { name: "Refine" });
    expect(refineTab).toHaveAttribute("data-state", "active");
    // WorkspaceRefine stub is rendered
    expect(screen.getByTestId("workspace-refine")).toBeInTheDocument();
  });
});

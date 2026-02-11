import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAgentStore } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import { resetTauriMocks } from "@/test/mocks/tauri";

// Mock TanStack Router — useBlocker returns idle state by default
const mockBlocker = vi.hoisted(() => ({
  proceed: vi.fn(),
  reset: vi.fn(),
  status: "idle" as string,
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ skillName: "test-skill" }),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  useBlocker: () => mockBlocker,
}));

// Mock sonner — use vi.hoisted so the object is available in hoisted vi.mock factory
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: mockToast,
  Toaster: () => null,
}));

// Mock @/lib/tauri
vi.mock("@/lib/tauri", () => ({
  runWorkflowStep: vi.fn(),
  readFile: vi.fn(() => Promise.reject("not found")),
  getWorkflowState: vi.fn(() => Promise.reject("not found")),
  saveWorkflowState: vi.fn(() => Promise.resolve()),
  resetWorkflowStep: vi.fn(() => Promise.resolve()),
  captureStepArtifacts: vi.fn(() => Promise.resolve([])),
  getArtifactContent: vi.fn(() => Promise.resolve(null)),
  saveArtifactContent: vi.fn(() => Promise.resolve()),
}));

// Mock heavy sub-components to isolate the effect lifecycle
vi.mock("@/components/workflow-sidebar", () => ({
  WorkflowSidebar: () => <div data-testid="workflow-sidebar" />,
}));
vi.mock("@/components/agent-output-panel", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output" />,
}));
vi.mock("@/components/workflow-step-complete", () => ({
  WorkflowStepComplete: () => <div data-testid="step-complete" />,
}));
vi.mock("@/components/reasoning-chat", () => ({
  ReasoningChat: () => <div data-testid="reasoning-chat" />,
}));
vi.mock("@/components/refinement-chat", () => ({
  RefinementChat: () => <div data-testid="refinement-chat" />,
}));

// Import after mocks
import WorkflowPage from "@/pages/workflow";
import { getWorkflowState, saveWorkflowState, getArtifactContent, saveArtifactContent, readFile } from "@/lib/tauri";

describe("WorkflowPage — agent completion lifecycle", () => {
  beforeEach(() => {
    resetTauriMocks();
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();

    // Hydrate settings so workflow handlers don't bail
    useSettingsStore.getState().setSettings({
      workspacePath: "/test/workspace",
      anthropicApiKey: "sk-test",
    });

    mockToast.success.mockClear();
    mockToast.error.mockClear();
    mockToast.info.mockClear();

    // Reset blocker to idle state
    mockBlocker.proceed.mockClear();
    mockBlocker.reset.mockClear();
    mockBlocker.status = "idle";

    // Clear module-level tauri mock call records so tests don't leak
    vi.mocked(saveWorkflowState).mockClear();
    vi.mocked(getWorkflowState).mockClear();
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
  });

  it("auto-advances to next step after agent completion", async () => {
    // Simulate: step 0 is running an agent
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-1", "sonnet");

    render(<WorkflowPage />);

    // Agent completes — step should be marked completed and auto-advance
    act(() => {
      useAgentStore.getState().completeRun("agent-1", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
    });

    const wf = useWorkflowStore.getState();

    // Step 0 completed
    expect(wf.steps[0].status).toBe("completed");

    // Auto-advances to step 1
    expect(wf.currentStep).toBe(1);

    // Step 1 is a human review step — should be set to waiting_for_user
    expect(wf.steps[1].status).toBe("waiting_for_user");

    // No further steps affected
    expect(wf.steps[2].status).toBe("pending");
    expect(wf.steps[3].status).toBe("pending");

    // Running flag cleared
    expect(wf.isRunning).toBe(false);

    expect(mockToast.success).toHaveBeenCalledWith("Step 1 completed");
  });

  it("auto-advances from step 5 (build) to step 6 (validate)", async () => {
    // Simulate: steps 0-4 completed, step 5 running
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    for (let i = 0; i < 5; i++) {
      useWorkflowStore.getState().updateStepStatus(i, "completed");
    }
    useWorkflowStore.getState().setCurrentStep(5);
    useWorkflowStore.getState().updateStepStatus(5, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-build", "sonnet");

    render(<WorkflowPage />);

    // Agent completes step 5 (build)
    act(() => {
      useAgentStore.getState().completeRun("agent-build", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[5].status).toBe("completed");
    });

    const wf = useWorkflowStore.getState();

    // Step 5 completed
    expect(wf.steps[5].status).toBe("completed");

    // Auto-advances to step 6 (validate)
    expect(wf.currentStep).toBe(6);

    // Step 6 is an agent step — stays pending (not waiting_for_user)
    expect(wf.steps[6].status).toBe("pending");

    // Running flag cleared
    expect(wf.isRunning).toBe(false);

    expect(mockToast.success).toHaveBeenCalledWith("Step 6 completed");
  });


  it("marks step as error when agent fails — no cascade", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-1", "sonnet");

    render(<WorkflowPage />);

    // Agent fails
    act(() => {
      useAgentStore.getState().completeRun("agent-1", false);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("error");
    });

    const wf = useWorkflowStore.getState();

    // Step 0 errored
    expect(wf.steps[0].status).toBe("error");

    // Should NOT advance
    expect(wf.currentStep).toBe(0);

    // No further steps affected
    expect(wf.steps[1].status).toBe("pending");

    expect(wf.isRunning).toBe(false);
    expect(mockToast.error).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite saved state during hydration", async () => {
    // Simulate: SQLite has step 0 completed from a previous session
    vi.mocked(getWorkflowState).mockResolvedValueOnce({
      run: {
        skill_name: "test-skill",
        domain: "test domain",
        current_step: 1,
        status: "pending",
        skill_type: "domain",
        created_at: "",
        updated_at: "",
      },
      steps: [
        { skill_name: "test-skill", step_id: 0, status: "completed", started_at: null, completed_at: null },
      ],
    });

    render(<WorkflowPage />);

    // Wait for hydration to complete
    await waitFor(() => {
      expect(useWorkflowStore.getState().hydrated).toBe(true);
    });

    const wf = useWorkflowStore.getState();
    expect(wf.steps[0].status).toBe("completed");
    expect(wf.currentStep).toBe(1);

    // saveWorkflowState should NOT have been called with all-pending state
    // It should only be called after hydration with the correct state
    const saveCalls = vi.mocked(saveWorkflowState).mock.calls;
    for (const call of saveCalls) {
      const stepStatuses = call[4] as Array<{ step_id: number; status: string }>;
      const step0 = stepStatuses.find((s) => s.step_id === 0);
      expect(step0?.status).toBe("completed");
    }
  });

  it("does not complete a step that is not in_progress", async () => {
    // Edge case: agent completion arrives but step is already completed
    // (e.g., from a stale agent)
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().setRunning(false);

    // Stale agent from step 0
    useAgentStore.getState().startRun("stale-agent", "sonnet");
    useAgentStore.getState().completeRun("stale-agent", true);

    render(<WorkflowPage />);

    // Give effects time to fire
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const wf = useWorkflowStore.getState();

    // Step 1 should still be pending — stale completion must not affect it
    expect(wf.steps[1].status).toBe("pending");

    // No toast for stale completion
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("reverts step to pending on unmount when running", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-1", "sonnet");

    const { unmount } = render(<WorkflowPage />);

    // Unmount triggers cleanup (simulates navigating away)
    act(() => {
      unmount();
    });

    // isRunning should be cleared immediately
    expect(useWorkflowStore.getState().isRunning).toBe(false);

    // Step should be reverted to pending (not stuck at in_progress)
    expect(useWorkflowStore.getState().steps[0].status).toBe("pending");
  });

  it("does not revert step on unmount when not running", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setRunning(false);

    const { unmount } = render(<WorkflowPage />);

    act(() => {
      unmount();
    });

    // Completed step should remain completed
    expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
  });

  it("shows nav guard dialog when blocker status is blocked", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-1", "sonnet");

    // Simulate blocker triggered by navigation attempt
    mockBlocker.status = "blocked";

    const { getByText } = render(<WorkflowPage />);

    // Dialog should be visible
    expect(getByText("Agent Running")).toBeTruthy();
    expect(getByText("Stay")).toBeTruthy();
    expect(getByText("Leave")).toBeTruthy();
  });

  it("clears stale agent data when switching skills", async () => {
    // Simulate: stale agent data from a previous skill
    useAgentStore.getState().startRun("old-agent", "sonnet");
    useAgentStore.getState().completeRun("old-agent", true);
    useAgentStore.getState().setActiveAgent("old-agent");

    expect(useAgentStore.getState().activeAgentId).toBe("old-agent");

    // Render triggers init effect which should clear agent store
    render(<WorkflowPage />);

    await waitFor(() => {
      expect(useWorkflowStore.getState().hydrated).toBe(true);
    });

    // Stale agent data should be cleared
    expect(useAgentStore.getState().activeAgentId).toBeNull();
    expect(Object.keys(useAgentStore.getState().runs)).toHaveLength(0);
  });

  it("shows Resume when partial output exists on disk but not in SQLite", async () => {
    // Simulate: step 0 was interrupted — files on disk but never captured to SQLite
    vi.mocked(getArtifactContent).mockResolvedValue(null);
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path.includes("clarifications-concepts.md")) {
        return Promise.resolve("# Partial research output");
      }
      return Promise.reject("not found");
    });

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);

    render(<WorkflowPage />);

    // Filesystem fallback should detect partial output → show "Resume"
    await waitFor(() => {
      expect(screen.queryByText("Resume")).toBeTruthy();
    });
  });

  it("does not show Resume when no partial output exists anywhere", async () => {
    // Neither SQLite nor filesystem has output
    vi.mocked(getArtifactContent).mockResolvedValue(null);
    vi.mocked(readFile).mockRejectedValue("not found");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);

    render(<WorkflowPage />);

    // Wait for effects to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // "Resume" should NOT appear — no partial output anywhere
    expect(screen.queryByText("Resume")).toBeNull();
  });

  it("shows Resume when partial output exists in SQLite", async () => {
    // SQLite has the artifact — no filesystem fallback needed
    vi.mocked(getArtifactContent).mockResolvedValue({
      skill_name: "test-skill",
      step_id: 0,
      relative_path: "context/clarifications-concepts.md",
      content: "# Research output from SQLite",
      size_bytes: 100,
      created_at: "",
      updated_at: "",
    });

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.queryByText("Resume")).toBeTruthy();
    });
  });

  it("renders completion screen on last step (step 8)", async () => {
    // Simulate all steps complete, on step 8 (the last step)
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    for (let i = 0; i < 9; i++) {
      useWorkflowStore.getState().updateStepStatus(i, "completed");
    }
    useWorkflowStore.getState().setCurrentStep(8);

    // No artifact
    vi.mocked(getArtifactContent).mockResolvedValue(null);

    render(<WorkflowPage />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Should render completion screen
    expect(screen.queryByTestId("step-complete")).toBeTruthy();
  });

  it("renders RefinementChat on step 8 when step is not completed", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    // Complete steps 0-7 so we can be on step 8
    for (let i = 0; i < 8; i++) {
      useWorkflowStore.getState().updateStepStatus(i, "completed");
    }
    useWorkflowStore.getState().setCurrentStep(8);

    vi.mocked(getArtifactContent).mockResolvedValue(null);

    render(<WorkflowPage />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // RefinementChat should be rendered
    expect(screen.queryByTestId("refinement-chat")).toBeTruthy();
  });

  it("shows Mark Complete and Skip buttons on refinement step", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    for (let i = 0; i < 8; i++) {
      useWorkflowStore.getState().updateStepStatus(i, "completed");
    }
    useWorkflowStore.getState().setCurrentStep(8);

    vi.mocked(getArtifactContent).mockResolvedValue(null);

    render(<WorkflowPage />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Both buttons should be present
    expect(screen.getByText("Mark Complete")).toBeTruthy();
    expect(screen.getByText("Skip")).toBeTruthy();
  });

  it("Mark Complete button marks step 8 as completed", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    for (let i = 0; i < 8; i++) {
      useWorkflowStore.getState().updateStepStatus(i, "completed");
    }
    useWorkflowStore.getState().setCurrentStep(8);

    vi.mocked(getArtifactContent).mockResolvedValue(null);

    render(<WorkflowPage />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Click Mark Complete
    const markCompleteBtn = screen.getByText("Mark Complete");
    act(() => {
      markCompleteBtn.click();
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[8].status).toBe("completed");
    });

    expect(mockToast.success).toHaveBeenCalledWith("Step 9 marked complete");
  });

  it("Skip button marks step 8 as completed", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    for (let i = 0; i < 8; i++) {
      useWorkflowStore.getState().updateStepStatus(i, "completed");
    }
    useWorkflowStore.getState().setCurrentStep(8);

    vi.mocked(getArtifactContent).mockResolvedValue(null);

    render(<WorkflowPage />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Click Skip
    const skipBtn = screen.getByText("Skip");
    act(() => {
      skipBtn.click();
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[8].status).toBe("completed");
    });

    expect(mockToast.success).toHaveBeenCalledWith("Step 9 skipped");
  });

  it("does not show Mark Complete / Skip buttons when step 8 is completed", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    for (let i = 0; i < 9; i++) {
      useWorkflowStore.getState().updateStepStatus(i, "completed");
    }
    useWorkflowStore.getState().setCurrentStep(8);

    vi.mocked(getArtifactContent).mockResolvedValue(null);

    render(<WorkflowPage />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Buttons should NOT appear when step is already completed
    expect(screen.queryByText("Mark Complete")).toBeNull();
    expect(screen.queryByText("Skip")).toBeNull();
  });
});

describe("WorkflowPage — human review file loading priority", () => {
  beforeEach(() => {
    resetTauriMocks();
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();

    useSettingsStore.getState().setSettings({
      workspacePath: "/test/workspace",
      skillsPath: "/test/skills",
      anthropicApiKey: "sk-test",
    });

    mockToast.success.mockClear();
    mockToast.error.mockClear();
    mockToast.info.mockClear();
    mockBlocker.proceed.mockClear();
    mockBlocker.reset.mockClear();
    mockBlocker.status = "idle";

    vi.mocked(saveWorkflowState).mockClear();
    vi.mocked(getWorkflowState).mockClear();
    vi.mocked(getArtifactContent).mockClear();
    vi.mocked(readFile).mockClear();
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
  });

  it("loads review content from skillsPath context directory first", async () => {
    // skillsPath has the file — should use it even though SQLite and workspace also have content
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications-concepts.md") {
        return Promise.resolve("# From skills context dir");
      }
      if (path === "/test/workspace/test-skill/context/clarifications-concepts.md") {
        return Promise.resolve("# From workspace");
      }
      return Promise.reject("not found");
    });
    vi.mocked(getArtifactContent).mockResolvedValue({
      skill_name: "test-skill",
      step_id: 0,
      relative_path: "context/clarifications-concepts.md",
      content: "# From SQLite",
      size_bytes: 50,
      created_at: "",
      updated_at: "",
    });

    // Navigate to step 1 (human review for concepts)
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "waiting_for_user");

    render(<WorkflowPage />);

    // Should show content from skills context directory
    await waitFor(() => {
      expect(screen.getByText("From skills context dir")).toBeTruthy();
    });

    // readFile should have been called with the skillsPath location first
    expect(vi.mocked(readFile)).toHaveBeenCalledWith(
      "/test/skills/test-skill/context/clarifications-concepts.md"
    );
  });

  it("falls back to SQLite when skillsPath context file is not found", async () => {
    // skillsPath does NOT have the file — should fall back to SQLite
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path.startsWith("/test/skills/")) {
        return Promise.reject("not found");
      }
      if (path === "/test/workspace/test-skill/context/clarifications-concepts.md") {
        return Promise.resolve("# From workspace");
      }
      return Promise.reject("not found");
    });
    vi.mocked(getArtifactContent).mockResolvedValue({
      skill_name: "test-skill",
      step_id: 0,
      relative_path: "context/clarifications-concepts.md",
      content: "# From SQLite",
      size_bytes: 50,
      created_at: "",
      updated_at: "",
    });

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "waiting_for_user");

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByText("From SQLite")).toBeTruthy();
    });
  });

  it("falls back to workspace filesystem when both skillsPath and SQLite fail", async () => {
    // Neither skillsPath nor SQLite has the content — workspace should be used
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path.startsWith("/test/skills/")) {
        return Promise.reject("not found");
      }
      if (path === "/test/workspace/test-skill/context/clarifications-concepts.md") {
        return Promise.resolve("# From workspace fallback");
      }
      return Promise.reject("not found");
    });
    vi.mocked(getArtifactContent).mockResolvedValue(null);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "waiting_for_user");

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByText("From workspace fallback")).toBeTruthy();
    });
  });

  it("skips skillsPath lookup when skillsPath is null", async () => {
    // No skillsPath configured — should go straight to SQLite then workspace
    useSettingsStore.getState().setSettings({
      workspacePath: "/test/workspace",
      skillsPath: null,
      anthropicApiKey: "sk-test",
    });

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/workspace/test-skill/context/clarifications-concepts.md") {
        return Promise.resolve("# From workspace (no skillsPath)");
      }
      return Promise.reject("not found");
    });
    vi.mocked(getArtifactContent).mockResolvedValue(null);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "waiting_for_user");

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByText("From workspace (no skillsPath)")).toBeTruthy();
    });

    // readFile should NOT have been called with any skills path
    const readFileCalls = vi.mocked(readFile).mock.calls.map((c) => c[0]);
    expect(readFileCalls.some((p) => p.includes("/test/skills/"))).toBe(false);
  });

  it("uses skillsPath context dir for step 3 (clarifications.md) too", async () => {
    // Step 3 reviews clarifications.md — same priority should apply
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications.md") {
        return Promise.resolve("# Merged clarifications from skills dir");
      }
      return Promise.reject("not found");
    });
    vi.mocked(getArtifactContent).mockResolvedValue(null);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().updateStepStatus(2, "completed");
    useWorkflowStore.getState().setCurrentStep(3);
    useWorkflowStore.getState().updateStepStatus(3, "waiting_for_user");

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByText("Merged clarifications from skills dir")).toBeTruthy();
    });

    expect(vi.mocked(readFile)).toHaveBeenCalledWith(
      "/test/skills/test-skill/context/clarifications.md"
    );
  });
});

describe("WorkflowPage — VD-410 human review behavior", () => {
  beforeEach(() => {
    resetTauriMocks();
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();

    useSettingsStore.getState().setSettings({
      workspacePath: "/test/workspace",
      skillsPath: "/test/skills",
      anthropicApiKey: "sk-test",
    });

    mockToast.success.mockClear();
    mockToast.error.mockClear();
    mockToast.info.mockClear();
    mockBlocker.proceed.mockClear();
    mockBlocker.reset.mockClear();
    mockBlocker.status = "idle";

    vi.mocked(saveWorkflowState).mockClear();
    vi.mocked(getWorkflowState).mockClear();
    vi.mocked(getArtifactContent).mockClear();
    vi.mocked(readFile).mockClear();
    vi.mocked(saveArtifactContent).mockClear();
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
  });

  it("Complete Step saves content as-is without auto-fill", async () => {
    // Content with empty Answer fields — should NOT be auto-filled
    const reviewContent = [
      "## Question 1",
      "**Recommendation**: Use incremental loads for large tables",
      "**Answer**: ",
      "",
      "## Question 2",
      "**Recommendation**: Partition by date for time-series data",
      "**Answer**: ",
    ].join("\n");

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications-concepts.md") {
        return Promise.resolve(reviewContent);
      }
      return Promise.reject("not found");
    });
    vi.mocked(getArtifactContent).mockResolvedValue(null);

    // Set up step 1 (human review for concepts)
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "waiting_for_user");

    render(<WorkflowPage />);

    // Wait for review content to load and Complete Step button to appear
    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeTruthy();
    });

    // Click "Complete Step"
    act(() => {
      screen.getByText("Complete Step").click();
    });

    // saveArtifactContent should be called with the ORIGINAL content (empty answers preserved)
    await waitFor(() => {
      expect(vi.mocked(saveArtifactContent)).toHaveBeenCalledTimes(1);
    });

    const savedContent = vi.mocked(saveArtifactContent).mock.calls[0][3];
    expect(savedContent).toBe(reviewContent);

    // Verify no auto-fill happened
    expect(savedContent).not.toContain("auto-selected from recommendation");

    // Empty answers should still be empty
    expect(savedContent).toContain("**Answer**: \n");

    // Step should be marked completed and advanced
    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[1].status).toBe("completed");
      expect(useWorkflowStore.getState().currentStep).toBe(2);
    });
  });

  it("debug mode does not auto-advance human review steps", async () => {
    // Enable debug mode
    useSettingsStore.getState().setSettings({ debugMode: true });

    const reviewContent = "## Question 1\n**Recommendation**: test\n**Answer**: \n";

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications-concepts.md") {
        return Promise.resolve(reviewContent);
      }
      return Promise.reject("not found");
    });
    vi.mocked(getArtifactContent).mockResolvedValue(null);

    // Set up step 1 (human review)
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "waiting_for_user");

    render(<WorkflowPage />);

    // Wait for review content to load
    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeTruthy();
    });

    // Give effects time to settle — debug auto-advance should NOT trigger
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // Step should still be waiting_for_user — NOT auto-completed
    expect(useWorkflowStore.getState().steps[1].status).toBe("waiting_for_user");

    // Should still be on step 1 — NOT advanced
    expect(useWorkflowStore.getState().currentStep).toBe(1);
  });

  it("preserves partially filled answers", async () => {
    // Content with mixed answers — some filled, some empty
    const reviewContent = [
      "## Question 1",
      "**Recommendation**: Use incremental loads",
      "**Answer**: We use full refresh for this table",
      "",
      "## Question 2",
      "**Recommendation**: Partition by date",
      "**Answer**: ",
      "",
      "## Question 3",
      "**Recommendation**: Add surrogate keys",
      "**Answer**: Already using natural keys, no change needed",
    ].join("\n");

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications-concepts.md") {
        return Promise.resolve(reviewContent);
      }
      return Promise.reject("not found");
    });
    vi.mocked(getArtifactContent).mockResolvedValue(null);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "waiting_for_user");

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeTruthy();
    });

    act(() => {
      screen.getByText("Complete Step").click();
    });

    await waitFor(() => {
      expect(vi.mocked(saveArtifactContent)).toHaveBeenCalledTimes(1);
    });

    const savedContent = vi.mocked(saveArtifactContent).mock.calls[0][3];

    // User-filled answers should be preserved
    expect(savedContent).toContain("**Answer**: We use full refresh for this table");
    expect(savedContent).toContain("**Answer**: Already using natural keys, no change needed");

    // Empty answer should still be empty — not auto-filled
    expect(savedContent).toContain("**Answer**: \n");
  });

  it("step 3 human review also saves without auto-fill", async () => {
    // Step 3 reviews clarifications.md — same behavior expected
    const reviewContent = [
      "## Merged Question 1",
      "**Recommendation**: Normalize customer dimensions",
      "**Answer**: ",
      "",
      "## Merged Question 2",
      "**Recommendation**: Use SCD Type 2 for slowly changing dims",
      "**Answer**: ",
    ].join("\n");

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications.md") {
        return Promise.resolve(reviewContent);
      }
      return Promise.reject("not found");
    });
    vi.mocked(getArtifactContent).mockResolvedValue(null);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().updateStepStatus(2, "completed");
    useWorkflowStore.getState().setCurrentStep(3);
    useWorkflowStore.getState().updateStepStatus(3, "waiting_for_user");

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeTruthy();
    });

    act(() => {
      screen.getByText("Complete Step").click();
    });

    await waitFor(() => {
      expect(vi.mocked(saveArtifactContent)).toHaveBeenCalledTimes(1);
    });

    // Verify it saved to the correct artifact path for step 3
    expect(vi.mocked(saveArtifactContent)).toHaveBeenCalledWith(
      "test-skill",
      3,
      "context/clarifications.md",
      reviewContent,
    );

    const savedContent = vi.mocked(saveArtifactContent).mock.calls[0][3];

    // Empty answers should remain empty — no auto-fill
    expect(savedContent).not.toContain("auto-selected from recommendation");
    expect(savedContent).toBe(reviewContent);

    // Step should be marked completed and advanced
    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[3].status).toBe("completed");
      expect(useWorkflowStore.getState().currentStep).toBe(4);
    });
  });
});

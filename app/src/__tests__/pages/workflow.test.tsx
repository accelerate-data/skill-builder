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
const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ skillName: "test-skill" }),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  useBlocker: () => mockBlocker,
  useNavigate: () => mockNavigate,
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
  writeFile: vi.fn(() => Promise.resolve()),
  getWorkflowState: vi.fn(() => Promise.reject("not found")),
  saveWorkflowState: vi.fn(() => Promise.resolve()),
  resetWorkflowStep: vi.fn(() => Promise.resolve()),
  cleanupSkillSidecar: vi.fn(() => Promise.resolve()),
  acquireLock: vi.fn(() => Promise.resolve()),
  releaseLock: vi.fn(() => Promise.resolve()),
  persistAgentRun: vi.fn(() => Promise.resolve()),
  createWorkflowSession: vi.fn(() => Promise.resolve()),
  endWorkflowSession: vi.fn(() => Promise.resolve()),
  verifyStepOutput: vi.fn(() => Promise.resolve(true)),
  previewStepReset: vi.fn(() => Promise.resolve([])),
}));

// Mock MDEditor — renders a textarea that calls onChange on input
vi.mock("@uiw/react-md-editor", () => ({
  __esModule: true,
  default: ({ value, onChange, ...rest }: { value?: string; onChange?: (val?: string) => void; [key: string]: unknown }) => (
    <textarea
      data-testid="md-editor"
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
      {...Object.fromEntries(Object.entries(rest).filter(([k]) => !["visibleDragbar"].includes(k)))}
    />
  ),
}));

// Mock heavy sub-components to isolate the effect lifecycle
vi.mock("@/components/workflow-sidebar", () => ({
  WorkflowSidebar: vi.fn(() => <div data-testid="workflow-sidebar" />),
}));
vi.mock("@/components/agent-output-panel", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output" />,
}));
vi.mock("@/components/workflow-step-complete", () => ({
  WorkflowStepComplete: () => (
    <div data-testid="step-complete" />
  ),
}));
vi.mock("@/components/reasoning-review", () => ({
  ReasoningReview: () => <div data-testid="reasoning-review" />,
}));

// Import after mocks
import WorkflowPage from "@/pages/workflow";
import { getWorkflowState, saveWorkflowState, writeFile, readFile, runWorkflowStep, resetWorkflowStep, cleanupSkillSidecar, endWorkflowSession, previewStepReset } from "@/lib/tauri";
import { WorkflowSidebar } from "@/components/workflow-sidebar";

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

    // Agent completes — should auto-advance to step 1 (human review)
    act(() => {
      useAgentStore.getState().completeRun("agent-1", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
    });

    const wf = useWorkflowStore.getState();

    // Auto-advanced to step 1 which shows the editor immediately
    expect(wf.currentStep).toBe(1);
    expect(wf.steps[1].status).toBe("waiting_for_user");

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

  it("calls cleanupSkillSidecar on unmount when running", async () => {
    vi.mocked(cleanupSkillSidecar).mockClear();

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-1", "sonnet");

    const { unmount } = render(<WorkflowPage />);

    act(() => {
      unmount();
    });

    // cleanupSkillSidecar should be called with the skill name
    expect(vi.mocked(cleanupSkillSidecar)).toHaveBeenCalledWith("test-skill");
  });

  it("calls endWorkflowSession on unmount when session is active", async () => {
    vi.mocked(endWorkflowSession).mockClear();

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setRunning(true);
    const sessionId = useWorkflowStore.getState().workflowSessionId;
    expect(sessionId).toBeTruthy();

    const { unmount } = render(<WorkflowPage />);

    act(() => {
      unmount();
    });

    expect(vi.mocked(endWorkflowSession)).toHaveBeenCalledWith(sessionId);
  });

  it("calls cleanupSkillSidecar on unmount even when not running", async () => {
    vi.mocked(cleanupSkillSidecar).mockClear();

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setRunning(false);

    const { unmount } = render(<WorkflowPage />);

    act(() => {
      unmount();
    });

    // cleanupSkillSidecar should still be called (persistent sidecar cleanup)
    expect(vi.mocked(cleanupSkillSidecar)).toHaveBeenCalledWith("test-skill");
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

  it("shows Resume when partial output exists on disk", async () => {
    // Simulate: step 0 was interrupted — files on disk from a previous run
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path.includes("clarifications.md")) {
        return Promise.resolve("# Partial research output");
      }
      return Promise.reject("not found");
    });

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);

    render(<WorkflowPage />);

    // Filesystem fallback should detect partial output -> show "Resume"
    await waitFor(() => {
      expect(screen.queryByText("Resume")).toBeTruthy();
    });
  });

  it("does not show Resume when no partial output exists anywhere", async () => {
    // Filesystem has no output
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

  it("renders completion screen on last step (step 6)", async () => {
    // Simulate all steps complete, on step 6 (the last step)
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    for (let i = 0; i < 7; i++) {
      useWorkflowStore.getState().updateStepStatus(i, "completed");
    }
    useWorkflowStore.getState().setCurrentStep(6);

    render(<WorkflowPage />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Should render completion screen
    expect(screen.queryByTestId("step-complete")).toBeTruthy();
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
    vi.mocked(readFile).mockClear();
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
  });

  it("loads review content from skillsPath context directory first", async () => {
    // skillsPath has the file — should use it even though workspace also has content
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications.md") {
        return Promise.resolve("# From skills context dir");
      }
      if (path === "/test/workspace/test-skill/context/clarifications.md") {
        return Promise.resolve("# From workspace");
      }
      return Promise.reject("not found");
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
      "/test/skills/test-skill/context/clarifications.md"
    );
  });

  it("falls back to workspace when skillsPath context file is not found", async () => {
    // skillsPath does NOT have the file — should fall back to workspace
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path.startsWith("/test/skills/")) {
        return Promise.reject("not found");
      }
      if (path === "/test/workspace/test-skill/context/clarifications.md") {
        return Promise.resolve("# From workspace");
      }
      return Promise.reject("not found");
    });

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "waiting_for_user");

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByText("From workspace")).toBeTruthy();
    });
  });

  it("skips skillsPath lookup when skillsPath is null", async () => {
    // No skillsPath configured — should go straight to workspace
    useSettingsStore.getState().setSettings({
      workspacePath: "/test/workspace",
      skillsPath: null,
      anthropicApiKey: "sk-test",
    });

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/workspace/test-skill/context/clarifications.md") {
        return Promise.resolve("# From workspace (no skillsPath)");
      }
      return Promise.reject("not found");
    });

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

  it("uses skillsPath context dir for step 3 (clarifications-detailed.md) too", async () => {
    // Step 3 reviews clarifications-detailed.md — same priority should apply
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications-detailed.md") {
        return Promise.resolve("# Merged clarifications from skills dir");
      }
      return Promise.reject("not found");
    });
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
      "/test/skills/test-skill/context/clarifications-detailed.md"
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
    vi.mocked(readFile).mockClear();
    vi.mocked(writeFile).mockClear();
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
      if (path === "/test/skills/test-skill/context/clarifications.md") {
        return Promise.resolve(reviewContent);
      }
      return Promise.reject("not found");
    });

    // Set up step 1 (human review for concepts)
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
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

    // writeFile should be called with the ORIGINAL content (empty answers preserved)
    await waitFor(() => {
      expect(vi.mocked(writeFile)).toHaveBeenCalledTimes(1);
    });

    const writePath = vi.mocked(writeFile).mock.calls[0][0];
    const savedContent = vi.mocked(writeFile).mock.calls[0][1];
    expect(writePath).toBe("/test/workspace/test-skill/context/clarifications.md");
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

  it("auto-advances to human review step and sets waiting_for_user", async () => {
    // Simulate: step 0 is running an agent (step 1 is human review)
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-1", "sonnet");

    render(<WorkflowPage />);

    // Agent completes step 0
    act(() => {
      useAgentStore.getState().completeRun("agent-1", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
    });

    const wf = useWorkflowStore.getState();

    // Should auto-advance to step 1 and show editor immediately
    expect(wf.currentStep).toBe(1);
    // Human review step set to waiting_for_user (not auto-completed)
    expect(wf.steps[1].status).toBe("waiting_for_user");
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
      if (path === "/test/skills/test-skill/context/clarifications.md") {
        return Promise.resolve(reviewContent);
      }
      return Promise.reject("not found");
    });
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
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
      expect(vi.mocked(writeFile)).toHaveBeenCalledTimes(1);
    });

    const savedContent = vi.mocked(writeFile).mock.calls[0][1];

    // User-filled answers should be preserved
    expect(savedContent).toContain("**Answer**: We use full refresh for this table");
    expect(savedContent).toContain("**Answer**: Already using natural keys, no change needed");

    // Empty answer should still be empty — not auto-filled
    expect(savedContent).toContain("**Answer**: \n");
  });

  it("step 3 human review also saves without auto-fill", async () => {
    // Step 3 reviews clarifications-detailed.md — same behavior expected
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
      if (path === "/test/skills/test-skill/context/clarifications-detailed.md") {
        return Promise.resolve(reviewContent);
      }
      return Promise.reject("not found");
    });
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
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
      expect(vi.mocked(writeFile)).toHaveBeenCalledTimes(1);
    });

    // Verify it saved to the correct filesystem path for step 3
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
      "/test/workspace/test-skill/context/clarifications-detailed.md",
      reviewContent,
    );

    const savedContent = vi.mocked(writeFile).mock.calls[0][1];

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

describe("WorkflowPage — reset flow session lifecycle", () => {
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
    vi.mocked(readFile).mockClear();
    vi.mocked(writeFile).mockClear();
    vi.mocked(runWorkflowStep).mockClear();
    vi.mocked(resetWorkflowStep).mockClear();
    vi.mocked(endWorkflowSession).mockClear();
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
    // Restore the default sidebar mock in case a test overrode it
    vi.mocked(WorkflowSidebar).mockImplementation(() => <div data-testid="workflow-sidebar" />);
  });

  it("calls endWorkflowSession on error state reset button", async () => {
    // Set up workflow with an active session
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().setRunning(true); // creates a session ID
    const sessionId = useWorkflowStore.getState().workflowSessionId;
    expect(sessionId).toBeTruthy();

    // Put step 0 in error state (agent failed, not running anymore)
    useWorkflowStore.getState().updateStepStatus(0, "error");
    useWorkflowStore.getState().setRunning(false);

    // readFile rejects — no partial artifacts on disk
    vi.mocked(readFile).mockRejectedValue("not found");

    render(<WorkflowPage />);

    // Wait for the error UI to render with the "Reset Step" button
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Reset Step/ })).toBeTruthy();
    });

    // Click the "Reset Step" button (no artifacts → no confirmation dialog)
    await act(async () => {
      screen.getByRole("button", { name: /Reset Step/ }).click();
    });

    // endWorkflowSession should have been called with the session ID
    expect(vi.mocked(endWorkflowSession)).toHaveBeenCalledWith(sessionId);
  });

  it("calls endWorkflowSession on reset confirmation dialog", async () => {
    // Set up workflow with an active session
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().setRunning(true); // creates a session ID
    const sessionId = useWorkflowStore.getState().workflowSessionId;
    expect(sessionId).toBeTruthy();

    // Put step 0 in error state
    useWorkflowStore.getState().updateStepStatus(0, "error");
    useWorkflowStore.getState().setRunning(false);

    // readFile returns content for the step's output file -> errorHasArtifacts = true
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path.includes("clarifications.md")) {
        return Promise.resolve("partial content");
      }
      return Promise.reject("not found");
    });

    render(<WorkflowPage />);

    // Wait for artifact detection and error UI to render
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Reset Step/ })).toBeTruthy();
    });

    // Click "Reset Step" — should show confirmation dialog (since artifacts exist)
    await act(async () => {
      screen.getByRole("button", { name: /Reset Step/ }).click();
    });

    // Confirmation dialog should appear with "Reset Step?" title
    await waitFor(() => {
      expect(screen.getByText("Reset Step?")).toBeTruthy();
    });

    // Click "Reset" in the confirmation dialog (destructive variant)
    await act(async () => {
      screen.getByRole("button", { name: "Reset" }).click();
    });

    // endWorkflowSession should have been called with the session ID
    expect(vi.mocked(endWorkflowSession)).toHaveBeenCalledWith(sessionId);
  });

  it("calls endWorkflowSession on ResetStepDialog reset", async () => {
    // Override WorkflowSidebar mock to expose onStepClick for this test
    vi.mocked(WorkflowSidebar).mockImplementation(({ onStepClick }: { onStepClick?: (id: number) => void }) => (
      <div data-testid="workflow-sidebar">
        <button data-testid="sidebar-step-0" onClick={() => onStepClick?.(0)}>Step 0</button>
      </div>
    ));

    // Mock previewStepReset so the ResetStepDialog can load
    vi.mocked(previewStepReset).mockResolvedValue([]);

    // Set up workflow with an active session
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().setRunning(true); // creates a session ID
    const sessionId = useWorkflowStore.getState().workflowSessionId;
    expect(sessionId).toBeTruthy();

    // Complete steps 0-2 and navigate to step 3
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().updateStepStatus(2, "completed");
    useWorkflowStore.getState().setCurrentStep(3);
    useWorkflowStore.getState().setRunning(false);

    render(<WorkflowPage />);

    // Click step 0 in the sidebar — triggers ResetStepDialog (since step 0 < currentStep 3)
    await act(async () => {
      screen.getByTestId("sidebar-step-0").click();
    });

    // ResetStepDialog should appear
    await waitFor(() => {
      expect(screen.getByText("Reset to Earlier Step")).toBeTruthy();
    });

    // Wait for the preview to load and the Reset button to be enabled
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reset" })).toBeEnabled();
    });

    // Click "Reset" in the ResetStepDialog
    await act(async () => {
      screen.getByRole("button", { name: "Reset" }).click();
    });

    // endWorkflowSession should have been called with the session ID
    await waitFor(() => {
      expect(vi.mocked(endWorkflowSession)).toHaveBeenCalledWith(sessionId);
    });
  });
});

describe("WorkflowPage — VD-615 markdown editor", () => {
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
    vi.mocked(readFile).mockClear();
    vi.mocked(writeFile).mockClear();
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
  });

  /** Helper: set up step 1 (human review) with content loaded */
  function setupHumanReviewStep(content: string) {
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications.md") {
        return Promise.resolve(content);
      }
      return Promise.reject("not found");
    });

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "waiting_for_user");
  }

  it("renders MDEditor textarea when in active editing mode", async () => {
    setupHumanReviewStep("# Test Content");
    render(<WorkflowPage />);

    // Wait for editor to appear AND editorContent to sync from reviewContent
    await waitFor(() => {
      const textarea = screen.getByTestId("md-editor") as HTMLTextAreaElement;
      expect(textarea.value).toBe("# Test Content");
    });
  });

  it("Save button is disabled when there are no unsaved changes", async () => {
    setupHumanReviewStep("# No changes");
    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByTestId("md-editor")).toBeTruthy();
    });

    // Save button should be present but disabled
    const saveButton = screen.getByRole("button", { name: /Save/ });
    expect(saveButton).toBeDisabled();
  });

  it("Save button calls writeFile with correct path and editor content", async () => {
    setupHumanReviewStep("# Original");
    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByTestId("md-editor")).toBeTruthy();
    });

    // Simulate editing
    const textarea = screen.getByTestId("md-editor") as HTMLTextAreaElement;
    await act(async () => {
      // Fire change event to update editorContent
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      )?.set;
      nativeInputValueSetter?.call(textarea, "# Edited content");
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Save button should be enabled now
    await waitFor(() => {
      const saveButton = screen.getByRole("button", { name: /Save/ });
      expect(saveButton).toBeEnabled();
    });

    // Click save
    await act(async () => {
      screen.getByRole("button", { name: /Save/ }).click();
    });

    await waitFor(() => {
      expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
        "/test/workspace/test-skill/context/clarifications.md",
        "# Edited content",
      );
    });

    expect(mockToast.success).toHaveBeenCalledWith("Saved");
  });

  it("shows unsaved indicator dot when content is modified", async () => {
    setupHumanReviewStep("# Original");
    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByTestId("md-editor")).toBeTruthy();
    });

    // Initially no unsaved indicator
    expect(document.querySelector(".bg-orange-500")).toBeNull();

    // Edit content
    const textarea = screen.getByTestId("md-editor") as HTMLTextAreaElement;
    await act(async () => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      )?.set;
      nativeInputValueSetter?.call(textarea, "# Modified");
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Unsaved indicator (orange dot) should appear
    await waitFor(() => {
      expect(document.querySelector(".bg-orange-500")).toBeTruthy();
    });
  });

  it("Complete Step with unsaved changes shows confirmation dialog", async () => {
    setupHumanReviewStep("# Original");
    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByTestId("md-editor")).toBeTruthy();
    });

    // Edit content to create unsaved changes
    const textarea = screen.getByTestId("md-editor") as HTMLTextAreaElement;
    await act(async () => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      )?.set;
      nativeInputValueSetter?.call(textarea, "# Edited");
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Wait for the Save button to become enabled (confirms unsaved changes are detected)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Save/ })).toBeEnabled();
    });

    // Click "Complete Step"
    await act(async () => {
      screen.getByRole("button", { name: /Complete Step/ }).click();
    });

    // Unsaved changes dialog should appear
    await waitFor(() => {
      expect(screen.getByText("Unsaved Changes")).toBeTruthy();
      expect(screen.getByText("Save & Continue")).toBeTruthy();
      expect(screen.getByText("Discard & Continue")).toBeTruthy();
    });
  });

  it("Save & Continue saves then completes the step", async () => {
    setupHumanReviewStep("# Original");
    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByTestId("md-editor")).toBeTruthy();
    });

    // Edit content
    const textarea = screen.getByTestId("md-editor") as HTMLTextAreaElement;
    await act(async () => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      )?.set;
      nativeInputValueSetter?.call(textarea, "# Save and continue");
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Save/ })).toBeEnabled();
    });

    // Click "Complete Step" → shows dialog
    await act(async () => {
      screen.getByRole("button", { name: /Complete Step/ }).click();
    });

    await waitFor(() => {
      expect(screen.getByText("Save & Continue")).toBeTruthy();
    });

    // Click "Save & Continue"
    await act(async () => {
      screen.getByText("Save & Continue").click();
    });

    // writeFile should be called exactly once (from handleSave only — handleAdvanceStep skips write)
    await waitFor(() => {
      expect(vi.mocked(writeFile)).toHaveBeenCalledTimes(1);
    });

    // The save handler writes the editor content
    const saveCall = vi.mocked(writeFile).mock.calls[0];
    expect(saveCall[0]).toBe("/test/workspace/test-skill/context/clarifications.md");
    expect(saveCall[1]).toBe("# Save and continue");

    // Step should be completed and advanced
    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[1].status).toBe("completed");
      expect(useWorkflowStore.getState().currentStep).toBe(2);
    });
  });

  it("Discard & Continue completes without saving editor changes", async () => {
    setupHumanReviewStep("# Original");
    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByTestId("md-editor")).toBeTruthy();
    });

    // Edit content
    const textarea = screen.getByTestId("md-editor") as HTMLTextAreaElement;
    await act(async () => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      )?.set;
      nativeInputValueSetter?.call(textarea, "# Discarded edits");
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Save/ })).toBeEnabled();
    });

    // Click "Complete Step" → shows dialog
    await act(async () => {
      screen.getByRole("button", { name: /Complete Step/ }).click();
    });

    await waitFor(() => {
      expect(screen.getByText("Discard & Continue")).toBeTruthy();
    });

    // Click "Discard & Continue"
    await act(async () => {
      screen.getByText("Discard & Continue").click();
    });

    // Discard path uses handleAdvanceStep — no writeFile call
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();

    // Step should be completed and advanced
    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[1].status).toBe("completed");
      expect(useWorkflowStore.getState().currentStep).toBe(2);
    });
  });

  it("shows nav guard with unsaved changes text when blocker is triggered", async () => {
    setupHumanReviewStep("# Original");

    // Simulate blocker triggered (not running, so it must be unsaved changes)
    mockBlocker.status = "blocked";

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByText("Unsaved Changes")).toBeTruthy();
      expect(screen.getByText("You have unsaved edits that will be lost if you leave.")).toBeTruthy();
    });
  });

  it("shows nav guard with agent running text when agent is running", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-1", "sonnet");

    mockBlocker.status = "blocked";

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByText("Agent Running")).toBeTruthy();
      expect(screen.getByText("An agent is still running on this step. Leaving will abandon it.")).toBeTruthy();
    });
  });
});

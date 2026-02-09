import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAgentStore } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import { resetTauriMocks } from "@/test/mocks/tauri";

// Mock TanStack Router
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ skillName: "test-skill" }),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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
  runReviewStep: vi.fn(() => Promise.resolve("review-agent-1")),
  packageSkill: vi.fn(),
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

// Import after mocks
import WorkflowPage from "@/pages/workflow";

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
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
  });

  it("completes step but does NOT auto-advance — waits for user click", async () => {
    // Simulate: step 0 is running an agent
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-1", "sonnet");

    render(<WorkflowPage />);

    // Agent completes — this triggers the review agent
    act(() => {
      useAgentStore.getState().completeRun("agent-1", true);
    });

    // Wait for review agent to be started (the mock returns "review-agent-1")
    await waitFor(() => {
      expect(useAgentStore.getState().runs["review-agent-1"]).toBeDefined();
    });

    // Simulate review agent completing with PASS
    act(() => {
      useAgentStore.getState().addMessage("review-agent-1", {
        type: "assistant",
        content: "PASS",
        raw: {},
        timestamp: Date.now(),
      });
      useAgentStore.getState().completeRun("review-agent-1", true);
    });

    // Wait for the step to be marked completed
    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
    });

    const wf = useWorkflowStore.getState();

    // Step 0 completed
    expect(wf.steps[0].status).toBe("completed");

    // Does NOT auto-advance — stays on step 0
    expect(wf.currentStep).toBe(0);

    // Step 1 still pending (user must click "Next Step" to advance)
    expect(wf.steps[1].status).toBe("pending");

    // No further steps affected
    expect(wf.steps[2].status).toBe("pending");
    expect(wf.steps[3].status).toBe("pending");

    // Running flag cleared
    expect(wf.isRunning).toBe(false);

    // Toast for passing review
    expect(mockToast.success).toHaveBeenCalledWith("Step 1 passed review");
  });

  it("completes agent step 2 but does NOT auto-advance", async () => {
    // Simulate: step 2 (Research Patterns) running an agent
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setCurrentStep(2);
    useWorkflowStore.getState().updateStepStatus(2, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-2", "sonnet");

    render(<WorkflowPage />);

    // Agent completes — this triggers the review agent
    act(() => {
      useAgentStore.getState().completeRun("agent-2", true);
    });

    // Wait for review agent to be started
    await waitFor(() => {
      expect(useAgentStore.getState().runs["review-agent-1"]).toBeDefined();
    });

    // Simulate review agent completing with PASS
    act(() => {
      useAgentStore.getState().addMessage("review-agent-1", {
        type: "assistant",
        content: "PASS",
        raw: {},
        timestamp: Date.now(),
      });
      useAgentStore.getState().completeRun("review-agent-1", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[2].status).toBe("completed");
    });

    const wf = useWorkflowStore.getState();

    // Step 2 completed
    expect(wf.steps[2].status).toBe("completed");

    // Does NOT auto-advance — stays on step 2
    expect(wf.currentStep).toBe(2);

    // Step 3 still pending (user must click "Next Step")
    expect(wf.steps[3].status).toBe("pending");

    // Step 4 unaffected
    expect(wf.steps[4].status).toBe("pending");

    expect(wf.isRunning).toBe(false);
    expect(mockToast.success).toHaveBeenCalledWith("Step 3 passed review");
  });

  it("marks step as error when agent fails — no cascade", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
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

  it("does not complete a step that is not in_progress", async () => {
    // Edge case: agent completion arrives but step is already completed
    // (e.g., from a stale agent)
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
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
});

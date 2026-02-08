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
  runParallelAgents: vi.fn(),
  packageSkill: vi.fn(),
  readFile: vi.fn(() => Promise.reject("not found")),
  getWorkflowState: vi.fn(() => Promise.reject("not found")),
  saveWorkflowState: vi.fn(() => Promise.resolve()),
  resetWorkflowStep: vi.fn(() => Promise.resolve()),
}));

// Mock heavy sub-components to isolate the effect lifecycle
vi.mock("@/components/workflow-sidebar", () => ({
  WorkflowSidebar: () => <div data-testid="workflow-sidebar" />,
}));
vi.mock("@/components/agent-output-panel", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output" />,
}));
vi.mock("@/components/parallel-agent-panel", () => ({
  ParallelAgentPanel: () => <div data-testid="parallel-panel" />,
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

  it("advances exactly one step when a single agent completes — no cascade", async () => {
    // Simulate: step 0 is running an agent
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-1", "sonnet");

    render(<WorkflowPage />);

    // Agent completes
    act(() => {
      useAgentStore.getState().completeRun("agent-1", true);
    });

    // Wait for the completion effect to fire
    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
    });

    const wf = useWorkflowStore.getState();

    // Step 0 completed
    expect(wf.steps[0].status).toBe("completed");

    // Advanced to step 1
    expect(wf.currentStep).toBe(1);

    // Step 1 (human review) must NOT be auto-completed by the cascade.
    // It should be "waiting_for_user" — the advance helper sets this for human steps.
    expect(wf.steps[1].status).toBe("waiting_for_user");

    // No further steps affected
    expect(wf.steps[2].status).toBe("pending");
    expect(wf.steps[3].status).toBe("pending");

    // Running flag cleared
    expect(wf.isRunning).toBe(false);

    // Toast fired exactly once for the completed step
    expect(mockToast.success).toHaveBeenCalledTimes(1);
    expect(mockToast.success).toHaveBeenCalledWith("Step 1 completed");
  });

  it("advances exactly one step when parallel agents complete — no cascade", async () => {
    // Simulate: step 2 (parallel) running two agents
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setCurrentStep(2);
    useWorkflowStore.getState().updateStepStatus(2, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-a", "sonnet");
    useAgentStore.getState().startRun("agent-b", "sonnet");
    useAgentStore.getState().setParallelAgents(["agent-a", "agent-b"]);

    render(<WorkflowPage />);

    // Both agents complete
    act(() => {
      useAgentStore.getState().completeRun("agent-a", true);
      useAgentStore.getState().completeRun("agent-b", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[2].status).toBe("completed");
    });

    const wf = useWorkflowStore.getState();

    // Step 2 completed
    expect(wf.steps[2].status).toBe("completed");

    // Advanced to step 3
    expect(wf.currentStep).toBe(3);

    // Step 3 must NOT be auto-completed
    expect(wf.steps[3].status).toBe("pending");

    // Step 4 unaffected
    expect(wf.steps[4].status).toBe("pending");

    expect(wf.isRunning).toBe(false);
    expect(mockToast.success).toHaveBeenCalledTimes(1);
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

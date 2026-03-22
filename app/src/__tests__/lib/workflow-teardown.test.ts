import { beforeEach, describe, expect, it, vi } from "vitest";
import { teardownWorkflowSession } from "@/lib/workflow-teardown";

const mockEndWorkflowSession = vi.fn((_sessionId?: unknown) => Promise.resolve());

vi.mock("@/lib/tauri", () => ({
  endWorkflowSession: (sessionId: string) => mockEndWorkflowSession(sessionId),
}));

const {
  mockWorkflowStore,
  mockAgentStore,
  mockClearRuns,
} = vi.hoisted(() => {
  let workflowState = {
    workflowSessionId: "session-123",
    currentStep: 1,
    steps: [{ status: "completed" }, { status: "in_progress" }],
    updateStepStatus: vi.fn(),
    setRunning: vi.fn(),
    setGateLoading: vi.fn(),
  };

  const mockWorkflowStore = {
    getState: vi.fn(() => workflowState),
    setState: vi.fn((partial: Partial<typeof workflowState>) => {
      workflowState = { ...workflowState, ...partial };
    }),
    setWorkflowState: (nextState: typeof workflowState) => {
      workflowState = nextState;
    },
  };

  const mockClearRuns = vi.fn();
  const mockAgentStore = {
    getState: vi.fn(() => ({ clearRuns: mockClearRuns })),
  };

  return { mockWorkflowStore, mockAgentStore, mockClearRuns };
});

vi.mock("@/stores/workflow-store", () => ({
  useWorkflowStore: mockWorkflowStore,
}));

vi.mock("@/stores/agent-store", () => ({
  useAgentStore: mockAgentStore,
}));

describe("teardownWorkflowSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkflowStore.setWorkflowState({
      workflowSessionId: "session-123",
      currentStep: 1,
      steps: [{ status: "completed" }, { status: "in_progress" }],
      updateStepStatus: vi.fn(),
      setRunning: vi.fn(),
      setGateLoading: vi.fn(),
    });
  });

  it("resets in-progress state, clears runs, and ends the workflow session", () => {
    teardownWorkflowSession({ logPrefix: "workflow-test" });

    const state = mockWorkflowStore.getState();
    expect(state.updateStepStatus).toHaveBeenCalledWith(1, "pending");
    expect(state.setRunning).toHaveBeenCalledWith(false);
    expect(state.setGateLoading).toHaveBeenCalledWith(false);
    expect(mockClearRuns).toHaveBeenCalled();
    expect(mockEndWorkflowSession).toHaveBeenCalledWith("session-123");
    expect(mockWorkflowStore.setState).not.toHaveBeenCalled();
  });

  it("clears the stored session id when requested", () => {
    teardownWorkflowSession({ logPrefix: "workflow-test", clearSessionId: true });

    expect(mockWorkflowStore.setState).toHaveBeenCalledWith({ workflowSessionId: null });
  });

  it("skips the session end call when there is no active session", () => {
    mockWorkflowStore.setWorkflowState({
      workflowSessionId: null as unknown as string,
      currentStep: 1,
      steps: [{ status: "completed" }, { status: "pending" }],
      updateStepStatus: vi.fn(),
      setRunning: vi.fn(),
      setGateLoading: vi.fn(),
    });

    teardownWorkflowSession({ logPrefix: "workflow-test", clearSessionId: true });

    const state = mockWorkflowStore.getState();
    expect(state.updateStepStatus).not.toHaveBeenCalled();
    expect(mockEndWorkflowSession).not.toHaveBeenCalled();
    expect(mockWorkflowStore.setState).not.toHaveBeenCalled();
  });
});

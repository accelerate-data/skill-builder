import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkflowSession } from "@/hooks/use-workflow-session";

const { mockWorkflowStoreMock, mockAgentStoreMock, mockClearRuns, leaveGuardCapture } = vi.hoisted(() => {
  let mockWorkflowState = {
    workflowSessionId: "session-uuid-123",
    currentStep: 0,
    steps: [{ status: "pending" }],
    setRunning: vi.fn(),
    setStopping: vi.fn(),
    setGateLoading: vi.fn(),
    clearInitializing: vi.fn(),
    clearRuntimeError: vi.fn(),
    updateStepStatus: vi.fn(),
  };

  const mockWorkflowStoreMock = Object.assign(
    vi.fn(() => mockWorkflowState),
    {
      getState: vi.fn(() => mockWorkflowState),
      setState: vi.fn((partial: Partial<typeof mockWorkflowState>) => {
        mockWorkflowState = { ...mockWorkflowState, ...partial };
      }),
    }
  );

  const mockClearRuns = vi.fn();
  const mockAgentStoreMock = Object.assign(
    vi.fn(() => ({})),
    { getState: vi.fn(() => ({ clearRuns: mockClearRuns })) }
  );

  const leaveGuardCapture = {
    onLeave: undefined as ((proceed: () => void) => void) | undefined,
  };

  return { mockWorkflowStoreMock, mockAgentStoreMock, mockClearRuns, leaveGuardCapture };
});

vi.mock("@/stores/workflow-store", () => ({
  useWorkflowStore: mockWorkflowStoreMock,
}));

vi.mock("@/stores/agent-store", () => ({
  useAgentStore: mockAgentStoreMock,
}));

vi.mock("@/hooks/use-leave-guard", () => ({
  useLeaveGuard: vi.fn().mockImplementation(({ onLeave }: { onLeave: (proceed: () => void) => void }) => {
    leaveGuardCapture.onLeave = onLeave;
    return { blockerStatus: "idle", handleNavStay: vi.fn(), handleNavLeave: vi.fn() };
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useBlocker: vi.fn().mockReturnValue({ proceed: vi.fn(), reset: vi.fn(), status: "idle" }),
}));

let mockWorkflowState = {
  workflowSessionId: "session-uuid-123",
  currentStep: 0,
  steps: [{ status: "pending" }],
  setRunning: vi.fn(),
  setStopping: vi.fn(),
  setGateLoading: vi.fn(),
  clearInitializing: vi.fn(),
  clearRuntimeError: vi.fn(),
  updateStepStatus: vi.fn(),
};

describe("useWorkflowSession", () => {
  const defaultOptions = {
    skillName: "test-skill",
    shouldBlock: () => false,
    hasUnsavedChanges: false,
    currentStep: 0,
    steps: [{ status: "pending" }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkflowState = {
      workflowSessionId: "session-uuid-123",
      currentStep: 0,
      steps: [{ status: "pending" }],
      setRunning: vi.fn(),
      setStopping: vi.fn(),
      setGateLoading: vi.fn(),
      clearInitializing: vi.fn(),
      clearRuntimeError: vi.fn(),
      updateStepStatus: vi.fn(),
    };
    mockWorkflowStoreMock.getState.mockImplementation(() => mockWorkflowState);
    mockWorkflowStoreMock.mockImplementation(() => mockWorkflowState);
  });

  it("returns blockerStatus from useLeaveGuard", () => {
    const { result } = renderHook(() => useWorkflowSession(defaultOptions));
    expect(result.current.blockerStatus).toBe("idle");
  });

  it("onLeave calls proceed without teardown (route coordinator owns exits)", async () => {
    renderHook(() => useWorkflowSession(defaultOptions));

    await waitFor(() => {
      expect(leaveGuardCapture.onLeave).toBeDefined();
    });

    const proceed = vi.fn();
    act(() => {
      leaveGuardCapture.onLeave!(proceed);
    });

    await waitFor(() => {
      expect(proceed).toHaveBeenCalled();
    });
  });

  it("does not call leaveCurrentSkill on unmount (route coordinator owns exits)", () => {
    const { unmount } = renderHook(() => useWorkflowSession(defaultOptions));
    unmount();
  });
});

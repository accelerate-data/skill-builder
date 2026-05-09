import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkflowSession } from "@/hooks/use-workflow-session";

const mockLeaveCurrentSkill = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/active-skill-transition", () => ({
  leaveCurrentSkill: () => mockLeaveCurrentSkill(),
}));

vi.mock("@tanstack/react-router", () => ({
  useBlocker: vi.fn().mockReturnValue({ proceed: vi.fn(), reset: vi.fn(), status: "idle" }),
}));

const mockEndWorkflowSession = vi.fn((_arg?: unknown) => Promise.resolve());
vi.mock("@/lib/tauri", () => ({
  endWorkflowSession: (sessionId: string) => mockEndWorkflowSession(sessionId),
}));

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

  // Captures the onLeave callback so tests can invoke it directly.
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

// Mock useLeaveGuard — captures onLeave so tests can invoke it directly
vi.mock("@/hooks/use-leave-guard", () => ({
  useLeaveGuard: vi.fn().mockImplementation(({ onLeave }: { onLeave: (proceed: () => void) => void }) => {
    leaveGuardCapture.onLeave = onLeave;
    return { blockerStatus: "idle", handleNavStay: vi.fn(), handleNavLeave: vi.fn() };
  }),
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

  it("delegates unmount cleanup to leaveCurrentSkill", () => {
    const { unmount } = renderHook(() => useWorkflowSession(defaultOptions));
    unmount();
    expect(mockLeaveCurrentSkill).toHaveBeenCalledTimes(1);
  });

  it("still delegates cleanup when session id is null on unmount", () => {
    mockWorkflowState.workflowSessionId = null as unknown as string;
    const { unmount } = renderHook(() => useWorkflowSession(defaultOptions));
    unmount();
    expect(mockLeaveCurrentSkill).toHaveBeenCalledTimes(1);
  });

  it("returns blockerStatus from useLeaveGuard", () => {
    const { result } = renderHook(() => useWorkflowSession(defaultOptions));
    expect(result.current.blockerStatus).toBe("idle");
  });

  it("onLeave delegates cleanup and calls proceed", async () => {
    renderHook(() => useWorkflowSession(defaultOptions));

    await waitFor(() => {
      expect(leaveGuardCapture.onLeave).toBeDefined();
    });

    const proceed = vi.fn();
    act(() => {
      leaveGuardCapture.onLeave!(proceed);
    });

    await waitFor(() => {
      expect(mockLeaveCurrentSkill).toHaveBeenCalledTimes(1);
      expect(proceed).toHaveBeenCalled();
    });
  });
});

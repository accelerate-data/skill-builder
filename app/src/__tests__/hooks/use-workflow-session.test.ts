import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkflowSession } from "@/hooks/use-workflow-session";

vi.mock("@tanstack/react-router", () => ({
  useBlocker: vi.fn().mockReturnValue({ proceed: vi.fn(), reset: vi.fn(), status: "idle" }),
}));

const mockEndWorkflowSession = vi.fn((_arg?: unknown) => Promise.resolve());
const mockInvokeCommand = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/tauri", () => ({
  endWorkflowSession: (sessionId: string) => mockEndWorkflowSession(sessionId),
  invokeCommand: (...args: unknown[]) => mockInvokeCommand(...args),
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

  it("ends workflow session and stops server on unmount", () => {
    const { unmount } = renderHook(() => useWorkflowSession(defaultOptions));
    unmount();
    expect(mockEndWorkflowSession).toHaveBeenCalledWith("session-uuid-123");
    expect(mockInvokeCommand).toHaveBeenCalledWith("stop_openhands_server", {});
  });

  it("does not call endWorkflowSession if sessionId is null on unmount", () => {
    mockWorkflowState.workflowSessionId = null as unknown as string;
    const { unmount } = renderHook(() => useWorkflowSession(defaultOptions));
    unmount();
    expect(mockEndWorkflowSession).not.toHaveBeenCalled();
  });

  it("returns blockerStatus from useLeaveGuard", () => {
    const { result } = renderHook(() => useWorkflowSession(defaultOptions));
    expect(result.current.blockerStatus).toBe("idle");
  });

  it("onLeave runs all cleanup steps and calls proceed", async () => {
    // Set an in-progress step so updateStepStatus gets exercised
    mockWorkflowState.steps = [{ status: "in_progress" }];
    const sessionId = mockWorkflowState.workflowSessionId;

    renderHook(() => useWorkflowSession(defaultOptions));

    // Wait for onLeave to be captured by the useLeaveGuard mock
    await waitFor(() => {
      expect(leaveGuardCapture.onLeave).toBeDefined();
    });

    const proceed = vi.fn();
    act(() => {
      leaveGuardCapture.onLeave!(proceed);
    });

    // Step reverted to pending
    expect(mockWorkflowState.updateStepStatus).toHaveBeenCalledWith(0, "pending");
    // Running/gate state cleared
    expect(mockWorkflowState.setRunning).toHaveBeenCalledWith(false);
    expect(mockWorkflowState.setStopping).toHaveBeenCalledWith(false);
    expect(mockWorkflowState.setGateLoading).toHaveBeenCalledWith(false);
    // Session ID cleared
    expect(mockWorkflowStoreMock.setState).toHaveBeenCalledWith({ workflowSessionId: null });
    // Agent runs cleared
    expect(mockClearRuns).toHaveBeenCalled();
    // Session ended
    expect(mockEndWorkflowSession).toHaveBeenCalledWith(sessionId);
    // Server stopped on skill switch
    expect(mockInvokeCommand).toHaveBeenCalledWith("stop_openhands_server", {});
    // Navigation allowed to proceed
    expect(proceed).toHaveBeenCalled();
  });
});

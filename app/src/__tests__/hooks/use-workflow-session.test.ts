import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkflowSession } from "@/hooks/use-workflow-session";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useBlocker: vi.fn().mockReturnValue({ proceed: vi.fn(), reset: vi.fn(), status: "idle" }),
}));

const mockAcquireLock = vi.fn((_arg?: unknown) => Promise.resolve());
const mockReleaseLock = vi.fn((_arg?: unknown) => Promise.resolve());
const mockEndWorkflowSession = vi.fn((_arg?: unknown) => Promise.resolve());
const mockCleanupSkillSidecar = vi.fn((_arg?: unknown) => Promise.resolve());
vi.mock("@/lib/tauri", () => ({
  acquireLock: (skillName: string) => mockAcquireLock(skillName),
  releaseLock: (skillName: string) => mockReleaseLock(skillName),
  endWorkflowSession: (sessionId: string) => mockEndWorkflowSession(sessionId),
  cleanupSkillSidecar: (skillName: string) => mockCleanupSkillSidecar(skillName),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const { mockWorkflowStoreMock, mockAgentStoreMock } = vi.hoisted(() => {
  let mockWorkflowState = {
    workflowSessionId: "session-uuid-123",
    currentStep: 0,
    steps: [{ status: "pending" }],
    setRunning: vi.fn(),
    setGateLoading: vi.fn(),
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
  const mockAgentStoreMock = Object.assign(
    vi.fn(() => ({})),
    { getState: vi.fn(() => ({ clearRuns: vi.fn() })) }
  );

  return { mockWorkflowStoreMock, mockAgentStoreMock };
});

vi.mock("@/stores/workflow-store", () => ({
  useWorkflowStore: mockWorkflowStoreMock,
}));

vi.mock("@/stores/agent-store", () => ({
  useAgentStore: mockAgentStoreMock,
}));

// Mock useLeaveGuard
vi.mock("@/hooks/use-leave-guard", () => ({
  useLeaveGuard: vi.fn().mockReturnValue({
    blockerStatus: "idle",
    handleNavStay: vi.fn(),
    handleNavLeave: vi.fn(),
  }),
}));

let mockWorkflowState = {
  workflowSessionId: "session-uuid-123",
  currentStep: 0,
  steps: [{ status: "pending" }],
  setRunning: vi.fn(),
  setGateLoading: vi.fn(),
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
      setGateLoading: vi.fn(),
      updateStepStatus: vi.fn(),
    };
    mockWorkflowStoreMock.getState.mockImplementation(() => mockWorkflowState);
    mockWorkflowStoreMock.mockImplementation(() => mockWorkflowState);
  });

  it("acquires lock on mount", async () => {
    renderHook(() => useWorkflowSession(defaultOptions));

    await waitFor(() => {
      expect(mockAcquireLock).toHaveBeenCalledWith("test-skill");
    });
  });

  it("releases lock on unmount", () => {
    const { unmount } = renderHook(() => useWorkflowSession(defaultOptions));
    unmount();
    expect(mockReleaseLock).toHaveBeenCalledWith("test-skill");
  });

  it("ends workflow session with UUID on unmount", () => {
    const { unmount } = renderHook(() => useWorkflowSession(defaultOptions));
    unmount();
    expect(mockEndWorkflowSession).toHaveBeenCalledWith("session-uuid-123");
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

  it("navigates to / if lock fails", async () => {
    mockAcquireLock.mockRejectedValueOnce(new Error("lock failed"));

    renderHook(() => useWorkflowSession(defaultOptions));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
    });
  });
});

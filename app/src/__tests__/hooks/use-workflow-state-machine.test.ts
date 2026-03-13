import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkflowStateMachine } from "@/hooks/use-workflow-state-machine";
import { STEP_CONFIGS } from "@/lib/workflow-step-configs";

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const mockRunWorkflowStep = vi.fn((..._args: unknown[]) => Promise.resolve("agent-id-1"));
const mockRunAnswerEvaluator = vi.fn((..._args: unknown[]) => Promise.reject("not available"));
const mockVerifyStepOutput = vi.fn((..._args: unknown[]) => Promise.resolve(true));
const mockGetDisabledSteps = vi.fn((..._args: unknown[]) => Promise.resolve([] as number[]));
const mockResetWorkflowStep = vi.fn((..._args: unknown[]) => Promise.resolve());
const mockMaterializeWorkflowStepOutput = vi.fn((..._args: unknown[]) => Promise.resolve());
const mockEndWorkflowSession = vi.fn((..._args: unknown[]) => Promise.resolve());
const mockSaveWorkflowState = vi.fn((..._args: unknown[]) => Promise.resolve());
const mockGetClarificationsContent = vi.fn((..._args: unknown[]) => Promise.resolve(null));
const mockSaveClarificationsContent = vi.fn((..._args: unknown[]) => Promise.resolve());
const mockReadFile = vi.fn((..._args: unknown[]) => Promise.reject("not found"));
const mockWriteFile = vi.fn((..._args: unknown[]) => Promise.resolve());
const mockLogGateDecision = vi.fn((..._args: unknown[]) => Promise.resolve());
const mockMaterializeAnswerEvaluationOutput = vi.fn((..._args: unknown[]) => Promise.resolve());
const mockGetContextFileContent = vi.fn((..._args: unknown[]) => Promise.resolve(null));

vi.mock("@/lib/tauri", () => ({
  runWorkflowStep: vi.fn((...args) => mockRunWorkflowStep(...args)),
  runAnswerEvaluator: vi.fn((...args) => mockRunAnswerEvaluator(...args)),
  verifyStepOutput: vi.fn((...args) => mockVerifyStepOutput(...args)),
  getDisabledSteps: vi.fn((...args) => mockGetDisabledSteps(...args)),
  resetWorkflowStep: vi.fn((...args) => mockResetWorkflowStep(...args)),
  materializeWorkflowStepOutput: vi.fn((...args) => mockMaterializeWorkflowStepOutput(...args)),
  materializeAnswerEvaluationOutput: vi.fn((...args) => mockMaterializeAnswerEvaluationOutput(...args)),
  endWorkflowSession: vi.fn((...args) => mockEndWorkflowSession(...args)),
  saveWorkflowState: vi.fn((...args) => mockSaveWorkflowState(...args)),
  getClarificationsContent: vi.fn((...args) => mockGetClarificationsContent(...args)),
  saveClarificationsContent: vi.fn((...args) => mockSaveClarificationsContent(...args)),
  readFile: vi.fn((...args) => mockReadFile(...args)),
  writeFile: vi.fn((...args) => mockWriteFile(...args)),
  logGateDecision: vi.fn((...args) => mockLogGateDecision(...args)),
  getContextFileContent: vi.fn((...args) => mockGetContextFileContent(...args)),
}));

vi.mock("@/lib/models", () => ({
  resolveModelId: (model: string) => model,
}));

const mockSetCurrentStep = vi.fn();
const mockUpdateStepStatus = vi.fn();
const mockSetRunning = vi.fn();
const mockSetInitializing = vi.fn();
const mockClearInitializing = vi.fn();
const mockSetGateLoading = vi.fn();
const mockResetToStep = vi.fn();
const mockClearRuntimeError = vi.fn();
let mockWorkflowState = {
  workflowSessionId: null as string | null,
  currentStep: 0,
  steps: [{ id: 0, status: "pending" }],
  isRunning: false,
  isInitializing: false,
  gateLoading: false,
  disabledSteps: [] as number[],
  setCurrentStep: mockSetCurrentStep,
  updateStepStatus: mockUpdateStepStatus,
  setRunning: mockSetRunning,
  setInitializing: mockSetInitializing,
  clearInitializing: mockClearInitializing,
  setGateLoading: mockSetGateLoading,
  resetToStep: mockResetToStep,
  clearRuntimeError: mockClearRuntimeError,
  setDisabledSteps: vi.fn(),
};

const mockSetActiveAgent = vi.fn();
const mockClearRuns = vi.fn();
const mockAgentStartRun = vi.fn();
let mockActiveAgentId: string | null = null;
let mockRuns: Record<string, { status: string; displayItems: unknown[]; totalCost?: number }> = {};

vi.mock("@/stores/workflow-store", () => ({
  useWorkflowStore: Object.assign(
    vi.fn((selector?: (s: typeof mockWorkflowState) => unknown) =>
      selector ? selector(mockWorkflowState) : mockWorkflowState
    ),
    {
      getState: vi.fn(() => mockWorkflowState),
      setState: vi.fn((partial: Partial<typeof mockWorkflowState>) => {
        mockWorkflowState = { ...mockWorkflowState, ...partial };
      }),
    }
  ),
}));

vi.mock("@/stores/agent-store", () => ({
  useAgentStore: Object.assign(
    vi.fn((selector?: (s: unknown) => unknown) => {
      const state = { activeAgentId: mockActiveAgentId, runs: mockRuns, setActiveAgent: mockSetActiveAgent, clearRuns: mockClearRuns, startRun: mockAgentStartRun };
      return selector ? selector(state) : state;
    }),
    {
      getState: vi.fn(() => ({ runs: mockRuns, setActiveAgent: mockSetActiveAgent, clearRuns: mockClearRuns, startRun: mockAgentStartRun, activeAgentId: mockActiveAgentId })),
    }
  ),
}));

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: Object.assign(
    vi.fn(() => ({ preferredModel: null })),
    { getState: vi.fn(() => ({ preferredModel: null })) }
  ),
}));

describe("useWorkflowStateMachine", () => {
  const defaultOptions = {
    skillName: "test-skill",
    workspacePath: "/workspace",
    skillsPath: "/skills",
    currentStep: 0,
    steps: [{ id: 0, status: "pending", name: "Research" }, { id: 1, status: "pending", name: "Refine" }],
    stepConfig: STEP_CONFIGS[0],
    hydrated: true,
    reviewMode: false,
    disabledSteps: [],
    errorHasArtifacts: false,
    purpose: null,
    clarificationsData: null,
    stepConfigs: STEP_CONFIGS,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveAgentId = null;
    mockRuns = {};
    mockWorkflowState = {
      ...mockWorkflowState,
      workflowSessionId: null,
      steps: [{ id: 0, status: "pending" }],
      isRunning: false,
      gateLoading: false,
      disabledSteps: [],
    };
  });

  it("handleStartAgentStep calls runWorkflowStep and marks step in_progress", async () => {
    mockRunWorkflowStep.mockResolvedValueOnce("agent-abc");

    const { result } = renderHook(() => useWorkflowStateMachine(defaultOptions));

    await act(async () => {
      await result.current.handleStartAgentStep();
    });

    expect(mockUpdateStepStatus).toHaveBeenCalledWith(0, "in_progress");
    expect(mockSetRunning).toHaveBeenCalledWith(true);
    expect(mockRunWorkflowStep).toHaveBeenCalledWith("test-skill", 0, "/workspace", undefined);
    expect(mockAgentStartRun).toHaveBeenCalledWith("agent-abc", expect.any(String));
  });

  it("handleStartAgentStep shows error toast when runWorkflowStep fails", async () => {
    mockRunWorkflowStep.mockRejectedValueOnce(new Error("sidecar error"));
    const { toast } = await import("@/lib/toast");

    const { result } = renderHook(() => useWorkflowStateMachine(defaultOptions));

    await act(async () => {
      await result.current.handleStartAgentStep();
    });

    expect(mockUpdateStepStatus).toHaveBeenCalledWith(0, "error");
    expect(mockSetRunning).toHaveBeenCalledWith(false);
    expect(toast.error).toHaveBeenCalled();
  });

  it("performStepReset calls resetWorkflowStep and resetToStep", async () => {
    const { result } = renderHook(() => useWorkflowStateMachine(defaultOptions));

    await act(async () => {
      await result.current.performStepReset(0);
    });

    expect(mockResetWorkflowStep).toHaveBeenCalledWith("/workspace", "test-skill", 0);
    expect(mockResetToStep).toHaveBeenCalledWith(0);
  });

  it("auto-start is skipped in reviewMode", async () => {
    renderHook(() =>
      useWorkflowStateMachine({ ...defaultOptions, reviewMode: true })
    );

    // pendingAutoStartStep should not trigger handleStartAgentStep
    await new Promise((r) => setTimeout(r, 10));
    expect(mockRunWorkflowStep).not.toHaveBeenCalled();
  });

  it("returns pendingAutoStartStep in result", () => {
    const { result } = renderHook(() => useWorkflowStateMachine(defaultOptions));
    expect("pendingAutoStartStep" in result.current).toBe(true);
  });

  it("agent completion transitions step from in_progress to completed", async () => {
    // Arrange: step 0 is in_progress, an agent is active with status "completed"
    mockWorkflowState = {
      ...mockWorkflowState,
      currentStep: 0,
      steps: [{ id: 0, status: "in_progress" }],
      isRunning: true,
    };
    mockActiveAgentId = "agent-finish-1";
    mockRuns = {
      "agent-finish-1": { status: "completed", displayItems: [], totalCost: 0 },
    };
    // verifyStepOutput resolves true — step output exists
    mockVerifyStepOutput.mockResolvedValueOnce(true);
    // getDisabledSteps resolves with empty list
    mockGetDisabledSteps.mockResolvedValueOnce([]);

    renderHook(() =>
      useWorkflowStateMachine({
        ...defaultOptions,
        steps: [
          { id: 0, status: "in_progress", name: "Research" },
          { id: 1, status: "pending", name: "Refine" },
        ],
        reviewMode: false,
      })
    );

    // Wait for the completion effect to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // The step must have been marked completed and isRunning set to false
    expect(mockUpdateStepStatus).toHaveBeenCalledWith(0, "completed");
    expect(mockSetRunning).toHaveBeenCalledWith(false);
  });
});

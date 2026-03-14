import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkflowPersistence } from "@/hooks/use-workflow-persistence";

// Mock tauri
vi.mock("@/lib/tauri", () => ({
  getWorkflowState: vi.fn(),
  getDisabledSteps: vi.fn(() => Promise.resolve([])),
  saveWorkflowState: vi.fn(() => Promise.resolve()),
  readFile: vi.fn(() => Promise.reject("not found")),
  getContextFileContent: vi.fn(() => Promise.resolve(null)),
}));

// Mock stores
const mockInitWorkflow = vi.fn();
const mockLoadWorkflowState = vi.fn();
const mockSetHydrated = vi.fn();
const mockSetDisabledSteps = vi.fn();
const mockSetPendingUpdateMode = vi.fn();
const mockSetReviewMode = vi.fn();
const mockClearRuns = vi.fn();
let mockStoreState = {
  skillName: "",
  hydrated: false,
  pendingUpdateMode: false,
  steps: [] as Array<{ id: number; status: string }>,
  currentStep: 0,
  initWorkflow: mockInitWorkflow,
  loadWorkflowState: mockLoadWorkflowState,
  setHydrated: mockSetHydrated,
  setDisabledSteps: mockSetDisabledSteps,
  setPendingUpdateMode: mockSetPendingUpdateMode,
  setReviewMode: mockSetReviewMode,
};

vi.mock("@/stores/workflow-store", () => ({
  useWorkflowStore: Object.assign(
    vi.fn((selector?: (s: typeof mockStoreState) => unknown) => selector ? selector(mockStoreState) : mockStoreState),
    {
      getState: vi.fn(() => mockStoreState),
      setState: vi.fn((partial: Partial<typeof mockStoreState>) => {
        mockStoreState = { ...mockStoreState, ...partial };
      }),
    }
  ),
}));

vi.mock("@/stores/agent-store", () => ({
  useAgentStore: Object.assign(
    vi.fn(() => ({})),
    {
      getState: vi.fn(() => ({ clearRuns: mockClearRuns })),
    }
  ),
}));

import { getWorkflowState, saveWorkflowState, getContextFileContent } from "@/lib/tauri";

describe("useWorkflowPersistence", () => {
  const defaultOptions = {
    skillName: "test-skill",
    workspacePath: "/workspace",
    skillsPath: "/skills",
    stepConfig: { outputFiles: ["context/clarifications.json"] },
    currentStep: 0,
    steps: [{ id: 0, status: "pending" }],
    purpose: null,
    hydrated: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState = {
      skillName: "",
      hydrated: false,
      pendingUpdateMode: false,
      steps: [],
      currentStep: 0,
      initWorkflow: mockInitWorkflow,
      loadWorkflowState: mockLoadWorkflowState,
      setHydrated: mockSetHydrated,
      setDisabledSteps: mockSetDisabledSteps,
      setPendingUpdateMode: mockSetPendingUpdateMode,
      setReviewMode: mockSetReviewMode,
    };
  });

  it("calls initWorkflow and setHydrated on mount with no saved state", async () => {
    vi.mocked(getWorkflowState).mockResolvedValue({ run: null, steps: [] });

    renderHook(() => useWorkflowPersistence(defaultOptions));

    await waitFor(() => {
      expect(mockInitWorkflow).toHaveBeenCalledWith("test-skill", undefined);
      expect(mockSetHydrated).toHaveBeenCalledWith(true);
    });
  });

  it("skips hydration if already hydrated for same skill", async () => {
    mockStoreState.skillName = "test-skill";
    mockStoreState.hydrated = true;

    renderHook(() => useWorkflowPersistence(defaultOptions));

    await new Promise((r) => setTimeout(r, 10));
    expect(getWorkflowState).not.toHaveBeenCalled();
  });

  it("returns errorHasArtifacts=false initially", () => {
    const { result } = renderHook(() =>
      useWorkflowPersistence({ ...defaultOptions, steps: [{ id: 0, status: "pending" }] })
    );
    expect(result.current.errorHasArtifacts).toBe(false);
  });

  it("detects error artifacts when step is in error and context file exists", async () => {
    vi.mocked(getContextFileContent).mockResolvedValue("some content");
    vi.mocked(getWorkflowState).mockResolvedValue({ run: null, steps: [] });

    const { result } = renderHook(() =>
      useWorkflowPersistence({
        ...defaultOptions,
        steps: [{ id: 0, status: "error" }],
        hydrated: true,
      })
    );

    await waitFor(() => {
      expect(result.current.errorHasArtifacts).toBe(true);
    });
  });

  it("does not call saveWorkflowState before hydrated", async () => {
    vi.mocked(getWorkflowState).mockResolvedValue({ run: null, steps: [] });

    renderHook(() =>
      useWorkflowPersistence({ ...defaultOptions, hydrated: false })
    );

    await new Promise((r) => setTimeout(r, 400));
    expect(saveWorkflowState).not.toHaveBeenCalled();
  });

  it("calls saveWorkflowState after hydrated", async () => {
    vi.mocked(getWorkflowState).mockResolvedValue({ run: null, steps: [] });
    // skillName must match before renderHook so the debounce guard passes
    mockStoreState.skillName = "test-skill";

    renderHook(() =>
      useWorkflowPersistence({
        ...defaultOptions,
        hydrated: true,
        skillName: "test-skill",
      })
    );

    await waitFor(() => {
      expect(saveWorkflowState).toHaveBeenCalled();
    }, { timeout: 500 });
  });

  it("consumeUpdateMode resets pendingUpdateMode even when getWorkflowState rejects (finally-block)", async () => {
    // Simulate the main hydration body throwing by making getWorkflowState reject
    vi.mocked(getWorkflowState).mockRejectedValue(new Error("DB error"));

    // Set pendingUpdateMode so consumeUpdateMode has work to do
    mockStoreState.pendingUpdateMode = true;

    renderHook(() => useWorkflowPersistence(defaultOptions));

    // The finally block should run consumeUpdateMode even after rejection
    await waitFor(() => {
      expect(mockSetPendingUpdateMode).toHaveBeenCalledWith(false);
    }, { timeout: 500 });
  });
});

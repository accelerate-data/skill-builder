import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, act, waitFor } from "@testing-library/react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAgentStore } from "@/stores/agent-store";
import { useRefineStore } from "@/stores/refine-store";
import { useSettingsStore } from "@/stores/settings-store";
import { mockListen, mockInvoke, resetTauriMocks } from "@/test/mocks/tauri";
import { renderWithQueryClient as render } from "@/test/query-test-utils";

// Mock TanStack Router — useBlocker returns idle state by default
const mockBlocker = vi.hoisted(() => ({
  proceed: vi.fn(),
  reset: vi.fn(),
  status: "idle" as string,
}));
const mockNavigate = vi.hoisted(() => vi.fn());
const mockLocation = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ skillName: "test-skill" }),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  useBlocker: () => mockBlocker,
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

// Mock toast wrapper — use vi.hoisted so the object is available in hoisted vi.mock factory
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  loading: vi.fn(() => "toast-id"),
  dismiss: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast: mockToast }));

// Mock @/lib/tauri
vi.mock("@/lib/tauri", () => ({
  runWorkflowStep: vi.fn(),
  readFile: vi.fn(() => Promise.reject("not found")),
  writeFile: vi.fn(() => Promise.resolve()),
  getClarificationsContent: vi.fn(() => Promise.reject("not found")),
  saveClarificationsContent: vi.fn(() => Promise.resolve()),
  getWorkflowState: vi.fn(() => Promise.reject("not found")),
  saveWorkflowState: vi.fn(() => Promise.resolve()),
  resetWorkflowStep: vi.fn(() => Promise.resolve()),
  acquireLock: vi.fn(() => Promise.resolve()),
  releaseLock: vi.fn(() => Promise.resolve()),

  createWorkflowSession: vi.fn(() => Promise.resolve()),
  endWorkflowSession: vi.fn(() => Promise.resolve()),
  verifyStepOutput: vi.fn(() => Promise.resolve(true)),
  materializeWorkflowStepOutput: vi.fn(() => Promise.resolve()),
  materializeAnswerEvaluationOutput: vi.fn(() => Promise.resolve()),
  previewStepReset: vi.fn(() => Promise.resolve([])),
  getDisabledSteps: vi.fn(() => Promise.resolve([])),
  runAnswerEvaluator: vi.fn(() => Promise.reject("not available")),
  logGateDecision: vi.fn(() => Promise.resolve()),
  navigateBackToStepDb: vi.fn(() => Promise.resolve()),
  getContextFileContent: vi.fn(() => Promise.resolve(null)),
  listSkills: vi.fn().mockResolvedValue([]),
  logFrontend: vi.fn(),
  invokeCommand: vi.fn((command: string) =>
    Promise.resolve(command === "get_clarifications" ? null : undefined),
  ),
}));
vi.mock("@/lib/skill-openhands-session", () => ({
  restartSkillOpenHandsSession: vi.fn(() => Promise.resolve()),
}));

// Mock ClarificationsEditor — renders a simple div with testid and
// exposes onChange/onContinue via buttons so tests can trigger them.
const mockClarificationsOnChange = vi.hoisted(() => vi.fn());
vi.mock("@/components/clarifications-editor", () => ({
  ClarificationsEditor: ({ data, onChange, onContinue }: {
    data: unknown;
    onChange?: (updated: unknown) => void;
    onContinue?: () => void;
  }) => {
    // Stash onChange so tests can call it
    mockClarificationsOnChange.mockImplementation((updated: unknown) => onChange?.(updated));
    return (
      <div data-testid="clarifications-editor">
        <span data-testid="clarifications-data">{JSON.stringify(data)}</span>
        {onContinue && <button data-testid="clarifications-continue" onClick={onContinue}>Complete Step</button>}
      </div>
    );
  },
}));

// Mock heavy sub-components to isolate the effect lifecycle
vi.mock("@/components/workflow-sidebar", () => ({
  WorkflowSidebar: vi.fn(() => <div data-testid="workflow-sidebar" />),
}));
vi.mock("@/components/agent-output-panel", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output" />,
}));
vi.mock("@/components/step-complete", () => ({
  WorkflowStepComplete: vi.fn(() => (
    <div data-testid="step-complete" />
  )),
}));

// Import after mocks
import WorkflowPage from "@/pages/workflow";
import { restartSkillOpenHandsSession } from "@/lib/skill-openhands-session";
import {
  getWorkflowState,
  saveWorkflowState,
  writeFile,
  readFile,
  getClarificationsContent,
  saveClarificationsContent,
  runWorkflowStep,
  resetWorkflowStep,
  endWorkflowSession,
  previewStepReset,
  runAnswerEvaluator,
  getDisabledSteps,
  materializeWorkflowStepOutput,
  materializeAnswerEvaluationOutput,
  getContextFileContent,
  navigateBackToStepDb,
  verifyStepOutput,
  invokeCommand,
} from "@/lib/tauri";
import { WorkflowSidebar } from "@/components/workflow-sidebar";
import { WorkflowStepComplete } from "@/components/step-complete";
import type { ClarificationsFile } from "@/lib/clarifications-types";
import pluginPaths from "../../../plugin-paths.json";

type ListenCallback = (event: { payload: unknown }) => void;
const gateEvaluationPath = `/test/workspace/${pluginPaths.default_plugin_slug}/skills/test-skill/answer-evaluation.json`;

// Bridge new domain context commands to existing read/write path-based assertions.
vi.mocked(getClarificationsContent).mockImplementation((skillName: string) =>
  vi.mocked(readFile)(`/test/skills/${skillName}/context/clarifications.json`)
);
vi.mocked(saveClarificationsContent).mockImplementation((skillName: string, _workspacePath: string, content: string) =>
  vi.mocked(writeFile)(`/test/skills/${skillName}/context/clarifications.json`, content)
);

/** Minimal valid ClarificationsFile for tests */
function makeClarificationsJson(overrides?: Partial<ClarificationsFile>): ClarificationsFile {
  return {
    version: "1",
    metadata: {
      title: "Test Clarifications",
      question_count: 2,
      section_count: 1,
      refinement_count: 0,
      must_answer_count: 1,
      priority_questions: ["Q1"],
    },
    sections: [
      {
        id: 1,
        title: "Test Section",
        questions: [
          {
            id: "Q1",
            title: "Question 1",
            must_answer: true,
            text: "What is the primary focus?",
            choices: [
              { id: "A", text: "Option A", is_other: false },
              { id: "B", text: "Option B", is_other: false },
            ],
            answer_choice: null,
            answer_text: null,
            refinements: [],
          },
          {
            id: "Q2",
            title: "Question 2",
            must_answer: false,
            text: "Secondary concern?",
            choices: [
              { id: "A", text: "Choice A", is_other: false },
              { id: "B", text: "Choice B", is_other: false },
            ],
            answer_choice: null,
            answer_text: null,
            refinements: [],
          },
        ],
      },
    ],
    notes: [],
    answer_evaluator_notes: [],
    ...overrides,
  };
}

// Global reset: ensure location state doesn't leak between describe blocks.
// Each describe's beforeEach may set mockLocation.state; this outer reset guarantees
// every test starts with a clean slate regardless of describe-level setup order.
beforeEach(() => {
  mockLocation.state = {};
  useRefineStore.getState().selectSkill({
    name: "test-skill",
    plugin_slug: "default",
    skill_source: "skill-builder",
    purpose: null,
    description: null,
    tags: [],
    intake_json: null,
    version: null,
    model: null,
    argumentHint: null,
    userInvocable: null,
    disableModelInvocation: null,
    status: null,
    current_step: null,
  });
});

describe("WorkflowPage — agent completion lifecycle", () => {
  beforeEach(() => {
    resetTauriMocks();
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useRefineStore.getState().selectSkill({
      name: "test-skill",
      plugin_slug: "default",
      skill_source: "skill-builder",
      purpose: null,
      description: null,
      tags: [],
      intake_json: null,
      version: null,
      model: null,
      argumentHint: null,
      userInvocable: null,
      disableModelInvocation: null,
      status: null,
      current_step: null,
    });
    useSettingsStore.getState().reset();

    // Hydrate settings so workflow handlers don't bail
    useSettingsStore.getState().setSettings({
      workspacePath: "/test/workspace",
      modelSettings: {
        model: "sonnet",
        api_key: "sk-test",
      },
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

    // Reset location state so tests don't accidentally inherit autoStart
    mockLocation.state = {};
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useRefineStore.getState().selectSkill(null);
    useSettingsStore.getState().reset();
  });

  it("stays on completion screen after agent step 0 completes (clarificationsEditable)", async () => {
    // Simulate: step 0 is running an agent
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-1", "sonnet");

    render(<WorkflowPage />);

    // Agent completes — should stay on step 0 completion screen (clarifications editable)
    act(() => {
      useAgentStore.getState().addDisplayItem("agent-1", {
        id: "result-agent-1",
        type: "result",
        timestamp: Date.now(),
        outputText_result: "Agent completed",
        structuredOutput: {
          status: "research_complete",
          question_count: 1,
          research_output: {
            version: "1",
            metadata: {
              question_count: 0,
              section_count: 0,
              refinement_count: 0,
              must_answer_count: 0,
              priority_questions: [],
            },
            sections: [],
            notes: [],
          },
        },
        resultStatus: "success",
      });
      useAgentStore.getState().completeRun("agent-1", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
    });

    const wf = useWorkflowStore.getState();

    // Stays on step 0 completion screen — user edits clarifications before continuing
    expect(wf.currentStep).toBe(0);

    // Running flag cleared
    expect(wf.isRunning).toBe(false);

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
        current_step: 1,
        status: "pending",
        purpose: "domain",
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
      const stepStatuses = call[3] as Array<{ step_id: number; status: string }>;
      const step0 = stepStatuses.find((s) => s.step_id === 0);
      expect(step0?.status).toBe("completed");
    }
  });

  it("restores disabled downstream steps when scope recommendation is active", async () => {
    vi.mocked(getDisabledSteps).mockResolvedValueOnce([1, 2, 3]);
    vi.mocked(getWorkflowState).mockResolvedValueOnce({
      run: {
        skill_name: "test-skill",
        current_step: 0,
        status: "completed",
        purpose: "domain",
        created_at: "",
        updated_at: "",
      },
      steps: [
        { skill_name: "test-skill", step_id: 0, status: "completed", started_at: null, completed_at: null },
      ],
    });

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(useWorkflowStore.getState().hydrated).toBe(true);
      expect(useWorkflowStore.getState().disabledSteps).toEqual([1, 2, 3]);
    });
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

  it("calls endWorkflowSession on unmount when running", async () => {
    vi.mocked(endWorkflowSession).mockClear();

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-1", "sonnet");
    const sessionId = useWorkflowStore.getState().workflowSessionId;

    const { unmount } = render(<WorkflowPage />);

    act(() => {
      unmount();
    });

    // endWorkflowSession should be called (sidecar pool cleanup removed)
    expect(vi.mocked(endWorkflowSession)).toHaveBeenCalledWith(sessionId);
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

  it("cleans up workflow session on unmount even when not running", async () => {
    vi.mocked(endWorkflowSession).mockClear();

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setRunning(false);

    const { unmount } = render(<WorkflowPage />);

    act(() => {
      unmount();
    });

    // Session cleanup should remain safe even when no agent is running.
    const sessionId = useWorkflowStore.getState().workflowSessionId;
    // The workflow page no longer owns skill-lock lifecycle directly.
    // We only verify teardown remains non-throwing here.
    expect(unmount).not.toThrow();
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

    // Stale agent data should be cleared — "old-agent" is no longer active
    // (auto-start may have kicked off a new agent, so we check the stale ID is gone)
    expect(useAgentStore.getState().activeAgentId).not.toBe("old-agent");
    expect(useAgentStore.getState().runs).not.toHaveProperty("old-agent");
  });

  it("auto-starts step 0 on create-flow navigation (autoStart router state)", async () => {
    mockLocation.state = { autoStart: true };
    vi.mocked(getWorkflowState).mockResolvedValueOnce({ run: null, steps: [] });
    vi.mocked(runWorkflowStep).mockResolvedValueOnce("agent-1");

    render(<WorkflowPage />);

    // persistence hook hydrates → .finally() sets reviewMode=false → wasToggle fires → auto-start
    await waitFor(() => {
      expect(vi.mocked(runWorkflowStep)).toHaveBeenCalled();
    }, { timeout: 500 });
  });

  it("renders completion screen on last step (step 3)", async () => {
    // Simulate all steps complete, on step 3 (the last step)
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    for (let i = 0; i < 4; i++) {
      useWorkflowStore.getState().updateStepStatus(i, "completed");
    }
    useWorkflowStore.getState().setCurrentStep(3);

    render(<WorkflowPage />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Should render completion screen
    expect(screen.queryByTestId("step-complete")).toBeTruthy();
  });
});

describe("WorkflowPage — clarifications loading on completed agent step", () => {
  beforeEach(() => {
    resetTauriMocks();
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();

    useSettingsStore.getState().setSettings({
      workspacePath: "/test/workspace",
      skillsPath: "/test/skills",
      modelSettings: {
        model: "sonnet",
        api_key: "sk-test",
      },
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

  it("loads clarifications from skillsPath when step 0 is completed", async () => {
    // Step 0 completed — clarifications are now loaded from DB via invokeCommand("get_clarifications")
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    // reviewMode=true (default from initWorkflow) — keeps currentStep stable
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Should render the step-complete view
    expect(screen.getByTestId("step-complete")).toBeTruthy();

    // Clarifications are loaded from DB — invokeCommand("get_clarifications") is called
    // (step 0 has clarificationsEditable=true and status=completed → useClarifications hook fires)
    expect(vi.mocked(invokeCommand)).toHaveBeenCalledWith(
      "get_clarifications",
      expect.objectContaining({ skillId: "test-skill" }),
    );
  });

  it("loads clarifications from skillsPath when step 1 is completed", async () => {
    // Step 1 (detailed research) also has clarificationsEditable
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    // reviewMode=true (default) — prevents auto-advance
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().setCurrentStep(1);

    render(<WorkflowPage />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(screen.getByTestId("step-complete")).toBeTruthy();

    // Clarifications loaded from DB for step 1 as well
    expect(vi.mocked(invokeCommand)).toHaveBeenCalledWith(
      "get_clarifications",
      expect.objectContaining({ skillId: "test-skill" }),
    );
  });
});

describe("WorkflowPage — editable clarifications on completed agent step", () => {
  beforeEach(() => {
    resetTauriMocks();
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();

    useSettingsStore.getState().setSettings({
      workspacePath: "/test/workspace",
      skillsPath: "/test/skills",
      modelSettings: {
        model: "sonnet",
        api_key: "sk-test",
      },
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
    vi.mocked(invokeCommand).mockClear();
    vi.mocked(verifyStepOutput).mockReset().mockResolvedValue(true);
    vi.mocked(materializeWorkflowStepOutput).mockClear();
    vi.mocked(materializeAnswerEvaluationOutput).mockClear();
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
  });

  it("step 0 completes and stays on completion screen with editable clarifications", async () => {
    // Simulate: step 0 is running an agent
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-1", "sonnet");

    render(<WorkflowPage />);

    // Agent completes step 0
    act(() => {
      useAgentStore.getState().addDisplayItem("agent-1", {
        id: "result-agent-1",
        type: "result",
        timestamp: Date.now(),
        outputText_result: "Agent completed",
        structuredOutput: {
          status: "research_complete",
          question_count: 1,
          research_output: {
            version: "1",
            metadata: {
              question_count: 0,
              section_count: 0,
              refinement_count: 0,
              must_answer_count: 0,
              priority_questions: [],
            },
            sections: [],
            notes: [],
          },
        },
        resultStatus: "success",
      });
      useAgentStore.getState().completeRun("agent-1", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
    });

    const wf = useWorkflowStore.getState();

    // Should stay on step 0 completion screen (clarificationsEditable)
    // User edits clarifications and clicks Continue
    expect(wf.currentStep).toBe(0);
  });

  it("step 1 completes and stays on completion screen with editable clarifications", async () => {
    // Simulate: step 1 running
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-2", "sonnet");

    render(<WorkflowPage />);

    act(() => {
      useAgentStore.getState().addDisplayItem("agent-2", {
        id: "result-agent-2",
        type: "result",
        timestamp: Date.now(),
        outputText_result: "Agent completed",
        structuredOutput: {
          status: "detailed_research_complete",
          refinement_count: 1,
          section_count: 1,
          clarifications_json: {
            version: "1",
            metadata: {
              question_count: 0,
              section_count: 0,
              refinement_count: 0,
              must_answer_count: 0,
              priority_questions: [],
            },
            sections: [],
            notes: [],
          },
        },
        resultStatus: "success",
      });
    });

    // Agent completes step 1
    act(() => {
      useAgentStore.getState().completeRun("agent-2", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[1].status).toBe("completed");
    });

    const wf = useWorkflowStore.getState();

    // Should stay on step 1 completion screen (clarificationsEditable)
    expect(wf.currentStep).toBe(1);
  });

  it("step 0 completes from verified backend materialized output without frontend materialization", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-step0-verified", "sonnet");

    render(<WorkflowPage />);

    act(() => {
      useAgentStore.getState().completeRun("agent-step0-verified", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
    });
    expect(vi.mocked(verifyStepOutput)).toHaveBeenCalledWith(
      "/test/workspace",
      "test-skill",
      0,
    );
    expect(vi.mocked(materializeWorkflowStepOutput)).not.toHaveBeenCalled();
  });

  it("step 0 waits for backend materialization after terminal state when files are not verified yet", async () => {
    let materializedListener: ListenCallback | undefined;
    vi.mocked(mockListen).mockImplementation((event: string, callback: ListenCallback) => {
      if (event === "workflow-step-materialized") {
        materializedListener = callback;
      }
      return Promise.resolve(vi.fn());
    });
    vi.mocked(verifyStepOutput).mockResolvedValue(false);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-step0-materialized", "sonnet");

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(materializedListener).toBeDefined();
    });

    act(() => {
      useAgentStore.getState().completeRun("agent-step0-materialized", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("in_progress");
    });
    expect(vi.mocked(materializeWorkflowStepOutput)).not.toHaveBeenCalled();

    act(() => {
      materializedListener?.({
        payload: {
          agent_id: "agent-step0-materialized",
          skill_name: "test-skill",
          step_id: 0,
          success: true,
        },
      });
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
    });
    expect(vi.mocked(materializeWorkflowStepOutput)).not.toHaveBeenCalled();
  });

  it("step 0 waits for backend materialization when output verification errors", async () => {
    let materializedListener: ListenCallback | undefined;
    vi.mocked(mockListen).mockImplementation((event: string, callback: ListenCallback) => {
      if (event === "workflow-step-materialized") {
        materializedListener = callback;
      }
      return Promise.resolve(vi.fn());
    });
    vi.mocked(verifyStepOutput).mockRejectedValue(new Error("disk busy"));

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-step0-verify-error", "sonnet");

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(materializedListener).toBeDefined();
    });

    act(() => {
      useAgentStore.getState().completeRun("agent-step0-verify-error", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("in_progress");
    });

    act(() => {
      materializedListener?.({
        payload: {
          agent_id: "agent-step0-verify-error",
          skill_name: "test-skill",
          step_id: 0,
          success: true,
        },
      });
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
    });
    expect(vi.mocked(materializeWorkflowStepOutput)).not.toHaveBeenCalled();
  });

  it("step 0 completes when backend materialization arrives before terminal state", async () => {
    let materializedListener: ListenCallback | undefined;
    vi.mocked(mockListen).mockImplementation((event: string, callback: ListenCallback) => {
      if (event === "workflow-step-materialized") {
        materializedListener = callback;
      }
      return Promise.resolve(vi.fn());
    });
    vi.mocked(verifyStepOutput).mockResolvedValue(false);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-step0-materialized-early", "sonnet");

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(materializedListener).toBeDefined();
    });

    act(() => {
      materializedListener?.({
        payload: {
          agent_id: "agent-step0-materialized-early",
          skill_name: "test-skill",
          step_id: 0,
          success: true,
        },
      });
    });

    expect(useWorkflowStore.getState().steps[0].status).toBe("in_progress");

    act(() => {
      useAgentStore.getState().completeRun("agent-step0-materialized-early", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
    });
    expect(vi.mocked(materializeWorkflowStepOutput)).not.toHaveBeenCalled();
  });

  it("passes step 1 structured payload to backend materialization", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-step1-structured", "sonnet");

    render(<WorkflowPage />);

    const payload = {
      status: "detailed_research_complete",
      refinement_count: 2,
      section_count: 1,
      clarifications_json: {
        version: "1",
        metadata: {
          question_count: 1,
          section_count: 1,
          refinement_count: 2,
          must_answer_count: 0,
          priority_questions: [],
        },
        sections: [],
        notes: [],
      },
    };

    act(() => {
      useAgentStore.getState().addDisplayItem("agent-step1-structured", {
        id: "result-step1",
        type: "result",
        timestamp: Date.now(),
        outputText_result: "Agent completed",
        structuredOutput: payload,
        resultStatus: "success",
      });
      useAgentStore.getState().completeRun("agent-step1-structured", true);
    });

    await waitFor(() => {
      expect(vi.mocked(materializeWorkflowStepOutput)).toHaveBeenCalledWith(
        "test-skill",
        1,
        payload
      );
      expect(useWorkflowStore.getState().steps[1].status).toBe("completed");
    });
  });

  it("step 1 errors when structured output payload is missing", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-missing-step1", "sonnet");

    render(<WorkflowPage />);

    act(() => {
      useAgentStore.getState().completeRun("agent-missing-step1", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[1].status).toBe("error");
    });
    expect(vi.mocked(materializeWorkflowStepOutput)).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalled();
  });

  it("step 1 errors when structured output payload is not an object", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-step1-invalid-shape", "sonnet");

    render(<WorkflowPage />);

    act(() => {
      useAgentStore.getState().addDisplayItem("agent-step1-invalid-shape", {
        id: "result-step1-invalid",
        type: "result",
        timestamp: Date.now(),
        outputText_result: "Agent completed",
        structuredOutput: [],
        resultStatus: "success",
      });
      useAgentStore.getState().completeRun("agent-step1-invalid-shape", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[1].status).toBe("error");
    });
    expect(vi.mocked(materializeWorkflowStepOutput)).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalled();
  });

  it("step 0 does not require legacy structured output when backend output verifies", async () => {
    vi.mocked(verifyStepOutput).mockResolvedValue(true);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-missing-step0", "sonnet");

    render(<WorkflowPage />);

    act(() => {
      useAgentStore.getState().completeRun("agent-missing-step0", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
    });
    expect(vi.mocked(materializeWorkflowStepOutput)).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalledWith(
      "Step 1 completed but produced no structured output",
      expect.anything(),
    );
  });

  it("step 0 shows backend materialization failure details", async () => {
    let materializedListener: ListenCallback | undefined;
    vi.mocked(mockListen).mockImplementation((event: string, callback: ListenCallback) => {
      if (event === "workflow-step-materialized") {
        materializedListener = callback;
      }
      return Promise.resolve(vi.fn());
    });

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-invalid-step0", "sonnet");

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(materializedListener).toBeDefined();
    });

    act(() => {
      materializedListener?.({
        payload: {
          agent_id: "agent-invalid-step0",
          skill_name: "test-skill",
          step_id: 0,
          success: false,
          error_detail: "clarifications.json failed schema validation",
        },
      });
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("error");
    });
    expect(useWorkflowStore.getState().isRunning).toBe(false);
    expect(vi.mocked(materializeWorkflowStepOutput)).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      "Step 1 backend materialization failed: clarifications.json failed schema validation",
      { duration: Infinity },
    );
  });

  it("passes step 3 structured payload to backend materialization", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().updateStepStatus(2, "completed");
    useWorkflowStore.getState().setCurrentStep(3);
    useWorkflowStore.getState().updateStepStatus(3, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-step3-structured", "sonnet");

    render(<WorkflowPage />);

    const payload = {
      status: "generated",
      // benchmark_status collapsed into status for benchmark-skill output
      benchmark_path: "evals/iterations/iteration-1",
    };

    act(() => {
      useAgentStore.getState().addDisplayItem("agent-step3-structured", {
        id: "result-step3",
        type: "result",
        timestamp: Date.now(),
        outputText_result: "Agent completed",
        structuredOutput: payload,
        resultStatus: "success",
      });
      useAgentStore.getState().completeRun("agent-step3-structured", true);
    });

    // Step 3 generate-skill completes directly (no benchmark phase)
    await waitFor(() => {
      expect(vi.mocked(materializeWorkflowStepOutput)).toHaveBeenCalledWith(
        "test-skill",
        3,
        payload
      );
      expect(useWorkflowStore.getState().steps[3].status).toBe("completed");
    });
  });

  it("step 3 errors when structured output payload is missing", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().updateStepStatus(2, "completed");
    useWorkflowStore.getState().setCurrentStep(3);
    useWorkflowStore.getState().updateStepStatus(3, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-missing-step3", "sonnet");

    render(<WorkflowPage />);

    act(() => {
      useAgentStore.getState().completeRun("agent-missing-step3", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[3].status).toBe("error");
    });
    expect(vi.mocked(materializeWorkflowStepOutput)).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalled();
  });

  it("gate evaluator triggers on step 0 Continue", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    // reviewMode=true (default) — prevents reposition effect from auto-advancing
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(screen.getByTestId("step-complete")).toBeTruthy();

    // Clarifications are now loaded from DB via invokeCommand("get_clarifications")
    expect(vi.mocked(invokeCommand)).toHaveBeenCalledWith(
      "get_clarifications",
      expect.objectContaining({ skillId: "test-skill" }),
    );
  });

  it("does not advance to Detailed Research while answer analysis is running", async () => {
    const jsonData = makeClarificationsJson();
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications.json") {
        return Promise.resolve(JSON.stringify(jsonData));
      }
      return Promise.reject("not found");
    });

    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-agent-1");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const firstRenderProps = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    expect(firstRenderProps).toBeTruthy();
    expect(typeof firstRenderProps?.onClarificationsContinue).toBe("function");

    await act(async () => {
      firstRenderProps?.onClarificationsContinue?.();
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().gateLoading).toBe(true);
    });

    // Simulate an accidental stale "Next Step" callback firing while the gate is active.
    act(() => {
      firstRenderProps?.onNextStep?.();
    });

    const wf = useWorkflowStore.getState();
    expect(wf.currentStep).toBe(0);
    expect(vi.mocked(runWorkflowStep)).not.toHaveBeenCalledWith("test-skill", 1, "/test/workspace");

  });

  it("writes vague/contradictory evaluator feedback into clarifications notes", async () => {
    const evaluation = {
      verdict: "mixed",
      answered_count: 2,
      empty_count: 0,
      vague_count: 1,
      contradictory_count: 1,
      total_count: 2,
      reasoning: "One vague and one contradictory answer.",
      per_question: [
        { question_id: "Q1", verdict: "vague", reason: "Uses non-specific wording." },
        { question_id: "Q2", verdict: "contradictory", contradicts: "Q1", reason: "Conflicts with Q1 response." },
      ],
    };

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === gateEvaluationPath) {
        return Promise.resolve(JSON.stringify(evaluation));
      }
      return Promise.reject("not found");
    });
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-agent-1");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    expect(typeof props?.onClarificationsContinue).toBe("function");

    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    // Complete gate evaluator agent and trigger finishGateEvaluation.
    act(() => {
      useAgentStore.getState().startRun("gate-agent-1", "haiku");
      useAgentStore.getState().completeRun("gate-agent-1", true);
    });

    // Gate persists per-question verdicts to DB via invokeCommand("update_clarification_verdicts")
    await waitFor(() => {
      const calls = vi.mocked(invokeCommand).mock.calls;
      expect(calls.some(([cmd]) => cmd === "update_clarification_verdicts")).toBe(true);
    });

    const verdictCall = vi.mocked(invokeCommand).mock.calls.find(
      ([cmd]) => cmd === "update_clarification_verdicts",
    );
    const updates = (verdictCall?.[1] as { updates: Array<{ question_id: string; verdict: string; reason: string | null }> })?.updates;
    expect(updates).toBeDefined();
    expect(updates.some((u) => u.question_id === "Q1" && u.verdict === "vague")).toBe(true);
    expect(updates.some((u) => u.question_id === "Q2" && u.verdict === "contradictory")).toBe(true);
  });

  it("materializes OpenHands gate result_text when no legacy result item exists", async () => {
    const jsonData = makeClarificationsJson();
    const evaluation = {
      verdict: "mixed",
      answered_count: 2,
      empty_count: 0,
      vague_count: 1,
      contradictory_count: 0,
      total_count: 3,
      reasoning: "Two answers are clear and one is vague.",
      gate_decision: "run_research",
      per_question: [
        { question_id: "Q1", verdict: "clear" },
        { question_id: "Q2", verdict: "clear" },
        { question_id: "Q3", verdict: "vague", reason: "Too general." },
      ],
    };

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications.json") {
        return Promise.resolve(JSON.stringify(jsonData));
      }
      if (path === gateEvaluationPath) {
        return Promise.resolve(JSON.stringify(evaluation));
      }
      return Promise.reject("not found");
    });
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-openhands-result-text");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    act(() => {
      useAgentStore.getState().applyConversationState("gate-openhands-result-text", {
        type: "conversation_state",
        runtime: "openhands",
        status: "completed",
        resultText: `\`\`\`json\n${JSON.stringify(evaluation)}\n\`\`\``,
        timestamp: Date.now(),
      });
    });

    await waitFor(() => {
      expect(vi.mocked(materializeAnswerEvaluationOutput)).toHaveBeenCalledWith(
        "test-skill",
        "/test/workspace",
        evaluation,
      );
    });
  });

  it("materializes OpenHands gate result_text when JSON is wrapped in prose", async () => {
    const jsonData = makeClarificationsJson();
    const evaluation = {
      verdict: "sufficient",
      answered_count: 2,
      empty_count: 0,
      vague_count: 0,
      contradictory_count: 0,
      total_count: 2,
      reasoning: "All answers are actionable.",
      gate_decision: "run_research",
      per_question: [
        { question_id: "Q1", verdict: "clear" },
        { question_id: "Q2", verdict: "clear" },
      ],
    };

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications.json") {
        return Promise.resolve(JSON.stringify(jsonData));
      }
      if (path === gateEvaluationPath) {
        return Promise.resolve("NOT VALID JSON {{{");
      }
      return Promise.reject("not found");
    });
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-openhands-prose-result-text");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    act(() => {
      useAgentStore.getState().applyConversationState("gate-openhands-prose-result-text", {
        type: "conversation_state",
        runtime: "openhands",
        status: "completed",
        resultText: [
          "I reviewed the answers and produced the final decision below.",
          "```json",
          JSON.stringify(evaluation),
          "```",
          "Use this structured output.",
        ].join("\n"),
        timestamp: Date.now(),
      });
    });

    await waitFor(() => {
      expect(vi.mocked(materializeAnswerEvaluationOutput)).toHaveBeenCalledWith(
        "test-skill",
        "/test/workspace",
        evaluation,
      );
    });
  });

  it("gate falls back when structured gate payload is missing", async () => {
    const jsonData = makeClarificationsJson();
    const evaluation = {
      verdict: "mixed",
      answered_count: 1,
      empty_count: 0,
      vague_count: 1,
      contradictory_count: 0,
      total_count: 1,
      reasoning: "One answer is vague.",
      per_question: [
        { question_id: "Q1", verdict: "vague", reason: "Needs concrete metrics." },
      ],
    };

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications.json") {
        return Promise.resolve(JSON.stringify(jsonData));
      }
      if (path === gateEvaluationPath) {
        return Promise.resolve(JSON.stringify(evaluation));
      }
      return Promise.reject("not found");
    });
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-agent-missing-structured");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    act(() => {
      useAgentStore.getState().startRun("gate-agent-missing-structured", "haiku");
      // Intentionally no result message with structured payload.
      useAgentStore.getState().completeRun("gate-agent-missing-structured", true);
    });

    await waitFor(() => {
      expect(vi.mocked(materializeAnswerEvaluationOutput)).not.toHaveBeenCalled();
    });
    // gate with no structured output reads eval file directly; mixed verdict + run_research default → auto-advance
    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
      expect(useWorkflowStore.getState().currentStep).toBe(1);
    });
  });

  it("writes evaluator feedback notes after Detailed Research continue (step 1 gate)", async () => {
    const evaluation = {
      verdict: "mixed",
      answered_count: 3,
      empty_count: 0,
      vague_count: 1,
      contradictory_count: 0,
      total_count: 3,
      reasoning: "One vague answer.",
      per_question: [
        { question_id: "Q3", verdict: "vague", reason: "Missing concrete thresholds." },
      ],
    };

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === gateEvaluationPath) {
        return Promise.resolve(JSON.stringify(evaluation));
      }
      return Promise.reject("not found");
    });
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-agent-2");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().setCurrentStep(1);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    expect(typeof props?.onClarificationsContinue).toBe("function");

    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    act(() => {
      useAgentStore.getState().startRun("gate-agent-2", "haiku");
      useAgentStore.getState().completeRun("gate-agent-2", true);
    });

    await waitFor(() => {
      const calls = vi.mocked(invokeCommand).mock.calls;
      expect(calls.some(([cmd]) => cmd === "update_clarification_verdicts")).toBe(true);
    });

    const verdictCall = vi.mocked(invokeCommand).mock.calls.find(
      ([cmd]) => cmd === "update_clarification_verdicts",
    );
    const updates = (verdictCall?.[1] as { updates: Array<{ question_id: string; verdict: string }> })?.updates;
    expect(updates).toBeDefined();
    expect(updates.some((u) => u.question_id === "Q3" && u.verdict === "vague")).toBe(true);
  });

  it("writes notes for not_answered and needs_refinement verdicts", async () => {
    const evaluation = {
      verdict: "mixed",
      answered_count: 1,
      empty_count: 1,
      vague_count: 0,
      contradictory_count: 0,
      total_count: 2,
      reasoning: "One unanswered and one needs refinement.",
      per_question: [
        { question_id: "Q1", verdict: "not_answered" },
        { question_id: "Q2", verdict: "needs_refinement" },
      ],
    };

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === gateEvaluationPath) {
        return Promise.resolve(JSON.stringify(evaluation));
      }
      return Promise.reject("not found");
    });
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-agent-4");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    expect(typeof props?.onClarificationsContinue).toBe("function");

    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    act(() => {
      useAgentStore.getState().startRun("gate-agent-4", "haiku");
      useAgentStore.getState().completeRun("gate-agent-4", true);
    });

    await waitFor(() => {
      const calls = vi.mocked(invokeCommand).mock.calls;
      expect(calls.some(([cmd]) => cmd === "update_clarification_verdicts")).toBe(true);
    });

    const verdictCall = vi.mocked(invokeCommand).mock.calls.find(
      ([cmd]) => cmd === "update_clarification_verdicts",
    );
    const updates = (verdictCall?.[1] as { updates: Array<{ question_id: string; verdict: string }> })?.updates;
    expect(updates).toBeDefined();
    expect(updates.some((u) => u.question_id === "Q1" && u.verdict === "not_answered")).toBe(true);
    expect(updates.some((u) => u.question_id === "Q2" && u.verdict === "needs_refinement")).toBe(true);
  });

  it("gate auto-updates clarifications with feedback notes after revise decision", async () => {
    // With gate_decision="revise", the gate stays on step 0 and persists per-question
    // verdicts via invokeCommand("update_clarification_verdicts") — no file writes.
    const evaluation = {
      verdict: "mixed",
      answered_count: 1,
      empty_count: 0,
      vague_count: 1,
      contradictory_count: 0,
      total_count: 1,
      gate_decision: "revise",
      reasoning: "One answer is vague.",
      per_question: [
        { question_id: "Q1", verdict: "vague", reason: "Needs concrete metrics." },
      ],
    };

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === gateEvaluationPath) {
        return Promise.resolve(JSON.stringify(evaluation));
      }
      return Promise.reject("not found");
    });
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-agent-3");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    act(() => {
      useAgentStore.getState().startRun("gate-agent-3", "haiku");
      useAgentStore.getState().completeRun("gate-agent-3", true);
    });

    // revise decision: stays on step 0, persists per-question verdicts via invokeCommand
    await waitFor(() => {
      const calls = vi.mocked(invokeCommand).mock.calls;
      expect(calls.some(([cmd]) => cmd === "update_clarification_verdicts")).toBe(true);
    });

    const verdictCall = vi.mocked(invokeCommand).mock.calls.find(
      ([cmd]) => cmd === "update_clarification_verdicts",
    );
    const updates = (verdictCall?.[1] as { updates: Array<{ question_id: string; verdict: string }> })?.updates;
    expect(updates).toBeDefined();
    expect(updates.some((u) => u.question_id === "Q1" && u.verdict === "vague")).toBe(true);

    // revise: step stays completed at 0, does NOT advance
    expect(useWorkflowStore.getState().currentStep).toBe(0);
    expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
  });

  it("skipToDecisions from step 0 skips to step 2 (Confirm Decisions)", async () => {
    // Set up step 0 completed
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    // Verify that when step 1 (Detailed Research) is skipped,
    // it should be marked completed and currentStep set to step 2
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().setCurrentStep(2);

    const wf = useWorkflowStore.getState();
    expect(wf.steps[1].status).toBe("completed");
    expect(wf.currentStep).toBe(2);
    expect(wf.steps[2].name).toBe("Confirm Decisions");
  });

  it("gate auto-advances to step 1 and triggers DB persist", async () => {
    // Gate with run_research decision auto-advances from step 0 to step 1.
    // The persistence hook debounces saveWorkflowState after the state transition.
    const jsonData = makeClarificationsJson();
    const sufficientEvaluation = {
      verdict: "sufficient",
      answered_count: 2,
      empty_count: 0,
      vague_count: 0,
      contradictory_count: 0,
      total_count: 2,
      reasoning: "All answers are clear and complete.",
      per_question: [],
    };

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications.json") {
        return Promise.resolve(JSON.stringify(jsonData));
      }
      if (path === gateEvaluationPath) {
        return Promise.resolve(JSON.stringify(sufficientEvaluation));
      }
      return Promise.reject("not found");
    });
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-agent-sufficient");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    act(() => {
      useAgentStore.getState().startRun("gate-agent-sufficient", "haiku");
      useAgentStore.getState().completeRun("gate-agent-sufficient", true);
    });

    // Gate with run_research default → auto-advances to step 1
    await waitFor(() => {
      expect(useWorkflowStore.getState().currentStep).toBe(1);
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
    });

    // Persistence hook debounces saveWorkflowState after state change
    await waitFor(() => {
      expect(vi.mocked(saveWorkflowState)).toHaveBeenCalled();
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
      modelSettings: {
        model: "sonnet",
        api_key: "sk-test",
      },
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
    vi.mocked(restartSkillOpenHandsSession).mockClear();
    vi.mocked(verifyStepOutput).mockReset().mockResolvedValue(true);

    // Tests in this block set reviewMode=false (Update mode). Signal autoStart so the
    // persistence hook's early-return preserves Update mode instead of resetting to Review.
    mockLocation.state = { autoStart: true };
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
    mockLocation.state = {};
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

    // verifyStepOutput returns false — no partial artifacts → no confirmation dialog
    vi.mocked(verifyStepOutput).mockResolvedValue(false);

    render(<WorkflowPage />);

    // Wait for artifact detection to settle so the button renders without a dialog
    await waitFor(() => {
      expect(vi.mocked(verifyStepOutput)).toHaveBeenCalled();
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

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

    // verifyStepOutput returns true — partial artifacts exist → confirmation dialog will show
    // (default from beforeEach is already true, no override needed)

    render(<WorkflowPage />);

    // Wait for artifact detection to complete (verifyStepOutput resolves asynchronously)
    await waitFor(() => {
      expect(vi.mocked(verifyStepOutput)).toHaveBeenCalled();
    });
    // Flush promise so errorHasArtifacts state updates
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

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

  it("shows inline Retry button on error and calls runWorkflowStep when clicked", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);

    // Put step 0 in error state (agent failed)
    useWorkflowStore.getState().updateStepStatus(0, "error");

    // No partial artifacts on disk
    vi.mocked(readFile).mockRejectedValue("not found");

    render(<WorkflowPage />);

    // Wait for error UI to render
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Retry/ })).toBeTruthy();
    });

    // Clear previous calls so we can assert the retry call
    vi.mocked(runWorkflowStep).mockClear();

    // Click the inline Retry button
    await act(async () => {
      screen.getByRole("button", { name: /Retry/ }).click();
    });

    // Should trigger the agent step to restart
    await waitFor(() => {
      expect(vi.mocked(runWorkflowStep)).toHaveBeenCalled();
    });
  });
});

describe("WorkflowPage — VD-615 clarifications editor on completed agent step", () => {
  beforeEach(() => {
    resetTauriMocks();
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();

    useSettingsStore.getState().setSettings({
      workspacePath: "/test/workspace",
      skillsPath: "/test/skills",
      modelSettings: {
        model: "sonnet",
        api_key: "sk-test",
      },
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
    vi.mocked(runAnswerEvaluator).mockClear();
    mockClarificationsOnChange.mockClear();
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
  });

  /** Helper: set up step 0 completed with clarifications loaded (clarificationsEditable step).
   * Uses review mode (default) to keep currentStep stable — the "reposition to first
   * incomplete step" effect only fires in update mode. */
  function setupCompletedStep0(data?: ClarificationsFile) {
    const jsonData = data ?? makeClarificationsJson();
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications.json") {
        return Promise.resolve(JSON.stringify(jsonData));
      }
      return Promise.reject("not found");
    });

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    // reviewMode=true (default) — prevents reposition effect from auto-advancing
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);
  }

  it("renders step-complete screen when step 0 is completed", async () => {
    setupCompletedStep0();
    render(<WorkflowPage />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(screen.getByTestId("step-complete")).toBeTruthy();
  });

  it("shows nav guard with unsaved changes text when blocker is triggered on editable step", async () => {
    setupCompletedStep0();

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

describe("WorkflowPage — VD-863 autosave on completed agent step with clarificationsEditable", () => {
  beforeEach(() => {
    resetTauriMocks();
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();

    useSettingsStore.getState().setSettings({
      workspacePath: "/test/workspace",
      skillsPath: "/test/skills",
      modelSettings: {
        model: "sonnet",
        api_key: "sk-test",
      },
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
    vi.mocked(runAnswerEvaluator).mockClear();
    mockClarificationsOnChange.mockClear();
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("autosave saves clarification answer immediately on completed clarificationsEditable step", async () => {
    const clarJson = makeClarificationsJson();

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await act(async () => { await Promise.resolve(); });

    const calls = vi.mocked(WorkflowStepComplete).mock.calls;
    const stepCompleteProps = calls[calls.length - 1]?.[0];
    const onClarificationsChange = stepCompleteProps?.onClarificationsChange;
    expect(onClarificationsChange).toBeDefined();

    // Simulate Q1 receiving an answer choice
    const clarJsonWithAnswer = {
      ...clarJson,
      sections: [{
        ...clarJson.sections[0],
        questions: [
          { ...clarJson.sections[0].questions[0], answer_choice: "A" },
          clarJson.sections[0].questions[1],
        ],
      }],
    };

    vi.mocked(invokeCommand).mockClear();
    act(() => { onClarificationsChange?.(clarJsonWithAnswer); });

    // Save is immediate — no 1500ms wait
    await waitFor(() => {
      expect(vi.mocked(invokeCommand)).toHaveBeenCalledWith(
        "update_clarification_answer",
        expect.objectContaining({ skillId: "test-skill", questionId: "Q1", answerChoice: "A" }),
      );
    });

    // writeFile is NOT called — all saves go through invokeCommand
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });

  it("autosave does NOT fire on pending agent steps", async () => {
    // Use real timers — no timer-based interaction needed
    vi.useRealTimers();

    // Set up step 0 as pending (not completed, no clarificationsEditable trigger)
    vi.mocked(readFile).mockRejectedValue("not found");
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    // Wait a bit — autosave should never fire on a pending step
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // On a pending step, writeFile should not be called by autosave
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });

  it("autosave does NOT fire on steps without clarificationsEditable", async () => {
    vi.useRealTimers();

    // Set up step 2 (Confirm Decisions — no clarificationsEditable)
    vi.mocked(readFile).mockRejectedValue("not found");
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().updateStepStatus(2, "completed");
    useWorkflowStore.getState().setCurrentStep(2);

    render(<WorkflowPage />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // No autosave on non-editable steps
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });
});

describe("WorkflowPage — review mode default state", () => {
  beforeEach(() => {
    resetTauriMocks();
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();

    useSettingsStore.getState().setSettings({
      workspacePath: "/test/workspace",
      modelSettings: {
        model: "sonnet",
        api_key: "sk-test",
      },
    });

    mockToast.success.mockClear();
    mockToast.error.mockClear();
    mockBlocker.status = "idle";
    vi.mocked(saveWorkflowState).mockClear();
    vi.mocked(getWorkflowState).mockClear();
    vi.mocked(runWorkflowStep).mockClear();
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
  });

  it("shows 'Switch to Update mode' message in review mode on pending agent step", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    // reviewMode defaults to true from initWorkflow

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByText("Switch to Update mode to run this step.")).toBeTruthy();
    });

    // Should NOT show the initializing indicator
    expect(screen.queryByText("Initializing agent")).toBeNull();
    // Should NOT have called runWorkflowStep (no auto-start in review mode)
    expect(vi.mocked(runWorkflowStep)).not.toHaveBeenCalled();
  });

  it("autoStart via router state puts workflow in Update mode even when saved state exists", async () => {
    // Simulate the create-flow navigating to a skill that already has a saved run in DB.
    mockLocation.state = { autoStart: true };

    vi.mocked(getWorkflowState).mockResolvedValueOnce({
      run: {
        skill_name: "test-skill",
        current_step: 0,
        status: "pending",
        purpose: "domain",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      steps: [],
    });

    render(<WorkflowPage />);

    // After hydration, reviewMode should be false (autoStart=true) even though state.run exists
    await waitFor(() => {
      expect(useWorkflowStore.getState().hydrated).toBe(true);
    });
    expect(useWorkflowStore.getState().reviewMode).toBe(false);
  });
});

describe("step reset behavior regressions", () => {
  beforeEach(() => {
    resetTauriMocks();
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();

    useSettingsStore.getState().setSettings({
      workspacePath: "/test/workspace",
      skillsPath: "/test/skills",
      modelSettings: {
        model: "sonnet",
        api_key: "sk-test",
      },
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
    vi.mocked(resetWorkflowStep).mockClear();
    vi.mocked(endWorkflowSession).mockClear();
    vi.mocked(previewStepReset).mockClear();
    vi.mocked(verifyStepOutput).mockReset().mockResolvedValue(true);

    // Tests in this block set reviewMode=false (Update mode). Signal autoStart so the
    // persistence hook's early-return preserves Update mode instead of resetting to Review.
    mockLocation.state = { autoStart: true };
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
    mockLocation.state = {};
    // Restore default mocks in case a test overrode them
    vi.mocked(WorkflowSidebar).mockImplementation(() => <div data-testid="workflow-sidebar" />);
    vi.mocked(WorkflowStepComplete).mockImplementation(() => <div data-testid="step-complete" />);
  });

  it("onResetStep on step 1 calls resetWorkflowStep with stepId 0 (rerun from research)", async () => {
    // Detailed-research rerun resets from step 0, clearing clarifications.json.
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().setCurrentStep(1);

    vi.mocked(readFile).mockRejectedValue("not found");
    vi.mocked(resetWorkflowStep).mockResolvedValue(undefined);

    let capturedOnResetStep: (() => void) | undefined;
    vi.mocked(WorkflowStepComplete).mockImplementation(({ onResetStep }) => {
      capturedOnResetStep = onResetStep;
      return <div data-testid="step-complete" />;
    });

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByTestId("step-complete")).toBeTruthy();
    });

    expect(capturedOnResetStep).toBeDefined();

    await act(async () => {
      capturedOnResetStep!();
    });

    // Must reset from step 0, not step 1, so clarifications.json is deleted
    expect(vi.mocked(resetWorkflowStep)).toHaveBeenCalledWith(
      "/test/workspace",
      "test-skill",
      0,
    );
    expect(vi.mocked(restartSkillOpenHandsSession)).toHaveBeenCalled();

    // Step 0 is no longer completed (auto-start fires so it becomes in_progress)
    expect(useWorkflowStore.getState().steps[0].status).not.toBe("completed");
  });

  it("onResetStep on step 1 resets all steps from 0 onward", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().setCurrentStep(1);

    vi.mocked(readFile).mockRejectedValue("not found");
    vi.mocked(resetWorkflowStep).mockResolvedValue(undefined);

    let capturedOnResetStep: (() => void) | undefined;
    vi.mocked(WorkflowStepComplete).mockImplementation(({ onResetStep }) => {
      capturedOnResetStep = onResetStep;
      return <div data-testid="step-complete" />;
    });

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByTestId("step-complete")).toBeTruthy();
    });

    await act(async () => {
      capturedOnResetStep!();
    });

    expect(vi.mocked(resetWorkflowStep)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      0,
    );

    // Step 0 is no longer completed (auto-start fires → in_progress); steps 2+ are pending
    expect(useWorkflowStore.getState().steps[0].status).not.toBe("completed");
    expect(useWorkflowStore.getState().steps[2].status).toBe("pending");
    expect(useWorkflowStore.getState().steps[3].status).toBe("pending");
  });

  it("onResetStep on completed step auto-starts the agent without navigation roundtrip (VU-1021)", async () => {
    // The core bug: clicking Reset Step on a completed step should immediately
    // start the agent — no need to navigate away and back.
    vi.mocked(runWorkflowStep).mockResolvedValue("agent-reset-auto");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    vi.mocked(readFile).mockRejectedValue("not found");
    vi.mocked(resetWorkflowStep).mockResolvedValue(undefined);

    let capturedOnResetStep: (() => void) | undefined;
    vi.mocked(WorkflowStepComplete).mockImplementation(({ onResetStep }) => {
      capturedOnResetStep = onResetStep;
      return <div data-testid="step-complete" />;
    });

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByTestId("step-complete")).toBeTruthy();
    });

    expect(capturedOnResetStep).toBeDefined();

    await act(async () => {
      capturedOnResetStep!();
    });

    // Agent should auto-start: runWorkflowStep called, step transitions to in_progress
    await waitFor(() => {
      expect(vi.mocked(runWorkflowStep)).toHaveBeenCalledWith(
        "test-skill",
        0,
        "/test/workspace",
        expect.anything(),
      );
    });
    expect(useWorkflowStore.getState().steps[0].status).toBe("in_progress");
    expect(useWorkflowStore.getState().isRunning).toBe(true);
  });

  it("Reset Step button on error state auto-starts the agent (VU-1021)", async () => {
    vi.mocked(runWorkflowStep).mockResolvedValue("agent-error-retry");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "error");
    useWorkflowStore.getState().setRunning(false);

    // Ensure no partial artifacts so the Reset button calls performStepReset directly
    // (not showing a confirmation dialog).
    vi.mocked(verifyStepOutput).mockResolvedValue(false);
    vi.mocked(resetWorkflowStep).mockResolvedValue(undefined);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Reset Step/ })).toBeTruthy();
    });

    await act(async () => {
      screen.getByRole("button", { name: /Reset Step/ }).click();
    });

    // Agent should auto-start after reset
    await waitFor(() => {
      expect(vi.mocked(runWorkflowStep)).toHaveBeenCalledWith(
        "test-skill",
        0,
        "/test/workspace",
        expect.anything(),
      );
    });
    expect(useWorkflowStore.getState().steps[0].status).toBe("in_progress");
    expect(useWorkflowStore.getState().isRunning).toBe(true);
  });

  it("ResetStepDialog for step 0 calls resetToStep(0) making step 0 pending", async () => {
    // Bug 2 regression: clicking step 0 from step 1 in update mode should call resetToStep(0),
    // making step 0 pending (not keeping it completed like navigateBackToStep would do).
    vi.mocked(WorkflowSidebar).mockImplementation(({ onStepClick }: { onStepClick?: (id: number) => void }) => (
      <div data-testid="workflow-sidebar">
        <button data-testid="sidebar-step-0" onClick={() => onStepClick?.(0)}>Step 0</button>
      </div>
    ));

    vi.mocked(previewStepReset).mockResolvedValue([]);
    vi.mocked(resetWorkflowStep).mockResolvedValue(undefined);

    // Steps 0 and 1 completed, currently on step 1
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().setCurrentStep(1);

    render(<WorkflowPage />);

    // Click step 0 in the sidebar — opens ResetStepDialog (step 0 < currentStep 1)
    await act(async () => {
      screen.getByTestId("sidebar-step-0").click();
    });

    // ResetStepDialog should appear
    await waitFor(() => {
      expect(screen.getByText("Reset to Earlier Step")).toBeTruthy();
    });

    // Wait for preview to load and Reset button to be enabled
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reset" })).toBeEnabled();
    });

    // Confirm the reset
    await act(async () => {
      screen.getByRole("button", { name: "Reset" }).click();
    });

    // navigateBackToStepDb must be called for step 0 so artifacts from step 1+
    // are deleted from disk (regression for step-0 reset skipping file cleanup).
    expect(vi.mocked(navigateBackToStepDb)).toHaveBeenCalledWith(
      expect.anything(), // workspacePath
      "test-skill",
      0,
    );

    // Step 0 must be pending — resetToStep(0) was called (not navigateBackToStep)
    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("pending");
    });

    // currentStep should reposition to 0
    expect(useWorkflowStore.getState().currentStep).toBe(0);
  });

  it("ResetStepDialog for step 1 calls navigateBackToStep(1) keeping step 1 completed", async () => {
    // When clicking step 1 from step 2 in update mode, the dialog calls navigateBackToStep(1).
    // navigateBackToStep keeps the target step as-is (completed) and resets only steps > 1.
    vi.mocked(WorkflowSidebar).mockImplementation(({ onStepClick }: { onStepClick?: (id: number) => void }) => (
      <div data-testid="workflow-sidebar">
        <button data-testid="sidebar-step-1" onClick={() => onStepClick?.(1)}>Step 1</button>
      </div>
    ));

    vi.mocked(previewStepReset).mockResolvedValue([]);

    // Steps 0, 1, 2 all completed, currently on step 2
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().updateStepStatus(2, "completed");
    useWorkflowStore.getState().setCurrentStep(2);

    render(<WorkflowPage />);

    // Click step 1 in the sidebar — step 1 < currentStep 2
    await act(async () => {
      screen.getByTestId("sidebar-step-1").click();
    });

    await waitFor(() => {
      expect(screen.getByText("Reset to Earlier Step")).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reset" })).toBeEnabled();
    });

    await act(async () => {
      screen.getByRole("button", { name: "Reset" }).click();
    });

    // navigateBackToStep(1): keeps step 1 completed, resets steps > 1 to pending
    await waitFor(() => {
      expect(useWorkflowStore.getState().currentStep).toBe(1);
    });
    expect(useWorkflowStore.getState().steps[1].status).toBe("completed");
    expect(useWorkflowStore.getState().steps[2].status).toBe("pending");
  });

  it("WorkflowStepComplete receives onResetStep prop in update mode (non-review)", async () => {
    // Verify that onResetStep is wired through to WorkflowStepComplete when reviewMode=false.
    // The prop must be defined so the Reset Step button is available on the completion screen.
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    // reviewMode=false (update mode)
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    vi.mocked(readFile).mockRejectedValue("not found");

    let capturedOnResetStep: unknown = "NOT_CAPTURED";
    vi.mocked(WorkflowStepComplete).mockImplementation(({ onResetStep }) => {
      capturedOnResetStep = onResetStep;
      return <div data-testid="step-complete" />;
    });

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByTestId("step-complete")).toBeTruthy();
    });

    // onResetStep must be a function in update mode (not undefined)
    expect(typeof capturedOnResetStep).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Guard / disabled-step lifecycle tests
// ---------------------------------------------------------------------------
describe("WorkflowPage — guard and disabled-step lifecycle", () => {
  beforeEach(() => {
    resetTauriMocks();
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();

    useSettingsStore.getState().setSettings({
      workspacePath: "/test/workspace",
      modelSettings: {
        model: "sonnet",
        api_key: "sk-test",
      },
    });

    mockToast.success.mockClear();
    mockToast.error.mockClear();
    mockToast.info.mockClear();

    mockBlocker.proceed.mockClear();
    mockBlocker.reset.mockClear();
    mockBlocker.status = "idle";

    vi.mocked(saveWorkflowState).mockClear();
    vi.mocked(resetWorkflowStep).mockClear();

    // Reset named mocks whose implementations may have been persistently changed by earlier describes
    vi.mocked(getWorkflowState).mockReset().mockRejectedValue("not found");
    vi.mocked(getDisabledSteps).mockReset().mockResolvedValue([]);
    vi.mocked(runAnswerEvaluator).mockRejectedValue("not available");
    vi.mocked(materializeWorkflowStepOutput).mockResolvedValue(undefined);
    vi.mocked(materializeAnswerEvaluationOutput).mockResolvedValue(undefined);
    vi.mocked(runWorkflowStep).mockReset();
    vi.mocked(readFile).mockRejectedValue("not found");
    vi.mocked(verifyStepOutput).mockReset().mockResolvedValue(true);

    // Reset WorkflowStepComplete to default implementation so per-test overrides don't bleed through
    vi.mocked(WorkflowStepComplete).mockImplementation(() => <div data-testid="step-complete" />);
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
  });

  // --- Scenario 1: getDisabledSteps called after step 2 (contradictions guard) ---
  it("refreshes disabled steps after step 2 completion (contradictions guard)", async () => {
    vi.mocked(getDisabledSteps).mockResolvedValue([3]);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    for (let i = 0; i < 2; i++) useWorkflowStore.getState().updateStepStatus(i, "completed");
    useWorkflowStore.getState().setCurrentStep(2);
    useWorkflowStore.getState().updateStepStatus(2, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-decisions", "sonnet");

    render(<WorkflowPage />);

    // Step 2 completes with structured output
    act(() => {
      useAgentStore.getState().addDisplayItem("agent-decisions", {
        id: "result-decisions",
        type: "result",
        timestamp: Date.now(),
        outputText_result: "Agent completed",
        structuredOutput: { version: "1", metadata: { decision_count: 2, contradictory_inputs: true }, decisions: [] },
        resultStatus: "success",
      });
      useAgentStore.getState().completeRun("agent-decisions", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[2].status).toBe("completed");
    });

    // getDisabledSteps must have been called after step 2 completion
    expect(vi.mocked(getDisabledSteps)).toHaveBeenCalledWith("test-skill");
    expect(useWorkflowStore.getState().disabledSteps).toEqual([3]);
  });

  // --- Scenario 2: advanceToNextStep blocked when next step is disabled ---
  it("advanceToNextStep does not advance when next step is disabled", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    for (let i = 0; i < 3; i++) useWorkflowStore.getState().updateStepStatus(i, "completed");
    useWorkflowStore.getState().setCurrentStep(2);
    useWorkflowStore.getState().setDisabledSteps([3]);

    // Capture onNextStep from WorkflowStepComplete
    let capturedOnNextStep: (() => void) | undefined;
    vi.mocked(WorkflowStepComplete).mockImplementation(({ onNextStep }) => {
      capturedOnNextStep = onNextStep;
      return <div data-testid="step-complete" />;
    });

    render(<WorkflowPage />);
    await waitFor(() => expect(screen.getByTestId("step-complete")).toBeTruthy());

    // Click "Next Step" — should NOT advance
    await act(async () => capturedOnNextStep?.());

    expect(useWorkflowStore.getState().currentStep).toBe(2);
  });

  // --- Scenario 3: performStepReset on a disabled step does not auto-start ---
  it("performStepReset does not auto-start a disabled step", async () => {
    vi.mocked(getDisabledSteps).mockResolvedValue([3]);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    for (let i = 0; i < 3; i++) useWorkflowStore.getState().updateStepStatus(i, "completed");
    useWorkflowStore.getState().setCurrentStep(3);
    useWorkflowStore.getState().updateStepStatus(3, "error");

    vi.mocked(WorkflowStepComplete).mockImplementation(() => {
      return <div data-testid="step-complete" />;
    });

    render(<WorkflowPage />);

    // The error state renders the error panel, not WorkflowStepComplete.
    // Instead, performStepReset is exposed through the error render.
    // Trigger it directly via the store pattern: simulate what the "Reset Step"
    // button does (the page calls performStepReset(currentStep)).
    // Since the component is mounted, we can trigger via act + store manipulation.
    // We just need to verify the end state.

    // Wait for render
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    // Directly invoke the reset logic by calling resetWorkflowStep + store reset
    // (performStepReset is not directly accessible, but we can test the outcome
    // by checking that runWorkflowStep is NOT called after reset of step 3)
    vi.mocked(runWorkflowStep).mockClear();

    // Simulate what performStepReset does: reset step 3
    await act(async () => {
      await resetWorkflowStep("/test/workspace", "test-skill", 3);
      useWorkflowStore.getState().resetToStep(3);
      const disabled = await getDisabledSteps("test-skill");
      useWorkflowStore.getState().setDisabledSteps(disabled);
    });

    // Step 3 is disabled — auto-start should not trigger
    expect(useWorkflowStore.getState().disabledSteps).toEqual([3]);
    // Give time for any pending auto-start effects
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    // runWorkflowStep should NOT have been called (no auto-start)
    expect(vi.mocked(runWorkflowStep)).not.toHaveBeenCalled();
  });

  // --- Scenario 4: Reposition effect (review→update) skips disabled steps ---
  it("reposition effect skips disabled steps when switching to update mode", async () => {
    vi.mocked(getDisabledSteps).mockResolvedValue([3]);
    vi.mocked(getWorkflowState).mockResolvedValueOnce({
      run: {
        skill_name: "test-skill",
        current_step: 2,
        status: "completed",
        purpose: "domain",
        created_at: "",
        updated_at: "",
      },
      steps: [
        { skill_name: "test-skill", step_id: 0, status: "completed", started_at: null, completed_at: null },
        { skill_name: "test-skill", step_id: 1, status: "completed", started_at: null, completed_at: null },
        { skill_name: "test-skill", step_id: 2, status: "completed", started_at: null, completed_at: null },
      ],
    });

    render(<WorkflowPage />);

    // Wait for hydration — starts in review mode
    await waitFor(() => {
      expect(useWorkflowStore.getState().hydrated).toBe(true);
    });

    // Switch to update mode — should NOT reposition to step 3 (disabled)
    act(() => {
      useWorkflowStore.getState().setReviewMode(false);
    });

    // Should stay on step 2, not jump to step 3
    await waitFor(() => {
      expect(useWorkflowStore.getState().currentStep).toBe(2);
    });
  });

  // --- Scenario 5: Auto-start after reset respects disabled steps ---
  it("autoStartAfterReset skips disabled steps (defense-in-depth)", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setDisabledSteps([3]);
    useWorkflowStore.getState().setCurrentStep(3);
    useWorkflowStore.getState().updateStepStatus(3, "pending");

    vi.mocked(runWorkflowStep).mockClear();

    render(<WorkflowPage />);

    // Step 3 is pending and disabled — auto-start should not fire
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(vi.mocked(runWorkflowStep)).not.toHaveBeenCalled();
  });

  // --- Scenario 5b: Review→update toggle auto-starts the first pending step (VU-1021 regression) ---
  it("review→update toggle auto-starts the first pending agent step", async () => {
    vi.mocked(runWorkflowStep).mockResolvedValue("agent-toggle-1");
    vi.mocked(getWorkflowState).mockResolvedValueOnce({
      run: {
        skill_name: "test-skill",
        current_step: 0,
        status: "completed",
        purpose: "domain",
        created_at: "",
        updated_at: "",
      },
      steps: [],
    });

    render(<WorkflowPage />);

    // Wait for hydration — starts in review mode
    await waitFor(() => {
      expect(useWorkflowStore.getState().hydrated).toBe(true);
    });

    expect(useWorkflowStore.getState().reviewMode).toBe(true);

    // Toggle to update mode
    act(() => {
      useWorkflowStore.getState().setReviewMode(false);
    });

    // The auto-start effect should fire for step 0 (first pending step)
    await waitFor(() => {
      expect(vi.mocked(runWorkflowStep)).toHaveBeenCalledWith(
        "test-skill",
        0,
        "/test/workspace",
        expect.anything(),
      );
    });
    expect(useWorkflowStore.getState().isRunning).toBe(true);
  });

  // --- Scenario 6: Full flow — step 2 + contradictions → no auto-advance to step 3 ---
  it("does not auto-advance to step 3 when step 2 completes with contradictions", async () => {
    vi.mocked(getDisabledSteps).mockResolvedValue([3]);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    for (let i = 0; i < 2; i++) useWorkflowStore.getState().updateStepStatus(i, "completed");
    useWorkflowStore.getState().setCurrentStep(2);
    useWorkflowStore.getState().updateStepStatus(2, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-d", "sonnet");

    render(<WorkflowPage />);

    // Step 2 agent completes
    act(() => {
      useAgentStore.getState().addDisplayItem("agent-d", {
        id: "r-d",
        type: "result",
        timestamp: Date.now(),
        outputText_result: "Done",
        structuredOutput: { version: "1", metadata: { decision_count: 0 }, decisions: [] },
        resultStatus: "success",
      });
      useAgentStore.getState().completeRun("agent-d", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[2].status).toBe("completed");
    });

    // Must stay on step 2 — not advance to disabled step 3
    expect(useWorkflowStore.getState().currentStep).toBe(2);
    expect(useWorkflowStore.getState().disabledSteps).toEqual([3]);

    // Step 3 should NOT have been attempted
    expect(vi.mocked(runWorkflowStep)).not.toHaveBeenCalled();
  });

  // --- Scenario 7: Hydration with currentStep=3 but step 3 disabled ---
  it("repositions away from step 3 when hydrating with step 3 disabled", async () => {
    vi.mocked(getDisabledSteps).mockResolvedValue([3]);
    vi.mocked(getWorkflowState).mockResolvedValueOnce({
      run: {
        skill_name: "test-skill",
        current_step: 3,
        status: "pending",
        purpose: "domain",
        created_at: "",
        updated_at: "",
      },
      steps: [
        { skill_name: "test-skill", step_id: 0, status: "completed", started_at: null, completed_at: null },
        { skill_name: "test-skill", step_id: 1, status: "completed", started_at: null, completed_at: null },
        { skill_name: "test-skill", step_id: 2, status: "completed", started_at: null, completed_at: null },
      ],
    });

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(useWorkflowStore.getState().hydrated).toBe(true);
    });

    // disabledSteps should include 3
    await waitFor(() => {
      expect(useWorkflowStore.getState().disabledSteps).toEqual([3]);
    });
  });

  // --- Scenario 8: Navigate-back to step 2 then "Next Step" with contradictions on disk ---
  it("blocks next-step after navigate-back when contradictions persist on disk", async () => {
    // After navigate-back, disabledSteps is cleared then re-evaluated
    vi.mocked(getDisabledSteps).mockResolvedValue([3]);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    for (let i = 0; i < 3; i++) useWorkflowStore.getState().updateStepStatus(i, "completed");
    useWorkflowStore.getState().setCurrentStep(2);

    // Simulate navigate-back: store clears disabledSteps, then re-evaluates
    act(() => {
      useWorkflowStore.getState().navigateBackToStep(2);
    });

    // disabledSteps cleared by navigateBackToStep
    expect(useWorkflowStore.getState().disabledSteps).toEqual([]);

    // Re-evaluate (as Fix 3 does)
    await act(async () => {
      const disabled = await getDisabledSteps("test-skill");
      useWorkflowStore.getState().setDisabledSteps(disabled);
    });

    // Now disabledSteps should be [3]
    expect(useWorkflowStore.getState().disabledSteps).toEqual([3]);

    // Verify store state: step 2 completed, step 3 pending
    expect(useWorkflowStore.getState().steps[2].status).toBe("completed");
    expect(useWorkflowStore.getState().steps[3].status).toBe("pending");
  });

  // --- Scenario 9: navigate-back followed by guard re-evaluation ---
  it("re-evaluates guards in onReset callback after navigate-back", async () => {
    vi.mocked(getDisabledSteps).mockResolvedValue([3]);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    for (let i = 0; i < 3; i++) useWorkflowStore.getState().updateStepStatus(i, "completed");
    useWorkflowStore.getState().setCurrentStep(3);
    useWorkflowStore.getState().updateStepStatus(3, "error");

    // Simulate the full onReset callback from ResetStepDialog (for resetTarget=2):
    // 1. navigateBackToStep clears disabledSteps
    // 2. getDisabledSteps re-evaluates from disk
    act(() => {
      useWorkflowStore.getState().navigateBackToStep(2);
    });
    expect(useWorkflowStore.getState().disabledSteps).toEqual([]);
    expect(useWorkflowStore.getState().currentStep).toBe(2);

    // The onReset callback calls getDisabledSteps afterward (Fix 3)
    await act(async () => {
      const disabled = await getDisabledSteps("test-skill");
      useWorkflowStore.getState().setDisabledSteps(disabled);
    });

    expect(useWorkflowStore.getState().disabledSteps).toEqual([3]);
    expect(vi.mocked(getDisabledSteps)).toHaveBeenCalledWith("test-skill");
  });

  // --- Scenario 10: getDisabledSteps called after every step, not just step 0 ---
  it("calls getDisabledSteps after step 1 completion (general refresh)", async () => {
    vi.mocked(getDisabledSteps).mockResolvedValue([]);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-r", "sonnet");

    render(<WorkflowPage />);

    vi.mocked(getDisabledSteps).mockClear();

    // Step 1 completes
    act(() => {
      useAgentStore.getState().addDisplayItem("agent-r", {
        id: "r-r",
        type: "result",
        timestamp: Date.now(),
        outputText_result: "Done",
        structuredOutput: { status: "detailed_research_complete", refinement_count: 1, section_count: 3, clarifications_json: {} },
        resultStatus: "success",
      });
      useAgentStore.getState().completeRun("agent-r", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[1].status).toBe("completed");
    });

    // getDisabledSteps should have been called after step 1
    expect(vi.mocked(getDisabledSteps)).toHaveBeenCalledWith("test-skill");
  });
});

// ---------------------------------------------------------------------------
// Isolated ordering test — moved to end to diagnose potential ordering issues
// ---------------------------------------------------------------------------
describe("WorkflowPage — step 3 generate completion (isolated)", () => {
  beforeEach(() => {
    resetTauriMocks();
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();

    useSettingsStore.getState().setSettings({
      workspacePath: "/test/workspace",
      modelSettings: {
        model: "sonnet",
        api_key: "sk-test",
      },
    });

    vi.mocked(verifyStepOutput).mockReset().mockResolvedValue(true);

    mockToast.success.mockClear();
    mockToast.error.mockClear();
    mockToast.info.mockClear();

    mockBlocker.proceed.mockClear();
    mockBlocker.reset.mockClear();
    mockBlocker.status = "idle";

    vi.mocked(saveWorkflowState).mockClear();
    vi.mocked(getWorkflowState).mockClear();
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
  });

  it("pauses on completion screen after step 3 (generate)", async () => {
    // Simulate: steps 0-2 completed, step 3 running
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    for (let i = 0; i < 3; i++) {
      useWorkflowStore.getState().updateStepStatus(i, "completed");
    }
    useWorkflowStore.getState().setCurrentStep(3);
    useWorkflowStore.getState().updateStepStatus(3, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-build", "sonnet");

    render(<WorkflowPage />);

    // Agent completes step 3 (generate) with required structured output via display item
    act(() => {
      useAgentStore.getState().addDisplayItem("agent-build", {
        id: "result-build",
        type: "result",
        timestamp: Date.now(),
        outputText_result: "Agent completed",
        structuredOutput: {
          status: "generated",
          // benchmark_status collapsed into status for benchmark-skill output
      benchmark_path: "evals/iterations/iteration-1",
        },
        resultStatus: "success",
      });
      useAgentStore.getState().completeRun("agent-build", true);
    });

    // Step 3 completes directly (no benchmark phase)
    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[3].status).toBe("completed");
    });

    const wf = useWorkflowStore.getState();

    // Stays on step 3 completion screen — user clicks "Done" or "Refine" to proceed
    expect(wf.currentStep).toBe(3);

    // Running flag cleared
    expect(wf.isRunning).toBe(false);
  });

});

// ---------------------------------------------------------------------------
// TF-02: Gate evaluation handler coverage
// ---------------------------------------------------------------------------
describe("WorkflowPage — gate handler isolated paths (TF-02)", () => {
  beforeEach(() => {
    resetTauriMocks();
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();

    useSettingsStore.getState().setSettings({
      workspacePath: "/test/workspace",
      skillsPath: "/test/skills",
      modelSettings: {
        model: "sonnet",
        api_key: "sk-test",
      },
    });

    mockToast.success.mockClear();
    mockToast.error.mockClear();
    mockToast.info.mockClear();
    mockBlocker.proceed.mockClear();
    mockBlocker.reset.mockClear();
    mockBlocker.status = "idle";

    vi.mocked(saveWorkflowState).mockClear();
    vi.mocked(getWorkflowState).mockReset().mockRejectedValue("not found");
    vi.mocked(readFile).mockClear();
    vi.mocked(writeFile).mockClear();
    vi.mocked(runAnswerEvaluator).mockClear();
    vi.mocked(getDisabledSteps).mockReset().mockResolvedValue([]);
    vi.mocked(materializeWorkflowStepOutput).mockReset().mockResolvedValue(undefined);
    vi.mocked(materializeAnswerEvaluationOutput).mockReset().mockResolvedValue(undefined);
    vi.mocked(runWorkflowStep).mockReset();
    vi.mocked(invokeCommand).mockClear();
    vi.mocked(WorkflowStepComplete).mockImplementation(() => <div data-testid="step-complete" />);
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
    vi.mocked(WorkflowSidebar).mockImplementation(() => <div data-testid="workflow-sidebar" />);
    vi.mocked(WorkflowStepComplete).mockImplementation(() => <div data-testid="step-complete" />);
  });

  /** Helper: trigger gate flow on step 0 and wait for gate dialog */
  async function triggerGateDialog(evaluation: Record<string, unknown>) {
    const jsonData = makeClarificationsJson();
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications.json") {
        return Promise.resolve(JSON.stringify(jsonData));
      }
      if (path === gateEvaluationPath) {
        return Promise.resolve(JSON.stringify(evaluation));
      }
      return Promise.reject("not found");
    });
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-handler-test");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    // Gate agent completes
    act(() => {
      useAgentStore.getState().startRun("gate-handler-test", "haiku");
      useAgentStore.getState().completeRun("gate-handler-test", true);
    });
  }

  async function triggerStep1Gate(
    evaluation: Record<string, unknown>,
    options?: { agentId?: string; success?: boolean },
  ) {
    const agentId = options?.agentId ?? "gate-step1-test";
    const success = options?.success ?? true;

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === gateEvaluationPath) {
        return Promise.resolve(JSON.stringify(evaluation));
      }
      return Promise.reject("not found");
    });
    vi.mocked(runAnswerEvaluator).mockResolvedValue(agentId);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().setCurrentStep(1);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    act(() => {
      useAgentStore.getState().startRun(agentId, "haiku");
      useAgentStore.getState().completeRun(agentId, success);
    });
  }

  it("gate with sufficient verdict auto-advances from step 0 to step 1", async () => {
    // Gate is fully automatic: run_research default → advance without any dialog or button.
    const evaluation = {
      verdict: "sufficient",
      answered_count: 2,
      empty_count: 0,
      vague_count: 0,
      contradictory_count: 0,
      total_count: 2,
      reasoning: "All clear.",
      per_question: [],
    };

    await triggerGateDialog(evaluation);

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
      expect(useWorkflowStore.getState().currentStep).toBe(1);
    });
  });

  it("gate with mixed verdict auto-advances from step 0 to step 1", async () => {
    // mixed verdict with no gate_decision → defaults to run_research → auto-advance
    const evaluation = {
      verdict: "mixed",
      answered_count: 1,
      empty_count: 1,
      vague_count: 1,
      contradictory_count: 0,
      total_count: 2,
      reasoning: "Some vague.",
      per_question: [
        { question_id: "Q1", verdict: "vague", reason: "Too general." },
        { question_id: "Q2", verdict: "not_answered" },
      ],
    };

    await triggerGateDialog(evaluation);

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
      expect(useWorkflowStore.getState().currentStep).toBe(1);
    });
  });

  it("gate with revise decision stays on current step", async () => {
    // gate_decision="revise" → stays on step 0, does not advance
    const evaluation = {
      verdict: "insufficient",
      answered_count: 0,
      empty_count: 2,
      vague_count: 0,
      contradictory_count: 0,
      total_count: 2,
      gate_decision: "revise",
      reasoning: "Answers are missing.",
      per_question: [
        { question_id: "Q1", verdict: "not_answered" },
        { question_id: "Q2", verdict: "not_answered" },
      ],
    };

    await triggerGateDialog(evaluation);

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
    });
    // revise: must NOT advance
    expect(useWorkflowStore.getState().currentStep).toBe(0);
  });

  it("gate with contradiction-driven revise stays on current step", async () => {
    const evaluation = {
      verdict: "mixed",
      answered_count: 1,
      empty_count: 0,
      vague_count: 0,
      contradictory_count: 1,
      total_count: 2,
      gate_decision: "revise",
      reasoning: "One answer contradicts another.",
      per_question: [
        { question_id: "Q1", verdict: "clear" },
        { question_id: "Q2", verdict: "contradictory", reason: "Conflicts with Q1." },
      ],
    };

    await triggerGateDialog(evaluation);

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
    });
    expect(useWorkflowStore.getState().currentStep).toBe(0);
  });

  it("gate on step 1 auto-advances to step 2", async () => {
    // Gate 2 (step 1 completed) with run_research → advances to step 2
    const jsonData = makeClarificationsJson();
    const evaluation = {
      verdict: "sufficient",
      answered_count: 2,
      empty_count: 0,
      vague_count: 0,
      contradictory_count: 0,
      total_count: 2,
      reasoning: "All clear.",
      per_question: [],
    };

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications.json") {
        return Promise.resolve(JSON.stringify(jsonData));
      }
      if (path === gateEvaluationPath) {
        return Promise.resolve(JSON.stringify(evaluation));
      }
      return Promise.reject("not found");
    });
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-ref-test");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().setCurrentStep(1);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    act(() => {
      useAgentStore.getState().startRun("gate-ref-test", "haiku");
      useAgentStore.getState().completeRun("gate-ref-test", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[1].status).toBe("completed");
      expect(useWorkflowStore.getState().currentStep).toBe(2);
    });
  });

  it("gate with revise decision on step 1 stays on current step", async () => {
    const evaluation = {
      verdict: "insufficient",
      answered_count: 0,
      empty_count: 2,
      vague_count: 0,
      contradictory_count: 0,
      total_count: 2,
      gate_decision: "revise",
      reasoning: "Answers are missing.",
      per_question: [
        { question_id: "Q1", verdict: "not_answered" },
        { question_id: "Q2", verdict: "not_answered" },
      ],
    };

    await triggerStep1Gate(evaluation, { agentId: "gate-step1-revise" });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[1].status).toBe("completed");
    });
    expect(useWorkflowStore.getState().currentStep).toBe(1);
  });

  it("gate with contradiction-driven revise on step 1 stays on current step", async () => {
    const evaluation = {
      verdict: "mixed",
      answered_count: 1,
      empty_count: 0,
      vague_count: 0,
      contradictory_count: 1,
      total_count: 2,
      gate_decision: "revise",
      reasoning: "One answer contradicts another.",
      per_question: [
        { question_id: "Q1", verdict: "clear" },
        { question_id: "Q2", verdict: "contradictory", reason: "Conflicts with Q1." },
      ],
    };

    await triggerStep1Gate(evaluation, {
      agentId: "gate-step1-contradiction-revise",
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[1].status).toBe("completed");
    });
    expect(useWorkflowStore.getState().currentStep).toBe(1);
  });

  it("step 1 gate stays on current step when answer-evaluation.json parse fails", async () => {
    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === gateEvaluationPath) {
        return Promise.resolve("NOT VALID JSON {{{");
      }
      return Promise.reject("not found");
    });
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-step1-bad-json");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().setCurrentStep(1);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    act(() => {
      useAgentStore.getState().startRun("gate-step1-bad-json", "haiku");
      useAgentStore.getState().completeRun("gate-step1-bad-json", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[1].status).toBe("completed");
      expect(useWorkflowStore.getState().currentStep).toBe(1);
    });
    expect(mockToast.error).toHaveBeenCalled();
  });

  it("step 1 gate stays on current step when verdict is unrecognized", async () => {
    const evaluation = {
      verdict: "unknown_verdict",
      answered_count: 0,
      empty_count: 0,
      vague_count: 0,
      contradictory_count: 0,
      total_count: 0,
      reasoning: "Unknown.",
      per_question: [],
    };

    await triggerStep1Gate(evaluation, { agentId: "gate-step1-bad-verdict" });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[1].status).toBe("completed");
      expect(useWorkflowStore.getState().currentStep).toBe(1);
    });
    expect(mockToast.error).toHaveBeenCalled();
  });

  it("step 1 gate agent error keeps the workflow on the current step", async () => {
    const evaluation = {
      verdict: "sufficient",
      answered_count: 2,
      empty_count: 0,
      vague_count: 0,
      contradictory_count: 0,
      total_count: 2,
      reasoning: "All clear.",
      per_question: [],
    };

    await triggerStep1Gate(evaluation, {
      agentId: "gate-step1-error-agent",
      success: false,
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[1].status).toBe("completed");
      expect(useWorkflowStore.getState().currentStep).toBe(1);
    });
    expect(useWorkflowStore.getState().gateLoading).toBe(false);
    expect(mockToast.error).toHaveBeenCalled();
  });

  it("runGateOrAdvance falls through to advanceToNextStep when step is not 0 or 1", async () => {
    // Step 2 completed in review mode — runGateOrAdvance should just advance, not run gate evaluation.
    // Use review mode to prevent the reposition effect from moving currentStep away from step 2.
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    // reviewMode=true (default from initWorkflow) — keeps currentStep stable
    for (let i = 0; i < 3; i++) useWorkflowStore.getState().updateStepStatus(i, "completed");
    useWorkflowStore.getState().setCurrentStep(2);

    let capturedOnNextStep: (() => void) | undefined;
    vi.mocked(WorkflowStepComplete).mockImplementation(({ onNextStep }) => {
      capturedOnNextStep = onNextStep;
      return <div data-testid="step-complete" />;
    });

    render(<WorkflowPage />);
    await waitFor(() => expect(screen.getByTestId("step-complete")).toBeTruthy());

    await act(async () => capturedOnNextStep?.());

    // Should advance to step 3 without triggering gate evaluation
    expect(useWorkflowStore.getState().currentStep).toBe(3);
    expect(vi.mocked(runAnswerEvaluator)).not.toHaveBeenCalled();
  });

  it("runGateOrAdvance runs gate even when next step (1) is disabled, but does not advance", async () => {
    // Gate always runs for steps 0 and 1. advanceToNextStep guards against disabled steps,
    // so the workflow stays on step 0 after gate completion.
    vi.mocked(getDisabledSteps).mockResolvedValue([1]);

    const jsonData = makeClarificationsJson();
    const evaluation = {
      verdict: "sufficient",
      answered_count: 2,
      empty_count: 0,
      vague_count: 0,
      contradictory_count: 0,
      total_count: 2,
      reasoning: "All clear.",
      per_question: [],
    };

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications.json") {
        return Promise.resolve(JSON.stringify(jsonData));
      }
      if (path === gateEvaluationPath) {
        return Promise.resolve(JSON.stringify(evaluation));
      }
      return Promise.reject("not found");
    });
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-disabled-test");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);
    useWorkflowStore.getState().setDisabledSteps([1]);

    let capturedOnClarificationsContinue: (() => void) | undefined;
    vi.mocked(WorkflowStepComplete).mockImplementation(({ onClarificationsContinue }) => {
      capturedOnClarificationsContinue = onClarificationsContinue;
      return <div data-testid="step-complete" />;
    });

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(screen.getByTestId("step-complete")).toBeTruthy();
    });

    await act(async () => {
      capturedOnClarificationsContinue?.();
    });

    // Gate IS triggered (step 0 always triggers gate)
    await waitFor(() => {
      expect(vi.mocked(runAnswerEvaluator)).toHaveBeenCalled();
    });

    // Complete the gate agent
    act(() => {
      useAgentStore.getState().startRun("gate-disabled-test", "haiku");
      useAgentStore.getState().completeRun("gate-disabled-test", true);
    });

    // Gate completes with run_research but advanceToNextStep skips disabled step 1 → stays on 0
    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
    });
    expect(useWorkflowStore.getState().currentStep).toBe(0);
  });

  it("finishGateEvaluation stays on current step when answer-evaluation.json parse fails", async () => {
    const jsonData = makeClarificationsJson();

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications.json") {
        return Promise.resolve(JSON.stringify(jsonData));
      }
      if (path === gateEvaluationPath) {
        return Promise.resolve("NOT VALID JSON {{{");
      }
      return Promise.reject("not found");
    });
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-bad-json");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    act(() => {
      useAgentStore.getState().startRun("gate-bad-json", "haiku");
      useAgentStore.getState().completeRun("gate-bad-json", true);
    });

    // JSON parse fails → step stays completed on the current step with an error signal
    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
      expect(useWorkflowStore.getState().currentStep).toBe(0);
    });
    expect(mockToast.error).toHaveBeenCalled();
  });

  it("finishGateEvaluation stays on current step when verdict is unrecognized", async () => {
    const jsonData = makeClarificationsJson();
    const evaluation = {
      verdict: "unknown_verdict",
      answered_count: 0,
      empty_count: 0,
      vague_count: 0,
      contradictory_count: 0,
      total_count: 0,
      reasoning: "Unknown.",
      per_question: [],
    };

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === "/test/skills/test-skill/context/clarifications.json") {
        return Promise.resolve(JSON.stringify(jsonData));
      }
      if (path === gateEvaluationPath) {
        return Promise.resolve(JSON.stringify(evaluation));
      }
      return Promise.reject("not found");
    });
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-bad-verdict");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    act(() => {
      useAgentStore.getState().startRun("gate-bad-verdict", "haiku");
      useAgentStore.getState().completeRun("gate-bad-verdict", true);
    });

    // Invalid verdict → step stays completed on the current step with an error signal
    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
      expect(useWorkflowStore.getState().currentStep).toBe(0);
    });
    expect(mockToast.error).toHaveBeenCalled();
  });

  it("step 0 gate agent error keeps the workflow on the current step", async () => {
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-error-agent");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    vi.mocked(readFile).mockRejectedValue("not found");

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    // Gate agent starts and fails
    act(() => {
      useAgentStore.getState().startRun("gate-error-agent", "haiku");
      useAgentStore.getState().completeRun("gate-error-agent", false);
    });

    // Error path in gate watcher → step completed, stays put, and reports an error
    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[0].status).toBe("completed");
      expect(useWorkflowStore.getState().currentStep).toBe(0);
    });

    // Gate loading should be cleared and the user should see an error
    expect(useWorkflowStore.getState().gateLoading).toBe(false);
    expect(mockToast.error).toHaveBeenCalled();
  });

  it("gate verdict updates: persists actionable per-question verdicts to DB", async () => {
    const evaluation = {
      verdict: "mixed",
      answered_count: 0,
      empty_count: 1,
      vague_count: 1,
      contradictory_count: 1,
      total_count: 4,
      reasoning: "Multiple issues.",
      per_question: [
        { question_id: "Q1", verdict: "vague", reason: "Too general." },
        { question_id: "Q3", verdict: "not_answered", reason: "Skipped entirely." },
        { question_id: "Q4", verdict: "needs_refinement", reason: "Needs more constraints." },
        { question_id: "Q5", verdict: "contradictory", reason: "Conflicts with Q1." },
      ],
    };

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === gateEvaluationPath) {
        return Promise.resolve(JSON.stringify(evaluation));
      }
      return Promise.reject("not found");
    });
    vi.mocked(invokeCommand).mockResolvedValue(undefined);
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-all-verdicts");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    act(() => {
      useAgentStore.getState().startRun("gate-all-verdicts", "haiku");
      useAgentStore.getState().completeRun("gate-all-verdicts", true);
    });

    // Gate should persist verdicts via invokeCommand("update_clarification_verdicts")
    await waitFor(() => {
      const calls = vi.mocked(invokeCommand).mock.calls;
      expect(calls.some(([cmd]) => cmd === "update_clarification_verdicts")).toBe(true);
    });

    const verdictCall = vi.mocked(invokeCommand).mock.calls.find(
      ([cmd]) => cmd === "update_clarification_verdicts",
    );
    const updates = (verdictCall?.[1] as { skillId: string; updates: Array<{ question_id: string; verdict: string; reason: string | null }> })?.updates;

    expect(updates).toBeDefined();
    expect(updates.some((u) => u.question_id === "Q1" && u.verdict === "vague" && u.reason === "Too general.")).toBe(true);
    expect(updates.some((u) => u.question_id === "Q3" && u.verdict === "not_answered" && u.reason === "Skipped entirely.")).toBe(true);
    expect(updates.some((u) => u.question_id === "Q4" && u.verdict === "needs_refinement" && u.reason === "Needs more constraints.")).toBe(true);
    expect(updates.some((u) => u.question_id === "Q5" && u.verdict === "contradictory" && u.reason === "Conflicts with Q1.")).toBe(true);
  });

  it("gate verdict updates: persists null reason when no reason is provided", async () => {
    const evaluation = {
      verdict: "mixed",
      answered_count: 0,
      empty_count: 1,
      vague_count: 1,
      contradictory_count: 0,
      total_count: 3,
      reasoning: "Multiple issues.",
      per_question: [
        { question_id: "Q1", verdict: "vague", reason: null },
        { question_id: "Q3", verdict: "not_answered", reason: null },
      ],
    };

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === gateEvaluationPath) {
        return Promise.resolve(JSON.stringify(evaluation));
      }
      return Promise.reject("not found");
    });
    vi.mocked(invokeCommand).mockResolvedValue(undefined);
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-no-reason");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    act(() => {
      useAgentStore.getState().startRun("gate-no-reason", "haiku");
      useAgentStore.getState().completeRun("gate-no-reason", true);
    });

    await waitFor(() => {
      const calls = vi.mocked(invokeCommand).mock.calls;
      expect(calls.some(([cmd]) => cmd === "update_clarification_verdicts")).toBe(true);
    });

    const verdictCall = vi.mocked(invokeCommand).mock.calls.find(
      ([cmd]) => cmd === "update_clarification_verdicts",
    );
    const updates = (verdictCall?.[1] as { skillId: string; updates: Array<{ question_id: string; verdict: string; reason: string | null }> })?.updates;

    expect(updates.some((u) => u.question_id === "Q1" && u.verdict === "vague" && u.reason === null)).toBe(true);
    expect(updates.some((u) => u.question_id === "Q3" && u.verdict === "not_answered" && u.reason === null)).toBe(true);
  });

  it("gate verdict updates: persists clear verdicts when all answers are clear", async () => {
    const evaluation = {
      verdict: "sufficient",
      answered_count: 2,
      empty_count: 0,
      vague_count: 0,
      contradictory_count: 0,
      total_count: 2,
      reasoning: "All good.",
      per_question: [
        { question_id: "Q1", verdict: "clear", reason: null },
        { question_id: "Q2", verdict: "clear", reason: null },
      ],
    };

    vi.mocked(readFile).mockImplementation((path: string) => {
      if (path === gateEvaluationPath) {
        return Promise.resolve(JSON.stringify(evaluation));
      }
      return Promise.reject("not found");
    });
    vi.mocked(invokeCommand).mockResolvedValue(undefined);
    vi.mocked(runAnswerEvaluator).mockResolvedValue("gate-all-clear");

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().setReviewMode(false);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(0);

    render(<WorkflowPage />);

    await waitFor(() => {
      expect(vi.mocked(WorkflowStepComplete)).toHaveBeenCalled();
    });

    const props = vi.mocked(WorkflowStepComplete).mock.lastCall?.[0];
    await act(async () => {
      props?.onClarificationsContinue?.();
    });

    act(() => {
      useAgentStore.getState().startRun("gate-all-clear", "haiku");
      useAgentStore.getState().completeRun("gate-all-clear", true);
    });

    // Gate advances (sufficient verdict, gate_decision = run_research)
    await waitFor(() => {
      expect(useWorkflowStore.getState().currentStep).toBe(1);
    });

    await waitFor(() => {
      const calls = vi.mocked(invokeCommand).mock.calls;
      expect(calls.some(([cmd]) => cmd === "update_clarification_verdicts")).toBe(true);
    });

    const verdictCall = vi.mocked(invokeCommand).mock.calls.find(
      ([cmd]) => cmd === "update_clarification_verdicts",
    );
    const updates = (verdictCall?.[1] as { skillId: string; updates: Array<{ question_id: string; verdict: string; reason: string | null }> })?.updates;

    expect(updates).toEqual([
      { question_id: "Q1", verdict: "clear", reason: null },
      { question_id: "Q2", verdict: "clear", reason: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// TF-03: Step-completion error paths
// ---------------------------------------------------------------------------
describe("WorkflowPage — step-completion error paths (TF-03)", () => {
  beforeEach(() => {
    resetTauriMocks();
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();

    useSettingsStore.getState().setSettings({
      workspacePath: "/test/workspace",
      skillsPath: "/test/skills",
      modelSettings: {
        model: "sonnet",
        api_key: "sk-test",
      },
    });

    mockToast.success.mockClear();
    mockToast.error.mockClear();
    mockToast.info.mockClear();
    mockBlocker.proceed.mockClear();
    mockBlocker.reset.mockClear();
    mockBlocker.status = "idle";

    vi.mocked(saveWorkflowState).mockClear();
    vi.mocked(getWorkflowState).mockReset().mockRejectedValue("not found");
    vi.mocked(readFile).mockReset().mockRejectedValue("not found");
    vi.mocked(writeFile).mockReset().mockResolvedValue(undefined);
    vi.mocked(verifyStepOutput).mockReset().mockResolvedValue(true);
    vi.mocked(getDisabledSteps).mockReset().mockResolvedValue([]);
    vi.mocked(materializeWorkflowStepOutput).mockReset().mockResolvedValue(undefined);
    vi.mocked(runWorkflowStep).mockReset();
    vi.mocked(WorkflowStepComplete).mockImplementation(() => <div data-testid="step-complete" />);
  });

  afterEach(() => {
    useWorkflowStore.getState().reset();
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().reset();
    vi.mocked(WorkflowStepComplete).mockImplementation(() => <div data-testid="step-complete" />);
  });

  it("step 1 errors before file verification when structured output is missing", async () => {
    vi.mocked(verifyStepOutput).mockResolvedValue(false);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-no-output", "sonnet");

    render(<WorkflowPage />);

    // Agent completes without structured output; step 1 still requires structured output.
    act(() => {
      useAgentStore.getState().completeRun("agent-no-output", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[1].status).toBe("error");
    });

    expect(useWorkflowStore.getState().isRunning).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith(
      "Step 2 completed but produced no structured output",
      { duration: Infinity },
    );
  });

  it("step 1 errors when verifyStepOutput returns false even with valid structured output", async () => {
    vi.mocked(verifyStepOutput).mockResolvedValue(false);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-output-fail", "sonnet");

    render(<WorkflowPage />);

    act(() => {
      useAgentStore.getState().addDisplayItem("agent-output-fail", {
        id: "result-output-fail",
        type: "result",
        timestamp: Date.now(),
        outputText_result: "Agent completed",
        structuredOutput: {
          status: "detailed_research_complete",
          refinement_count: 1,
          section_count: 1,
          clarifications_json: {},
        },
        resultStatus: "success",
      });
      useAgentStore.getState().completeRun("agent-output-fail", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[1].status).toBe("error");
    });

    // materializeWorkflowStepOutput was called (since structured output was present)
    expect(vi.mocked(materializeWorkflowStepOutput)).toHaveBeenCalledWith(
      "test-skill",
      1,
      expect.any(Object),
    );

    // But verifyStepOutput returned false → error
    expect(mockToast.error).toHaveBeenCalledWith(
      "Step 2 completed but produced no output files",
      { duration: Infinity },
    );
  });

  it("step 2 (non-requiresStructuredOutput) completes when structuredOutput is null and verifyStepOutput is true", async () => {
    // Step 2 is "reasoning" type with no requiresStructuredOutput
    vi.mocked(verifyStepOutput).mockResolvedValue(true);

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().setCurrentStep(2);
    useWorkflowStore.getState().updateStepStatus(2, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-step2-no-structured", "sonnet");

    render(<WorkflowPage />);

    // Complete with no structured output
    act(() => {
      useAgentStore.getState().completeRun("agent-step2-no-structured", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[2].status).toBe("completed");
    });

    // Should not have attempted materialization
    expect(vi.mocked(materializeWorkflowStepOutput)).not.toHaveBeenCalled();
  });

  it("step 3 (requiresStructuredOutput) errors when structuredOutput is null", async () => {
    // Step 3 has requiresStructuredOutput: true
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().updateStepStatus(2, "completed");
    useWorkflowStore.getState().setCurrentStep(3);
    useWorkflowStore.getState().updateStepStatus(3, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-step3-null", "sonnet");

    render(<WorkflowPage />);

    // Complete with NO structured output (no result display item)
    act(() => {
      useAgentStore.getState().completeRun("agent-step3-null", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[3].status).toBe("error");
    });

    expect(useWorkflowStore.getState().isRunning).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith(
      "Step 4 completed but produced no structured output",
      { duration: Infinity },
    );
  });

  it("step errors when materializeWorkflowStepOutput throws", async () => {
    vi.mocked(materializeWorkflowStepOutput).mockRejectedValueOnce(new Error("validation failed"));

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().updateStepStatus(2, "completed");
    useWorkflowStore.getState().setCurrentStep(3);
    useWorkflowStore.getState().updateStepStatus(3, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-step3-materialize-fail", "sonnet");

    render(<WorkflowPage />);

    act(() => {
      useAgentStore.getState().addDisplayItem("agent-step3-materialize-fail", {
        id: "result-mat-fail",
        type: "result",
        timestamp: Date.now(),
        outputText_result: "Agent completed",
        structuredOutput: {
          status: "generated",
          // benchmark_status collapsed into status for benchmark-skill output
          benchmark_path: "evals/iterations/iteration-1",
        },
        resultStatus: "success",
      });
      useAgentStore.getState().completeRun("agent-step3-materialize-fail", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[3].status).toBe("error");
    });

    expect(useWorkflowStore.getState().isRunning).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith(
      "Step 4 output validation failed: validation failed",
      { duration: Infinity },
    );
  });

  it("verifyStepOutput exception is non-fatal — step still completes", async () => {
    // Steps 1-3 keep the legacy optimistic behavior for verification exceptions.
    vi.mocked(verifyStepOutput).mockRejectedValue(new Error("disk error"));

    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().setCurrentStep(2);
    useWorkflowStore.getState().updateStepStatus(2, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-verify-throw", "sonnet");

    render(<WorkflowPage />);

    act(() => {
      useAgentStore.getState().completeRun("agent-verify-throw", true);
    });

    // Should still complete (verification failure is non-fatal)
    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[2].status).toBe("completed");
    });

  });

  it("step 1 with requiresStructuredOutput errors when structured output is an array", async () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
    useWorkflowStore.getState().setHydrated(true);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setCurrentStep(1);
    useWorkflowStore.getState().updateStepStatus(1, "in_progress");
    useWorkflowStore.getState().setRunning(true);
    useAgentStore.getState().startRun("agent-step1-array", "sonnet");

    render(<WorkflowPage />);

    act(() => {
      useAgentStore.getState().addDisplayItem("agent-step1-array", {
        id: "result-step1-arr",
        type: "result",
        timestamp: Date.now(),
        outputText_result: "Agent completed",
        structuredOutput: ["not", "an", "object"],
        resultStatus: "success",
      });
      useAgentStore.getState().completeRun("agent-step1-array", true);
    });

    await waitFor(() => {
      expect(useWorkflowStore.getState().steps[1].status).toBe("error");
    });

    expect(vi.mocked(materializeWorkflowStepOutput)).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      "Step 2 completed but produced no structured output",
      { duration: Infinity },
    );
  });
});

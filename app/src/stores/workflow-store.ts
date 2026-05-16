import { create } from "zustand";
import type { RuntimeError } from "@/components/runtime-error-dialog";
import { createWorkflowSession } from "@/lib/tauri";
import { WORKFLOW_STEP_DEFINITIONS } from "@/lib/workflow-steps";

export interface WorkflowStep {
  id: number;
  name: string;
  description: string;
  status: "pending" | "in_progress" | "waiting_for_user" | "completed" | "error";
}

interface WorkflowState {
  skillName: string | null;
  skillId: number | null;
  purpose: string | null;
  currentStep: number;
  steps: WorkflowStep[];
  isRunning: boolean;
  isStopping: boolean;
  /** When true, users can browse completed steps without triggering resets. */
  reviewMode: boolean;
  /** Active workflow session ID for usage tracking. Created when running starts, ended on navigate-away. */
  workflowSessionId: string | null;
  isInitializing: boolean;
  initStartTime: number | null;
  /** Granular progress message shown during initialization (e.g. "Loading runtime modules..."). */
  initProgressMessage: string | null;
  hydrated: boolean;
  /** Step IDs that are disabled due to scope recommendation (too broad). */
  disabledSteps: number[];

  /** Structured runtime error from a failed runtime startup (shown in RuntimeErrorDialog). */
  runtimeError: RuntimeError | null;

  /** Transient: true while the answer-evaluator gate agent is running (not persisted to SQLite). */
  gateLoading: boolean;
  activeConversationId: string | null;

  /** Transient: like pendingUpdateMode but suppresses auto-start. Used when navigating to an existing in-progress skill from the sidebar. */
  pendingNoReviewMode: boolean;

  initWorkflow: (skillName: string, skillId: number | null, purpose?: string, initialReviewMode?: boolean) => void;
  setReviewMode: (mode: boolean) => void;
  setCurrentStep: (step: number) => void;
  updateStepStatus: (stepId: number, status: WorkflowStep["status"]) => void;
  setRunning: (running: boolean) => void;
  setStopping: (stopping: boolean) => void;
  setInitializing: () => void;
  clearInitializing: () => void;
  setInitProgressMessage: (message: string) => void;
  setDisabledSteps: (steps: number[]) => void;
  resetToStep: (stepId: number) => void;
  /** Navigate back to a completed step without re-running it: keeps the target step
   *  as "completed" and resets only subsequent steps to "pending". */
  navigateBackToStep: (stepId: number) => void;
  loadWorkflowState: (completedStepIds: number[], savedCurrentStep?: number) => void;
  setHydrated: (hydrated: boolean) => void;
  /** Set a structured runtime error from a runtime startup failure. */
  setRuntimeError: (error: RuntimeError) => void;
  /** Clear the runtime error (e.g. after user dismisses the dialog). */
  clearRuntimeError: () => void;
  setGateLoading: (loading: boolean) => void;
  setActiveConversationId: (conversationId: string | null) => void;
  setPendingNoReviewMode: (mode: boolean) => void;
  updateStepLabel: (stepId: number, name: string, description: string) => void;
  reset: () => void;
}

const defaultSteps: WorkflowStep[] = WORKFLOW_STEP_DEFINITIONS.map((step) => ({
  ...step,
  status: "pending",
}));

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  skillName: null,
  skillId: null,
  purpose: null,
  currentStep: 0,
  steps: defaultSteps.map((s) => ({ ...s })),
  isRunning: false,
  isStopping: false,
  reviewMode: true,
  workflowSessionId: null,
  isInitializing: false,
  initStartTime: null,
  initProgressMessage: null,
  runtimeError: null,
  gateLoading: false,
  activeConversationId: null,
  pendingNoReviewMode: false,
  hydrated: false,
  disabledSteps: [],

  initWorkflow: (skillName, skillId, purpose, initialReviewMode) =>
    set({
      skillName,
      skillId,
      purpose: purpose ?? null,
      currentStep: 0,
      steps: defaultSteps.map((s) => ({ ...s })),
      isRunning: false,
      isStopping: false,
      reviewMode: initialReviewMode ?? true,
      workflowSessionId: null,
      isInitializing: false,
      initStartTime: null,
      initProgressMessage: null,
      runtimeError: null,
      gateLoading: false,
      activeConversationId: null,
      hydrated: false,
      disabledSteps: [],
    }),

  setReviewMode: (mode) => set({ reviewMode: mode }),

  setCurrentStep: (step) => set({ currentStep: step }),

  updateStepStatus: (stepId, status) =>
    set((state) => ({
      steps: state.steps.map((s) =>
        s.id === stepId ? { ...s, status } : s
      ),
    })),

  setRunning: (running) => {
    if (running && !get().workflowSessionId) {
      // Generate a session ID only once per workflow execution.
      // initWorkflow() and reset() clear it, so the next "Continue" from the
      // dashboard creates a fresh one.
      const sessionId = crypto.randomUUID();
      const skillName = get().skillName;
      const skillId = get().skillId;
      set({ isRunning: true, workflowSessionId: sessionId });
      // Fire-and-forget: persist session to SQLite
      if (skillName && skillId != null) {
        createWorkflowSession(sessionId, skillId).catch((e) => console.warn("[workflow-store] non-fatal: op=createWorkflowSession err=%s", e));
      }
    } else {
      set({ isRunning: running });
    }
  },

  setStopping: (stopping) => set({ isStopping: stopping }),

  setInitializing: () =>
    set({
      isInitializing: true,
      initStartTime: Date.now(),
      initProgressMessage: "Spawning agent process...",
    }),

  clearInitializing: () =>
    set({ isInitializing: false, initStartTime: null, initProgressMessage: null }),

  setInitProgressMessage: (message) => set({ initProgressMessage: message }),

  setDisabledSteps: (steps) => set({ disabledSteps: steps }),

  setRuntimeError: (error) => set({ runtimeError: error }),

  clearRuntimeError: () => set({ runtimeError: null }),

  setGateLoading: (loading) => set({ gateLoading: loading }),
  setActiveConversationId: (activeConversationId) => set({ activeConversationId }),
  setPendingNoReviewMode: (mode) => set({ pendingNoReviewMode: mode }),

  updateStepLabel: (stepId, name, description) =>
    set((state) => ({
      steps: state.steps.map((s) =>
        s.id === stepId ? { ...s, name, description } : s
      ),
    })),

  resetToStep: (stepId) =>
    set((state) => ({
      currentStep: stepId,
      isRunning: false,
      isStopping: false,
      isInitializing: false,
      initStartTime: null,
      initProgressMessage: null,
      activeConversationId: null,
      steps: state.steps.map((s) =>
        s.id >= stepId ? { ...s, status: "pending" as const } : s
      ),
      // Always clear disabled steps — guards are re-evaluated from disk after each step completes.
      // Stale guards from a previous run (e.g. contradictory_inputs from old decisions.md) must not
      // persist across resets.
      disabledSteps: [],
    })),

  navigateBackToStep: (stepId) =>
    set((state) => ({
      currentStep: stepId,
      isRunning: false,
      isStopping: false,
      isInitializing: false,
      initStartTime: null,
      initProgressMessage: null,
      activeConversationId: null,
      steps: state.steps.map((s) =>
        s.id > stepId ? { ...s, status: "pending" as const } : s
      ),
      disabledSteps: [],
    })),

  loadWorkflowState: (completedStepIds, savedCurrentStep) =>
    set((state) => {
      // Filter out step IDs that no longer exist in the workflow (e.g. the
      // legacy Package step or any higher IDs from old workflow data).
      const validStepIds = new Set(state.steps.map((s) => s.id));
      const filtered = completedStepIds.filter((id) => validStepIds.has(id));

      const steps = state.steps.map((s) =>
        filtered.includes(s.id) ? { ...s, status: "completed" as const } : s
      );

      // Use saved currentStep from SQLite if valid, otherwise fall back to
      // the first incomplete step.
      let currentStep: number;
      if (savedCurrentStep !== undefined && validStepIds.has(savedCurrentStep)) {
        currentStep = savedCurrentStep;
      } else {
        const firstIncomplete = steps.find((s) => s.status !== "completed");
        currentStep = firstIncomplete ? firstIncomplete.id : state.steps.length - 1;
      }

      return {
        steps,
        currentStep,
        hydrated: true,
      };
    }),

  setHydrated: (hydrated) => set({ hydrated }),

  reset: () =>
    set({
      skillName: null,
      skillId: null,
      purpose: null,
      currentStep: 0,
      steps: defaultSteps.map((s) => ({ ...s })),
      isRunning: false,
      isStopping: false,
      reviewMode: true,
      workflowSessionId: null,
      isInitializing: false,
      initStartTime: null,
      initProgressMessage: null,
      runtimeError: null,
      gateLoading: false,
      activeConversationId: null,
      hydrated: false,
      disabledSteps: [],
    }),
}));

// Expose store for E2E tests (browser-only, no-op in SSR/Node)
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__TEST_WORKFLOW_STORE__ =
    useWorkflowStore;
}

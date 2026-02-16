import { create } from "zustand";
import type { RuntimeError } from "@/components/runtime-error-dialog";
import { createWorkflowSession } from "@/lib/tauri";

export interface WorkflowStep {
  id: number;
  name: string;
  description: string;
  status: "pending" | "in_progress" | "waiting_for_user" | "completed" | "error";
}

interface WorkflowState {
  skillName: string | null;
  domain: string | null;
  skillType: string | null;
  currentStep: number;
  steps: WorkflowStep[];
  isRunning: boolean;
  /** Active workflow session ID for usage tracking. Created when running starts, ended on navigate-away. */
  workflowSessionId: string | null;
  isInitializing: boolean;
  initStartTime: number | null;
  /** Granular progress message shown during initialization (e.g. "Loading SDK modules..."). */
  initProgressMessage: string | null;
  hydrated: boolean;

  /** Structured runtime error from a failed sidecar startup (shown in RuntimeErrorDialog). */
  runtimeError: RuntimeError | null;

  initWorkflow: (skillName: string, domain: string, skillType?: string) => void;
  setSkillType: (skillType: string | null) => void;
  setCurrentStep: (step: number) => void;
  updateStepStatus: (stepId: number, status: WorkflowStep["status"]) => void;
  setRunning: (running: boolean) => void;
  setInitializing: () => void;
  clearInitializing: () => void;
  setInitProgressMessage: (message: string) => void;
  resetToStep: (stepId: number) => void;
  loadWorkflowState: (completedStepIds: number[], savedCurrentStep?: number) => void;
  setHydrated: (hydrated: boolean) => void;
  /** Set a structured runtime error from a sidecar startup failure. */
  setRuntimeError: (error: RuntimeError) => void;
  /** Clear the runtime error (e.g. after user dismisses the dialog). */
  clearRuntimeError: () => void;
  reset: () => void;
}

const defaultSteps: WorkflowStep[] = [
  {
    id: 0,
    name: "Research",
    description: "Research key concepts, terminology, and frameworks for the domain",
    status: "pending",
  },
  {
    id: 1,
    name: "Review",
    description: "Review and answer clarification questions about domain concepts",
    status: "pending",
  },
  {
    id: 2,
    name: "Detailed Research",
    description: "Research detailed patterns, implementation, and data modeling",
    status: "pending",
  },
  {
    id: 3,
    name: "Review",
    description: "Review and answer detailed clarification questions",
    status: "pending",
  },
  {
    id: 4,
    name: "Confirm Decisions",
    description: "Analyze responses for implications, gaps, and contradictions",
    status: "pending",
  },
  {
    id: 5,
    name: "Generate Skill",
    description: "Generate skill files from decisions",
    status: "pending",
  },
  {
    id: 6,
    name: "Validate Skill",
    description: "Validate skill and run test prompts against it",
    status: "pending",
  },
];

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  skillName: null,
  domain: null,
  skillType: null,
  currentStep: 0,
  steps: defaultSteps.map((s) => ({ ...s })),
  isRunning: false,
  workflowSessionId: null,
  isInitializing: false,
  initStartTime: null,
  initProgressMessage: null,
  runtimeError: null,
  hydrated: false,

  initWorkflow: (skillName, domain, skillType) =>
    set({
      skillName,
      domain,
      skillType: skillType ?? null,
      currentStep: 0,
      steps: defaultSteps.map((s) => ({ ...s })),
      isRunning: false,
      workflowSessionId: null,
      isInitializing: false,
      initStartTime: null,
      initProgressMessage: null,
      runtimeError: null,
      hydrated: false,
    }),

  setSkillType: (skillType) => set({ skillType }),

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
      set({ isRunning: true, workflowSessionId: sessionId });
      // Fire-and-forget: persist session to SQLite
      if (skillName) {
        createWorkflowSession(sessionId, skillName).catch(() => {});
      }
    } else {
      set({ isRunning: running });
    }
  },

  setInitializing: () =>
    set({
      isInitializing: true,
      initStartTime: Date.now(),
      initProgressMessage: "Spawning agent process...",
    }),

  clearInitializing: () =>
    set({ isInitializing: false, initStartTime: null, initProgressMessage: null }),

  setInitProgressMessage: (message) => set({ initProgressMessage: message }),

  setRuntimeError: (error) => set({ runtimeError: error }),

  clearRuntimeError: () => set({ runtimeError: null }),

  resetToStep: (stepId) =>
    set((state) => ({
      currentStep: stepId,
      isRunning: false,
      steps: state.steps.map((s) =>
        s.id >= stepId ? { ...s, status: "pending" as const } : s
      ),
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
      domain: null,
      skillType: null,
      currentStep: 0,
      steps: defaultSteps.map((s) => ({ ...s })),
      isRunning: false,
      workflowSessionId: null,
      isInitializing: false,
      initStartTime: null,
      initProgressMessage: null,
      runtimeError: null,
      hydrated: false,
    }),
}));

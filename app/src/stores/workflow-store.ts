import { create } from "zustand";

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
  isInitializing: boolean;
  initStartTime: number | null;
  /** Granular progress message shown during initialization (e.g. "Loading SDK modules..."). */
  initProgressMessage: string | null;
  hydrated: boolean;

  /** Whether the current step has timed out (agent took too long). */
  isTimedOut: boolean;
  /** Timestamp (ms) when the timeout was triggered, for elapsed-time display. */
  timeoutStartTime: number | null;

  initWorkflow: (skillName: string, domain: string, skillType?: string) => void;
  setSkillType: (skillType: string | null) => void;
  setCurrentStep: (step: number) => void;
  updateStepStatus: (stepId: number, status: WorkflowStep["status"]) => void;
  setRunning: (running: boolean) => void;
  setInitializing: () => void;
  clearInitializing: () => void;
  setInitProgressMessage: (message: string) => void;
  rerunFromStep: (stepId: number) => void;
  loadWorkflowState: (completedStepIds: number[]) => void;
  setHydrated: (hydrated: boolean) => void;
  /** Mark the current step as timed out and record the timestamp. */
  setTimedOut: () => void;
  /** Clear the timeout state (e.g. after retry or cancel). */
  clearTimeout: () => void;
  reset: () => void;
}

const defaultSteps: WorkflowStep[] = [
  {
    id: 0,
    name: "Research Concepts",
    description: "Research key concepts, terminology, and frameworks for the domain",
    status: "pending",
  },
  {
    id: 1,
    name: "Concepts Review",
    description: "Review and answer clarification questions about domain concepts",
    status: "pending",
  },
  {
    id: 2,
    name: "Perform Research",
    description: "Research business patterns, data modeling, and merge results",
    status: "pending",
  },
  {
    id: 3,
    name: "Human Review",
    description: "Review and answer merged clarification questions",
    status: "pending",
  },
  {
    id: 4,
    name: "Reasoning",
    description: "Analyze responses for implications, gaps, and contradictions",
    status: "pending",
  },
  {
    id: 5,
    name: "Build Skill",
    description: "Generate skill files from decisions",
    status: "pending",
  },
  {
    id: 6,
    name: "Validate",
    description: "Validate skill against best practices",
    status: "pending",
  },
  {
    id: 7,
    name: "Test",
    description: "Generate and evaluate test prompts",
    status: "pending",
  },
  {
    id: 8,
    name: "Refine",
    description: "Chat with an agent to review, iterate, and polish the skill output",
    status: "pending",
  },
];

export const useWorkflowStore = create<WorkflowState>((set) => ({
  skillName: null,
  domain: null,
  skillType: null,
  currentStep: 0,
  steps: defaultSteps.map((s) => ({ ...s })),
  isRunning: false,
  isInitializing: false,
  initStartTime: null,
  initProgressMessage: null,
  isTimedOut: false,
  timeoutStartTime: null,
  hydrated: false,

  initWorkflow: (skillName, domain, skillType) =>
    set({
      skillName,
      domain,
      skillType: skillType ?? null,
      currentStep: 0,
      steps: defaultSteps.map((s) => ({ ...s })),
      isRunning: false,
      isInitializing: false,
      initStartTime: null,
      initProgressMessage: null,
      isTimedOut: false,
      timeoutStartTime: null,
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

  setRunning: (running) => set({ isRunning: running }),

  setInitializing: () =>
    set({
      isInitializing: true,
      initStartTime: Date.now(),
      initProgressMessage: "Spawning agent process...",
    }),

  clearInitializing: () =>
    set({ isInitializing: false, initStartTime: null, initProgressMessage: null }),

  setInitProgressMessage: (message) => set({ initProgressMessage: message }),

  setTimedOut: () => set({ isTimedOut: true, timeoutStartTime: Date.now() }),

  clearTimeout: () => set({ isTimedOut: false, timeoutStartTime: null }),

  rerunFromStep: (stepId) =>
    set((state) => ({
      currentStep: stepId,
      isRunning: false,
      steps: state.steps.map((s) =>
        s.id >= stepId ? { ...s, status: "pending" as const } : s
      ),
    })),

  loadWorkflowState: (completedStepIds) =>
    set((state) => {
      // Filter out step IDs that no longer exist in the workflow (e.g. the
      // legacy Package step or any higher IDs from old workflow data).
      const validStepIds = new Set(state.steps.map((s) => s.id));
      const filtered = completedStepIds.filter((id) => validStepIds.has(id));

      const steps = state.steps.map((s) =>
        filtered.includes(s.id) ? { ...s, status: "completed" as const } : s
      );
      const firstIncomplete = steps.find((s) => s.status !== "completed");
      return {
        steps,
        currentStep: firstIncomplete ? firstIncomplete.id : state.steps.length - 1,
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
      isInitializing: false,
      initStartTime: null,
      initProgressMessage: null,
      isTimedOut: false,
      timeoutStartTime: null,
      hydrated: false,
    }),
}));

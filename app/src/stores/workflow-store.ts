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
  currentStep: number;
  steps: WorkflowStep[];
  isRunning: boolean;
  hydrated: boolean;

  initWorkflow: (skillName: string, domain: string) => void;
  setCurrentStep: (step: number) => void;
  updateStepStatus: (stepId: number, status: WorkflowStep["status"]) => void;
  setRunning: (running: boolean) => void;
  rerunFromStep: (stepId: number) => void;
  loadWorkflowState: (completedStepIds: number[]) => void;
  setHydrated: (hydrated: boolean) => void;
  reset: () => void;
}

const defaultSteps: WorkflowStep[] = [
  {
    id: 0,
    name: "Research Domain Concepts",
    description: "Research key concepts, terminology, and frameworks for the domain",
    status: "pending",

  },
  {
    id: 1,
    name: "Domain Concepts Review",
    description: "Review and answer clarification questions about domain concepts",
    status: "pending",
  },
  {
    id: 2,
    name: "Research Domain",
    description: "Research business patterns, data modeling, and merge clarification questions",
    status: "pending",
  },
  {
    id: 3,
    name: "Research Data Modeling",
    description: "Handled by step 2 orchestrator",
    status: "pending",
  },
  {
    id: 4,
    name: "Merge Clarifications",
    description: "Handled by step 2 orchestrator",
    status: "pending",
  },
  {
    id: 5,
    name: "Human Review",
    description: "Review and answer merged clarification questions",
    status: "pending",
  },
  {
    id: 6,
    name: "Reasoning",
    description: "Analyze responses for implications, gaps, and contradictions",
    status: "pending",

  },
  {
    id: 7,
    name: "Build Skill",
    description: "Generate skill files from decisions",
    status: "pending",

  },
  {
    id: 8,
    name: "Validate",
    description: "Validate skill against best practices",
    status: "pending",

  },
  {
    id: 9,
    name: "Test",
    description: "Generate and evaluate test prompts",
    status: "pending",

  },
  {
    id: 10,
    name: "Package",
    description: "Package skill into a deployable .skill file",
    status: "pending",
  },
];

export const useWorkflowStore = create<WorkflowState>((set) => ({
  skillName: null,
  domain: null,
  currentStep: 0,
  steps: defaultSteps.map((s) => ({ ...s })),
  isRunning: false,
  hydrated: false,

  initWorkflow: (skillName, domain) =>
    set({
      skillName,
      domain,
      currentStep: 0,
      steps: defaultSteps.map((s) => ({ ...s })),
      isRunning: false,
      hydrated: false,
    }),

  setCurrentStep: (step) => set({ currentStep: step }),

  updateStepStatus: (stepId, status) =>
    set((state) => ({
      steps: state.steps.map((s) =>
        s.id === stepId ? { ...s, status } : s
      ),
    })),

  setRunning: (running) => set({ isRunning: running }),

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
      const steps = state.steps.map((s) =>
        completedStepIds.includes(s.id) ? { ...s, status: "completed" as const } : s
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
      currentStep: 0,
      steps: defaultSteps.map((s) => ({ ...s })),
      isRunning: false,
      hydrated: false,
    }),
}));

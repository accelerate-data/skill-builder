import { create } from "zustand";

export interface WorkflowStep {
  id: number;
  name: string;
  description: string;
  status: "pending" | "in_progress" | "waiting_for_user" | "completed" | "error";
  agentModel?: string;
}

interface WorkflowState {
  skillName: string | null;
  domain: string | null;
  currentStep: number;
  steps: WorkflowStep[];
  isRunning: boolean;

  initWorkflow: (skillName: string, domain: string) => void;
  setCurrentStep: (step: number) => void;
  updateStepStatus: (stepId: number, status: WorkflowStep["status"]) => void;
  setRunning: (running: boolean) => void;
  reset: () => void;
}

const defaultSteps: WorkflowStep[] = [
  {
    id: 0,
    name: "Research Domain Concepts",
    description: "Research key concepts, terminology, and frameworks for the domain",
    status: "pending",
    agentModel: "sonnet",
  },
  {
    id: 1,
    name: "Domain Concepts Review",
    description: "Review and answer clarification questions about domain concepts",
    status: "pending",
  },
  {
    id: 2,
    name: "Research Patterns & Data Modeling",
    description: "Research business patterns and data modeling in parallel",
    status: "pending",
    agentModel: "sonnet",
  },
  {
    id: 3,
    name: "Merge Clarifications",
    description: "Deduplicate and merge clarification questions",
    status: "pending",
    agentModel: "haiku",
  },
  {
    id: 4,
    name: "Human Review",
    description: "Review and answer merged clarification questions",
    status: "pending",
  },
  {
    id: 5,
    name: "Reasoning",
    description: "Analyze responses for implications, gaps, and contradictions",
    status: "pending",
    agentModel: "opus",
  },
  {
    id: 6,
    name: "Build Skill",
    description: "Generate skill files from decisions",
    status: "pending",
    agentModel: "sonnet",
  },
  {
    id: 7,
    name: "Validate",
    description: "Validate skill against best practices",
    status: "pending",
    agentModel: "sonnet",
  },
  {
    id: 8,
    name: "Test",
    description: "Generate and evaluate test prompts",
    status: "pending",
    agentModel: "sonnet",
  },
  {
    id: 9,
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

  initWorkflow: (skillName, domain) =>
    set({
      skillName,
      domain,
      currentStep: 0,
      steps: defaultSteps.map((s) => ({ ...s })),
      isRunning: false,
    }),

  setCurrentStep: (step) => set({ currentStep: step }),

  updateStepStatus: (stepId, status) =>
    set((state) => ({
      steps: state.steps.map((s) =>
        s.id === stepId ? { ...s, status } : s
      ),
    })),

  setRunning: (running) => set({ isRunning: running }),

  reset: () =>
    set({
      skillName: null,
      domain: null,
      currentStep: 0,
      steps: defaultSteps.map((s) => ({ ...s })),
      isRunning: false,
    }),
}));

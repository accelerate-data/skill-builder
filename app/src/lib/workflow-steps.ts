export interface WorkflowStepDefinition {
  id: number;
  name: string;
  description: string;
}

export const WORKFLOW_STEP_DEFINITIONS: readonly WorkflowStepDefinition[] = [
  {
    id: 0,
    name: "Research",
    description: "Survey the domain — concepts, terminology, and frameworks",
  },
  {
    id: 1,
    name: "Detailed Research",
    description: "Dig into patterns, implementation details, and data modeling",
  },
  {
    id: 2,
    name: "Confirm Decisions",
    description: "Resolve gaps, contradictions, and implications from your answers",
  },
  {
    id: 3,
    name: "Generate Skill",
    description: "Produce skill files from confirmed decisions",
  },
];

const LEGACY_STEP_ID_ALIASES: Record<number, number> = {
  // Legacy workflow runs stored step 4/5 before the review-only steps were removed.
  4: 2,
  5: 3,
};

const SYNTHETIC_STEP_LABELS: Record<number, string> = {
  [-11]: "Test",
  [-10]: "Refine",
};

export function normalizeWorkflowStepId(stepId: number): number {
  return LEGACY_STEP_ID_ALIASES[stepId] ?? stepId;
}

export function getWorkflowStepLabel(stepId: number): string {
  const syntheticLabel = SYNTHETIC_STEP_LABELS[stepId];
  if (syntheticLabel) {
    return syntheticLabel;
  }

  const canonicalId = normalizeWorkflowStepId(stepId);
  const step = WORKFLOW_STEP_DEFINITIONS.find((entry) => entry.id === canonicalId);
  return step?.name ?? `Step ${stepId}`;
}

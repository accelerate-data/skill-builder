const BASE = "https://hbanerjee74.github.io/skill-builder";

const WORKFLOW_STEP_URLS: Record<number, string> = {
  0: `${BASE}/workflow/step-1-research`,
  1: `${BASE}/workflow/step-2-detailed-research`,
  2: `${BASE}/workflow/step-3-confirm-decisions`,
  3: `${BASE}/workflow/step-4-generate-skill`,
};

export function getWorkflowStepUrl(step: number): string {
  return WORKFLOW_STEP_URLS[step] ?? `${BASE}/workflow/overview`;
}

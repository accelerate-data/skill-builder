export interface StepConfig {
  type: "agent" | "reasoning";
  outputFiles?: string[];
  /** When true, show editable ClarificationsEditor on the completion screen */
  clarificationsEditable?: boolean;
}

export const STEP_CONFIGS: Record<number, StepConfig> = {
  0: {
    type: "agent",
    outputFiles: ["context/research-plan.md", "context/clarifications.json"],
    clarificationsEditable: true,
  },
  1: { type: "agent", outputFiles: ["context/clarifications.json", "context/refinements.json"], clarificationsEditable: true },
  2: { type: "reasoning", outputFiles: ["context/decisions.json"] },
  3: { type: "agent", outputFiles: ["skill/SKILL.md", "skill/references/"] },
};

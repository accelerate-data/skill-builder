/**
 * E2E tests for the post-review transition gate (answer evaluator).
 *
 * In the current 4-step workflow, step completion can trigger the answer-evaluator gate:
 * - Gate 1: after Research (step 0), before Detailed Research (step 1)
 * - Gate 2: after Detailed Research (step 1), before Confirm Decisions (step 2)
 */
import path from "node:path";
import { test, expect } from "@playwright/test";
import { simulateAgentRun, simulateAgentError } from "../helpers/agent-simulator";
import {
  WORKFLOW_OVERRIDES,
  navigateToWorkflowUpdateMode,
} from "../helpers/workflow-helpers";
import {
  E2E_SKILLS_PATH,
  E2E_WORKSPACE_PATH,
  skillContextPath,
} from "../helpers/test-paths";

const GATE_AGENT_ID = "gate-agent-001";
const WORKSPACE_PLUGIN_SLUG = "skills";

const RESEARCH_PLAN_CONTENT = `# Research Plan

## Domain
- Scope this skill around domain workflows.
`;

const WORKSPACE_EVAL_PATH = path.join(
  E2E_WORKSPACE_PATH,
  WORKSPACE_PLUGIN_SLUG,
  "skills",
  "test-skill",
  "answer-evaluation.json",
);
const SKILLS_RESEARCH_PLAN_PATH = skillContextPath(E2E_SKILLS_PATH, "test-skill", "research-plan.md");

// --- Override presets ---

/** Gate 1 context: step 0 completed, continue from Research summary. */
const GATE1_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 0, purpose: "domain" },
    steps: [{ step_id: 0, status: "completed" }],
  },
  read_file: {
    [SKILLS_RESEARCH_PLAN_PATH]: RESEARCH_PLAN_CONTENT,
    "*": RESEARCH_PLAN_CONTENT,
  },
  run_answer_evaluator: GATE_AGENT_ID,
};

/** Gate 2 context: step 1 completed, continue from Detailed Research. */
const GATE2_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 1, purpose: "domain" },
    steps: [
      { step_id: 0, status: "completed" },
      { step_id: 1, status: "completed" },
    ],
  },
  read_file: {
    "*": RESEARCH_PLAN_CONTENT,
  },
  run_answer_evaluator: GATE_AGENT_ID,
};

/** Swap read_file to return the evaluation JSON so finishGateEvaluation can parse it. */
function buildEvaluation(
  verdict: "sufficient" | "mixed" | "insufficient",
): Record<string, unknown> {
  const evaluations: Record<string, Record<string, unknown>> = {
    sufficient: {
      verdict: "sufficient",
      answered_count: 9,
      empty_count: 0,
      vague_count: 0,
      total_count: 9,
      reasoning: "All 9 questions have detailed answers.",
      per_question: [
        { question_id: "Q1", verdict: "clear" },
        { question_id: "Q2", verdict: "clear" },
        { question_id: "Q3", verdict: "clear" },
        { question_id: "Q4", verdict: "clear" },
        { question_id: "Q5", verdict: "clear" },
        { question_id: "Q6", verdict: "clear" },
        { question_id: "Q7", verdict: "clear" },
        { question_id: "Q8", verdict: "clear" },
        { question_id: "Q9", verdict: "clear" },
      ],
    },
    mixed: {
      verdict: "mixed",
      answered_count: 4,
      empty_count: 3,
      vague_count: 2,
      total_count: 9,
      reasoning: "4 of 9 answered; 3 blank and 2 vague.",
      per_question: [
        { question_id: "Q1", verdict: "clear" },
        { question_id: "Q2", verdict: "clear" },
        { question_id: "Q3", verdict: "clear" },
        { question_id: "Q4", verdict: "clear" },
        { question_id: "Q5", verdict: "vague" },
        { question_id: "Q6", verdict: "vague" },
        { question_id: "Q7", verdict: "not_answered" },
        { question_id: "Q8", verdict: "not_answered" },
        { question_id: "Q9", verdict: "not_answered" },
      ],
    },
    insufficient: {
      verdict: "insufficient",
      answered_count: 1,
      empty_count: 7,
      vague_count: 1,
      total_count: 9,
      reasoning: "Only 1 of 9 questions answered.",
      per_question: [
        { question_id: "Q1", verdict: "clear" },
        { question_id: "Q2", verdict: "not_answered" },
        { question_id: "Q3", verdict: "not_answered" },
        { question_id: "Q4", verdict: "not_answered" },
        { question_id: "Q5", verdict: "not_answered" },
        { question_id: "Q6", verdict: "not_answered" },
        { question_id: "Q7", verdict: "not_answered" },
        { question_id: "Q8", verdict: "vague" },
        { question_id: "Q9", verdict: "not_answered" },
      ],
    },
  };

  return evaluations[verdict];
}

async function setReadFileEvaluation(
  page: import("@playwright/test").Page,
  evaluation: Record<string, unknown>,
) {
  await page.evaluate(({ evalPath, json }) => {
    const overrides = (window as unknown as Record<string, unknown>)
      .__TAURI_MOCK_OVERRIDES__ as Record<string, unknown>;
    const current = overrides.read_file;
    const next =
      current && typeof current === "object" && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : { "*": String(current ?? "") };
    next[evalPath] = json;
    overrides.read_file = next;
  }, { evalPath: WORKSPACE_EVAL_PATH, json: JSON.stringify(evaluation) });
}

/** Click Complete Step on the review page, triggering the gate evaluation. */
async function clickCompleteStep(page: import("@playwright/test").Page) {
  const continueBtn = page.getByRole("button", { name: "Continue" }).first();
  await expect(continueBtn).toBeVisible({ timeout: 5_000 });
  await expect(continueBtn).toBeEnabled({ timeout: 5_000 });
  await continueBtn.click();
}

/** Simulate the gate agent completing (swap read_file before exit). */
async function simulateGateCompletion(
  page: import("@playwright/test").Page,
  verdict: "sufficient" | "mixed" | "insufficient",
) {
  // Swap read_file to evaluation JSON before the agent exits,
  // since finishGateEvaluation reads the file immediately after.
  await setReadFileEvaluation(page, buildEvaluation(verdict));

  await simulateAgentRun(page, {
    agentId: GATE_AGENT_ID,
    messages: ["Evaluating answers..."],
    result: "Evaluation complete.",
    delays: 50,
  });
}

async function simulateCustomGateCompletion(
  page: import("@playwright/test").Page,
  evaluation: Record<string, unknown>,
) {
  await setReadFileEvaluation(page, evaluation);

  await simulateAgentRun(page, {
    agentId: GATE_AGENT_ID,
    messages: ["Evaluating answers..."],
    result: "Evaluation complete.",
    delays: 50,
  });
}

async function waitForGateEvaluationStart(
  page: import("@playwright/test").Page,
  stepLabel: string,
) {
  await expect(page.getByText(stepLabel)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("dialog", { name: "Analyzing Responses" })).toBeVisible({
    timeout: 5_000,
  });
}

test.describe("Transition Gate", { tag: "@workflow" }, () => {
  test("gate 2 contradiction-driven revise: stays on detailed research", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, GATE2_OVERRIDES);
    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });

    await clickCompleteStep(page);
    await simulateCustomGateCompletion(page, {
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
    });

    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Step 3: Confirm Decisions")).not.toBeVisible();
  });

  test("gate 1 agent error: stays on research", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, GATE1_OVERRIDES);
    await expect(page.getByText("Step 1: Research")).toBeVisible({ timeout: 5_000 });

    await clickCompleteStep(page);
    await waitForGateEvaluationStart(page, "Step 1: Research");

    await simulateAgentError(page, GATE_AGENT_ID);

    await expect(page.getByText("Step 1: Research")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Step 2: Detailed Research")).not.toBeVisible();
  });

  test("gate 2 agent error: stays on detailed research", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, GATE2_OVERRIDES);
    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });

    await clickCompleteStep(page);
    await waitForGateEvaluationStart(page, "Step 2: Detailed Research");

    await simulateAgentError(page, GATE_AGENT_ID);

    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Step 3: Confirm Decisions")).not.toBeVisible();
  });

});

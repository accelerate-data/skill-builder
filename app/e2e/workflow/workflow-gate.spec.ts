/**
 * E2E tests for the post-review transition gate (answer evaluator).
 *
 * In the current 4-step workflow, step completion uses a clarifications
 * "Continue" action that can trigger the answer-evaluator gate:
 * - Gate 1: after Research (step 0), before Detailed Research (step 1)
 * - Gate 2: after Detailed Research (step 1), before Confirm Decisions (step 2)
 */
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  emitTauriEvent,
  simulateAgentRun,
} from "../helpers/agent-simulator";
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

const RESEARCH_PLAN_CONTENT = `# Research Plan

## Domain
- Scope this skill around domain workflows.
`;

const WORKSPACE_EVAL_PATH = `${E2E_WORKSPACE_PATH}/test-skill/answer-evaluation.json`;
const SKILLS_CLARIFICATIONS_PATH = skillContextPath(E2E_SKILLS_PATH, "test-skill", "clarifications.json");
const SKILLS_RESEARCH_PLAN_PATH = skillContextPath(E2E_SKILLS_PATH, "test-skill", "research-plan.md");

const CLARIFICATIONS_BASE = JSON.stringify({
  version: "1",
  metadata: {
    title: "Clarifications",
    question_count: 3,
    section_count: 1,
    refinement_count: 0,
    must_answer_count: 0,
    priority_questions: [],
  },
  sections: [
    {
      id: "S1",
      title: "General",
      questions: [
        {
          id: "Q1",
          title: "Question 1",
          must_answer: false,
          text: "What matters most?",
          choices: [],
          recommendation: null,
          answer_choice: "custom",
          answer_text: "Consistency and observability.",
          refinements: [],
        },
        {
          id: "Q2",
          title: "Question 2",
          must_answer: false,
          text: "How should this run?",
          choices: [],
          recommendation: null,
          answer_choice: "custom",
          answer_text: "Use default.",
          refinements: [],
        },
        {
          id: "Q3",
          title: "Question 3",
          must_answer: false,
          text: "What are the rollout constraints?",
          choices: [],
          recommendation: null,
          answer_choice: "custom",
          answer_text: "Avoid disruptive UX changes.",
          refinements: [],
        },
      ],
    },
  ],
  notes: [],
});

// --- Override presets ---

/** Gate 1 context: step 0 completed, continue from Research summary. */
const GATE1_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 0, purpose: "domain" },
    steps: [{ step_id: 0, status: "completed" }],
  },
  read_file: {
    [SKILLS_CLARIFICATIONS_PATH]: CLARIFICATIONS_BASE,
    [SKILLS_RESEARCH_PLAN_PATH]: RESEARCH_PLAN_CONTENT,
    "*": RESEARCH_PLAN_CONTENT,
  },
  run_answer_evaluator: GATE_AGENT_ID,
};

/** Gate 2 context: step 1 completed, continue from Detailed Research clarifications. */
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
    [SKILLS_CLARIFICATIONS_PATH]: CLARIFICATIONS_BASE,
    "*": RESEARCH_PLAN_CONTENT,
  },
  run_answer_evaluator: GATE_AGENT_ID,
};

/** Swap read_file to return the evaluation JSON so finishGateEvaluation can parse it. */
async function setReadFileToEvaluation(
  page: import("@playwright/test").Page,
  verdict: "sufficient" | "mixed" | "insufficient",
) {
  const evaluations: Record<string, unknown> = {
    sufficient: JSON.stringify({
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
    }),
    mixed: JSON.stringify({
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
    }),
    insufficient: JSON.stringify({
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
    }),
  };

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
  }, { evalPath: WORKSPACE_EVAL_PATH, json: evaluations[verdict] });
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
  await setReadFileToEvaluation(page, verdict);

  await simulateAgentRun(page, {
    agentId: GATE_AGENT_ID,
    messages: ["Evaluating answers..."],
    result: "Evaluation complete.",
    delays: 50,
  });
}

test.describe("Transition Gate", { tag: "@workflow" }, () => {
  test("gate 1 sufficient: skip dialog allows jumping to decisions", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, GATE1_OVERRIDES);
    await expect(page.getByText("Step 1: Research")).toBeVisible({ timeout: 5_000 });

    await clickCompleteStep(page);
    await simulateGateCompletion(page, "sufficient");

    // Dialog should appear with sufficient verdict
    await expect(
      page.getByRole("heading", { name: "Skip Detailed Research?" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Skip to Decisions" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run Research Anyway" })).toBeVisible();

    // Click Skip to Decisions
    await page.getByRole("button", { name: "Skip to Decisions" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Should advance to step 3 (Confirm Decisions)
    await expect(page.getByText("Step 3: Confirm Decisions")).toBeVisible({ timeout: 5_000 });
  });

  test("gate 1 sufficient: run research anyway keeps workflow on step 2", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, GATE1_OVERRIDES);
    await expect(page.getByText("Step 1: Research")).toBeVisible({ timeout: 5_000 });

    await clickCompleteStep(page);
    await simulateGateCompletion(page, "sufficient");

    // Dialog should appear with sufficient verdict
    await expect(
      page.getByRole("heading", { name: "Skip Detailed Research?" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Run Research Anyway" })).toBeVisible();

    // Click Run Research Anyway — should advance to step 2 instead of skipping to step 3
    await page.getByRole("button", { name: "Run Research Anyway" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });
  });

  test("gate 1 mixed: quality review dialog and continue anyway advances", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, GATE1_OVERRIDES);
    await expect(page.getByText("Step 1: Research")).toBeVisible({ timeout: 5_000 });

    await clickCompleteStep(page);
    await simulateGateCompletion(page, "mixed");

    // Gate 1 mixed with missing/vague answers uses generic quality-review dialog
    await expect(
      page.getByRole("heading", { name: "Review Answer Quality" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Continue Anyway" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Let Me Answer" })).toBeVisible();

    // Click Continue Anyway
    await page.getByRole("button", { name: "Continue Anyway" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Gate 1 continue advances to Detailed Research
    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });
  });

  test("gate 2 insufficient: continue anyway advances to decisions", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, GATE2_OVERRIDES);
    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });

    await clickCompleteStep(page);
    await simulateGateCompletion(page, "insufficient");

    await expect(
      page.getByRole("heading", { name: "Refinements Need Attention" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Continue Anyway" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Let Me Answer" })).toBeVisible();

    await page.getByRole("button", { name: "Continue Anyway" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    await expect(page.getByText("Step 3: Confirm Decisions")).toBeVisible({ timeout: 5_000 });
  });

  test("gate agent error fails open and advances normally", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, GATE1_OVERRIDES);
    await expect(page.getByText("Step 1: Research")).toBeVisible({ timeout: 5_000 });

    await clickCompleteStep(page);

    // Simulate agent that starts then exits with error
    await emitTauriEvent(page, "agent-init-progress", {
      agent_id: GATE_AGENT_ID,
      stage: "init_start",
      timestamp: Date.now(),
    });

    await emitTauriEvent(page, "agent-exit", {
      agent_id: GATE_AGENT_ID,
      success: false,
    });

    // Should fail-open: no dialog, advance to step 3
    await expect(page.getByRole("heading", { name: "Skip Detailed Research?" })).not.toBeVisible();
    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });
  });

});

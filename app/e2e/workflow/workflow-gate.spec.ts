/**
 * E2E tests for the post-review transition gate (answer evaluator).
 *
 * After completing step 2 (Review), the workflow dispatches a Haiku
 * evaluator agent. Based on the verdict, a dialog offers to skip
 * detailed research or auto-fill missing answers.
 */
import { test, expect } from "@playwright/test";
import {
  emitTauriEvent,
  simulateAgentRun,
} from "../helpers/agent-simulator";
import {
  WORKFLOW_OVERRIDES,
  navigateToWorkflowUpdateMode,
} from "../helpers/workflow-helpers";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const REVIEW_CONTENT = readFileSync(
  resolve(__dirname, "../fixtures/agent-responses/review-content.md"),
  "utf-8",
);

// --- Override presets ---

/** Step 0 completed, on human review step 1. run_answer_evaluator returns a gate agent ID. */
const GATE_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { domain: "Testing", current_step: 1, skill_type: "domain" },
    steps: [{ step_id: 0, status: "completed" }],
  },
  read_file: REVIEW_CONTENT,
  run_answer_evaluator: "gate-agent-001",
  autofill_clarifications: 3,
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

  await page.evaluate(
    ({ json }) => {
      const overrides = (window as unknown as Record<string, unknown>)
        .__TAURI_MOCK_OVERRIDES__ as Record<string, unknown>;
      overrides.read_file = json;
    },
    { json: evaluations[verdict] },
  );
}

/** Click Complete Step on the review page, triggering the gate evaluation. */
async function clickCompleteStep(page: import("@playwright/test").Page) {
  const completeBtn = page.getByRole("button", { name: "Complete Step" });
  await expect(completeBtn).toBeVisible({ timeout: 5_000 });
  await completeBtn.click();
  await page.waitForTimeout(200);
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
    agentId: "gate-agent-001",
    messages: ["Evaluating answers..."],
    result: "Evaluation complete.",
    delays: 50,
  });

  // Wait for the gate completion chain to process
  await page.waitForTimeout(500);
}

test.describe("Transition Gate", { tag: "@workflow" }, () => {
  test("sufficient verdict shows skip dialog, skip advances to step 5", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, GATE_OVERRIDES);
    await expect(page.getByText("Step 2: Review")).toBeVisible({ timeout: 5_000 });

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
    await page.waitForTimeout(500);

    // Should advance to step 5 (Confirm Decisions)
    await expect(page.getByText("Step 5: Confirm Decisions")).toBeVisible({ timeout: 5_000 });
  });

  test("sufficient verdict research button advances to step 3", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, GATE_OVERRIDES);
    await expect(page.getByText("Step 2: Review")).toBeVisible({ timeout: 5_000 });

    await clickCompleteStep(page);
    await simulateGateCompletion(page, "sufficient");

    await expect(
      page.getByRole("heading", { name: "Skip Detailed Research?" }),
    ).toBeVisible({ timeout: 5_000 });

    // Click Run Research Anyway
    await page.getByRole("button", { name: "Run Research Anyway" }).click();
    await page.waitForTimeout(500);

    // Should advance to step 3 (Detailed Research) normally
    await expect(page.getByText("Step 3: Detailed Research")).toBeVisible({ timeout: 5_000 });
  });

  test("mixed verdict shows auto-fill dialog, auto-fill advances to step 3", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, GATE_OVERRIDES);
    await expect(page.getByText("Step 2: Review")).toBeVisible({ timeout: 5_000 });

    await clickCompleteStep(page);
    await simulateGateCompletion(page, "mixed");

    // Dialog should appear with mixed verdict
    await expect(
      page.getByRole("heading", { name: "Auto-fill Missing Answers?" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Auto-fill & Research" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Let Me Answer" })).toBeVisible();

    // Click Auto-fill & Research
    await page.getByRole("button", { name: "Auto-fill & Research" }).click();
    await page.waitForTimeout(500);

    // Should advance to step 3 (Detailed Research)
    await expect(page.getByText("Step 3: Detailed Research")).toBeVisible({ timeout: 5_000 });
  });

  test("mixed verdict let-me-answer button stays on review step", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, GATE_OVERRIDES);
    await expect(page.getByText("Step 2: Review")).toBeVisible({ timeout: 5_000 });

    await clickCompleteStep(page);
    await simulateGateCompletion(page, "mixed");

    await expect(
      page.getByRole("heading", { name: "Auto-fill Missing Answers?" }),
    ).toBeVisible({ timeout: 5_000 });

    // Click Let Me Answer
    await page.getByRole("button", { name: "Let Me Answer" }).click();
    await page.waitForTimeout(500);

    // Should stay on step 2 (Review) — dialog closes, user answers manually
    await expect(page.getByText("Step 2: Review")).toBeVisible({ timeout: 5_000 });
  });

  test("insufficient verdict shows autofill dialog, auto-fill advances to step 5", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, GATE_OVERRIDES);
    await expect(page.getByText("Step 2: Review")).toBeVisible({ timeout: 5_000 });

    await clickCompleteStep(page);
    await simulateGateCompletion(page, "insufficient");

    // Dialog should appear with insufficient verdict
    await expect(
      page.getByRole("heading", { name: "Use Recommended Answers?" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Auto-fill & Skip" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Let Me Answer" })).toBeVisible();

    // Click Auto-fill & Skip
    await page.getByRole("button", { name: "Auto-fill & Skip" }).click();
    await page.waitForTimeout(500);

    // Should advance to step 5 (Confirm Decisions)
    await expect(page.getByText("Step 5: Confirm Decisions")).toBeVisible({ timeout: 5_000 });
  });

  test("insufficient verdict let-me-answer button stays on review step", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, GATE_OVERRIDES);
    await expect(page.getByText("Step 2: Review")).toBeVisible({ timeout: 5_000 });

    await clickCompleteStep(page);
    await simulateGateCompletion(page, "insufficient");

    await expect(
      page.getByRole("heading", { name: "Use Recommended Answers?" }),
    ).toBeVisible({ timeout: 5_000 });

    // Click Let Me Answer
    await page.getByRole("button", { name: "Let Me Answer" }).click();
    await page.waitForTimeout(500);

    // Should stay on step 2 (Review) — dialog closes, user answers manually
    await expect(page.getByText("Step 2: Review")).toBeVisible({ timeout: 5_000 });
  });

  test("gate agent error fails open and advances to step 3", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, GATE_OVERRIDES);
    await expect(page.getByText("Step 2: Review")).toBeVisible({ timeout: 5_000 });

    await clickCompleteStep(page);

    // Simulate agent that starts then exits with error
    await emitTauriEvent(page, "agent-init-progress", {
      agent_id: "gate-agent-001",
      subtype: "init_start",
      timestamp: Date.now(),
    });
    await page.waitForTimeout(50);

    await emitTauriEvent(page, "agent-exit", {
      agent_id: "gate-agent-001",
      success: false,
    });
    await page.waitForTimeout(500);

    // Should fail-open: no dialog, advance to step 3
    await expect(
      page.getByRole("heading", { name: "Skip Detailed Research?" }),
    ).not.toBeVisible();
    await expect(page.getByText("Step 3: Detailed Research")).toBeVisible({ timeout: 5_000 });
  });
});

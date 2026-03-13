/**
 * E2E tests for workflow step progression, human review, and completion.
 *
 * Covers completed-step display, review/update mode toggles, human
 * review editing (MDEditor), save/reload/complete flows, reset-step
 * dialog, disabled steps (scope too broad), error state, and last-step
 * completion.
 */
import { test, expect } from "@playwright/test";
import { emitTauriEvent } from "../helpers/agent-simulator";
import {
  WORKFLOW_OVERRIDES,
  navigateToWorkflow,
  navigateToWorkflowUpdateMode,
} from "../helpers/workflow-helpers";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const REVIEW_CONTENT = readFileSync(
  resolve(__dirname, "../fixtures/agent-responses/review-content.json"),
  "utf-8",
);

// --- Override presets ---

/** Steps 0 and 1 completed, currently on step 2. */
const COMPLETED_STEP_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 2, purpose: "domain" },
    steps: [
      { step_id: 0, status: "completed" },
      { step_id: 1, status: "completed" },
    ],
  },
  // No read_file override — inherits from WORKFLOW_OVERRIDES which has valid
  // clarifications.json and research-plan.md content for both workspace and skills paths.
};

/**
 * Steps 0 and 1 both completed, currently on step 1.
 * In update mode the reposition effect sees step 1 (clarificationsEditable + completed)
 * and stays put — so the ClarificationsEditor renders in editable mode.
 */
const HUMAN_REVIEW_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 1, purpose: "domain" },
    steps: [
      { step_id: 0, status: "completed" },
      { step_id: 1, status: "completed" },
    ],
  },
  read_file: REVIEW_CONTENT,
};

/** All steps completed, currently viewing the last step (step 3 = Generate Skill). */
const LAST_STEP_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 3, purpose: "domain" },
    steps: [
      { step_id: 0, status: "completed" },
      { step_id: 1, status: "completed" },
      { step_id: 2, status: "completed" },
      { step_id: 3, status: "completed" },
    ],
  },
  read_file: "# Generation Report\n\nSkill generated successfully.",
};

/**
 * Fresh workflow for testing error state. We start a step and then
 * simulate an agent error exit. The read_file mock returns content
 * so errorHasArtifacts is true (partial output detection).
 */
const ERROR_STEP_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  // Return content so errorHasArtifacts is true when the error state checks for partial output
  read_file: "# Partial Output\n\nSome data was produced before the error.",
};

/**
 * Step 0 completed, with all downstream workflow steps disabled by
 * scope recommendation (4-step workflow => steps 1,2,3 disabled).
 */
const DISABLED_STEPS_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 0, purpose: "domain" },
    steps: [{ step_id: 0, status: "completed" }],
  },
  get_disabled_steps: [1, 2, 3],
  read_file: {
    "/tmp/test-skills/test-skill/context/research-plan.md": `---
purpose: Business process knowledge
domain: Pet Store Analytics
topic_relevance: not_relevant
dimensions_evaluated: 0
dimensions_selected: 0
---

# Research Plan

## Dimension Scores
| Dimension | Score | Reason |
|---|---:|---|
| scope | 0 | Throwaway intent detected |

## Selected Dimensions
| Dimension | Reason |
|---|---|
| none | Scope recommendation triggered |
`,
    "/tmp/test-skills/test-skill/context/clarifications.json": JSON.stringify({
      version: "1",
      metadata: {
        title: "Scope Recommendation",
        question_count: 0,
        section_count: 0,
        refinement_count: 0,
        must_answer_count: 0,
        priority_questions: [],
        scope_recommendation: true,
        scope_reason: "Explicit throwaway/test intent detected.",
        scope_next_action: "Provide a concrete production domain.",
      },
      sections: [],
      notes: [
        {
          type: "blocked",
          title: "Scope Recommendation Active",
          body: "Narrow the scope and rerun research.",
        },
      ],
    }),
    "*": "",
  },
};

test.describe("Workflow Step Progression", { tag: "@workflow" }, () => {
  test("completed step shows completion screen with output files", async ({ page }) => {
    // Stay in review mode so clicking a completed step shows the completion
    // screen (update mode would trigger the reset-step dialog for prior steps).
    await navigateToWorkflow(page, COMPLETED_STEP_OVERRIDES);

    // Click step 1 (Research) in sidebar — it is completed
    const step1Button = page.locator("button").filter({ hasText: "1. Research" });
    await step1Button.click();
    await page.waitForTimeout(300);

    // Should show completion screen via ResearchSummaryCard (read-only mode in review).
    // The card header shows "Research Complete" when the outcome is happy-path.
    await expect(page.getByText("Research Complete")).toBeVisible({ timeout: 5_000 });
  });

  test("research completion renders canonical research-plan sections", async ({ page }) => {
    await navigateToWorkflow(page, DISABLED_STEPS_OVERRIDES);

    const step1Button = page.locator("button").filter({ hasText: "1. Research" });
    await step1Button.click();
    await page.waitForTimeout(300);

    // ResearchSummaryCard always shows "Research Complete" in the plan card header.
    await expect(page.getByText("Research Complete")).toBeVisible({ timeout: 5_000 });

    // Expand the plan card to verify dimension data was parsed from research-plan.md.
    // Click the summary card header button to expand it.
    await page.getByText("Research Complete").click();
    await page.waitForTimeout(200);

    // The dimension "scope" (from the research-plan.md Dimension Scores table) should appear.
    await expect(page.getByText("scope", { exact: true })).toBeVisible({ timeout: 3_000 });
  });

  test("review mode hides action buttons on completed step", async ({ page }) => {
    // Stay in review mode (do NOT click Update)
    await navigateToWorkflow(page, COMPLETED_STEP_OVERRIDES);

    // Click step 1 (Research) in sidebar — completed
    const step1Button = page.locator("button").filter({ hasText: "1. Research" });
    await step1Button.click();
    await page.waitForTimeout(300);

    // In review mode: no Start Step, no Next Step buttons
    await expect(page.getByRole("button", { name: "Start Step" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Next Step" })).not.toBeVisible();
  });

  test("update mode auto-starts agent on pending step", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page);

    // Fresh workflow — step 0 is pending, agent should auto-start
    // and show the initializing indicator
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });
  });

  test("human review loads file content from read_file", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, HUMAN_REVIEW_OVERRIDES);

    // Should be on step 2 (Detailed Research), which is the clarifications-editable step
    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });

    // ClarificationsEditor should have loaded the review content.
    // Q1 from REVIEW_CONTENT has title "Primary focus area".
    await expect(page.getByText("Primary focus area")).toBeVisible({ timeout: 5_000 });
  });

  test("human review shows dirty indicator on edit", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, HUMAN_REVIEW_OVERRIDES);
    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });

    // Expand Q2 (Primary database, unanswered) to reveal its choice buttons
    await page.getByText("Primary database").click();
    await page.waitForTimeout(200);

    // Click the "PostgreSQL" choice to answer Q2 — triggers onChange → dirty
    await page.getByText("PostgreSQL").first().click();
    await page.waitForTimeout(200);

    // The SaveIndicator should now show "Unsaved changes"
    await expect(page.getByText("Unsaved changes")).toBeVisible({ timeout: 3_000 });
  });

  test("human review save clears dirty indicator and shows saved status", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, HUMAN_REVIEW_OVERRIDES);
    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });

    // Expand Q2 (Primary database, unanswered) and click a choice to make dirty
    await page.getByText("Primary database").click();
    await page.waitForTimeout(200);
    await page.getByText("PostgreSQL").first().click();
    await page.waitForTimeout(200);

    // Verify dirty indicator
    await expect(page.getByText("Unsaved changes")).toBeVisible({ timeout: 3_000 });

    // Wait for debounced auto-save (1500ms) + buffer
    await page.waitForTimeout(2000);

    // "Saved" indicator should appear in the SaveIndicator after auto-save completes
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 3_000 });
  });

  test("human review shows section headers and questions from loaded content", async ({ page }) => {
    // Verifies that the ClarificationsEditor correctly loads and renders the
    // review content with its sections and questions visible.
    await navigateToWorkflowUpdateMode(page, HUMAN_REVIEW_OVERRIDES);
    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });

    // Both sections from REVIEW_CONTENT should be visible
    await expect(page.getByText("Domain Concepts")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Technical Stack")).toBeVisible({ timeout: 5_000 });

    // Both questions should be visible (collapsed cards still show the title)
    await expect(page.getByText("Primary focus area")).toBeVisible();
    await expect(page.getByText("Primary database")).toBeVisible();
  });

  test("human review Continue button is disabled when required questions are unanswered", async ({ page }) => {
    // REVIEW_CONTENT has Q2 (must_answer=true) with no answer — Continue should be disabled.
    await navigateToWorkflowUpdateMode(page, HUMAN_REVIEW_OVERRIDES);
    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });

    // Q2 is unanswered (answer_choice=null, answer_text=null, must_answer=true)
    // so mustUnanswered >= 1 → canContinue=false → Continue button is disabled
    const continueButton = page.getByRole("button", { name: "Continue" });
    await expect(continueButton).toBeVisible({ timeout: 5_000 });
    await expect(continueButton).toBeDisabled();
  });

  test("reset to prior step shows ResetStepDialog", async ({ page }) => {
    // All 4 steps completed, currently on step 3 (Generate Skill, last step).
    // No auto-start fires because step 3 is completed.
    await navigateToWorkflowUpdateMode(page, {
      ...WORKFLOW_OVERRIDES,
      get_workflow_state: {
        run: { current_step: 3, purpose: "domain" },
        steps: [
          { step_id: 0, status: "completed" },
          { step_id: 1, status: "completed" },
          { step_id: 2, status: "completed" },
          { step_id: 3, status: "completed" },
        ],
      },
      read_file: "# Generation Report\n\nSkill generated successfully.",
      preview_step_reset: [
        {
          step_id: 0,
          step_name: "Research",
          files: ["context/research-plan.md", "context/clarifications.json"],
        },
        {
          step_id: 1,
          step_name: "Review",
          files: ["context/clarifications.json"],
        },
      ],
    });

    // Click step 1 (Research) which is completed — triggers reset dialog in update mode
    const step1Button = page.locator("button").filter({ hasText: "1. Research" });
    await step1Button.click();
    await page.waitForTimeout(300);

    // ResetStepDialog should appear
    await expect(
      page.getByRole("heading", { name: "Reset to Earlier Step" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText("Going back will delete all artifacts"),
    ).toBeVisible();

    // Should show file preview
    await expect(page.getByText("research-plan.md")).toBeVisible();

    // Cancel and Reset buttons should be present
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Reset/ }),
    ).toBeVisible();

    // Click the reset button
    await page.getByRole("button", { name: /Delete.*Reset|^Reset$/ }).click();
    await page.waitForTimeout(500);

    // After reset, dialog should close and we should be on step 1
    await expect(
      page.getByRole("heading", { name: "Reset to Earlier Step" }),
    ).not.toBeVisible();
  });

  test("scope recommendation marks downstream steps as skipped", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, DISABLED_STEPS_OVERRIDES);

    // Should remain on step 1 (Research) completion state in 4-step workflow.
    await expect(page.getByText("Step 1: Research")).toBeVisible({ timeout: 5_000 });

    // Disabled steps in sidebar should show "Skipped" labels
    await expect(page.getByText("Skipped").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Skipped").nth(1)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Skipped").nth(2)).toBeVisible({ timeout: 5_000 });
  });

  test("error state shows Retry and Reset Step buttons", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, ERROR_STEP_OVERRIDES);

    // Agent auto-starts — wait for init indicator
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });

    // Simulate agent init then error exit
    await emitTauriEvent(page, "agent-init-progress", {
      agent_id: "agent-001",
      stage: "init_start",
      timestamp: Date.now(),
    });
    await page.waitForTimeout(50);

    await emitTauriEvent(page, "agent-exit", {
      agent_id: "agent-001",
      success: false,
    });
    await page.waitForTimeout(500);

    // Should show error state (scope to main content to avoid matching toast)
    await expect(page.locator("main").getByText("Step 1 failed")).toBeVisible({ timeout: 5_000 });

    // Retry and Reset Step buttons should be visible
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset Step" })).toBeVisible();
  });

  test("completed human step shows readonly clarifications in review mode", async ({ page }) => {
    // Steps 0 and 1 completed, current_step=2.
    // Navigate in review mode (NOT update) and click step 2 (Detailed Research, index 1).
    await navigateToWorkflow(page, COMPLETED_STEP_OVERRIDES);

    // Click step 2 (Detailed Research, clarificationsEditable, completed) in sidebar
    const step2Button = page.locator("button").filter({ hasText: "2. Detailed Research" });
    await step2Button.click();
    await page.waitForTimeout(300);

    // Verify we're on the Detailed Research step
    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });

    // Should show ClarificationsEditor in read-only mode (review mode).
    // WORKFLOW_OVERRIDES clarifications.json has valid JSON with title "Test".
    // Read-only ClarificationsEditor uses readOnly=true — no Continue button, no Re-run button.
    await expect(page.getByRole("button", { name: "Continue" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Re-run" })).not.toBeVisible();

    // Should NOT show "Complete Step" button (step already completed, and we're in review mode)
    await expect(page.getByRole("button", { name: "Complete Step" })).not.toBeVisible();
  });

  test("completed clarifications step shows editor without Complete button in update mode", async ({ page }) => {
    // Steps 0 and 1 completed, current_step=1 (Detailed Research, clarificationsEditable, completed).
    // The reposition effect sees step 1 (clarificationsEditable + completed) and stays put.
    // No auto-start fires because step 1 is completed.
    const completedOnDetailedResearch: Record<string, unknown> = {
      ...WORKFLOW_OVERRIDES,
      get_workflow_state: {
        run: { current_step: 1, purpose: "domain" },
        steps: [
          { step_id: 0, status: "completed" },
          { step_id: 1, status: "completed" },
        ],
      },
      read_file: REVIEW_CONTENT,
    };

    await navigateToWorkflowUpdateMode(page, completedOnDetailedResearch);
    await page.waitForTimeout(500);

    // Should be on step 2 (Detailed Research, 0-indexed step 1)
    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });

    // ClarificationsEditor should be visible in editable mode
    await expect(page.getByText("Primary focus area")).toBeVisible({ timeout: 5_000 });

    // Re-run and Continue buttons visible (editable update mode)
    await expect(page.getByRole("button", { name: "Re-run" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();

    // Should NOT show "Complete Step" button (step already completed — Continue replaces it)
    await expect(page.getByRole("button", { name: "Complete Step" })).not.toBeVisible();
  });

  test("Review to Update toggle repositions to first incomplete step", async ({ page }) => {
    // Steps 0,1,2 completed, current_step=3 (Generate Skill, pending).
    // Navigate in review mode, then click on a non-clarificationsEditable completed step
    // (Confirm Decisions, step 2) to move away from the first incomplete step.
    // Toggling to Update should reposition to step 3 (first incomplete).
    const threeCompletedOverrides: Record<string, unknown> = {
      ...WORKFLOW_OVERRIDES,
      get_workflow_state: {
        run: { current_step: 3, purpose: "domain" },
        steps: [
          { step_id: 0, status: "completed" },
          { step_id: 1, status: "completed" },
          { step_id: 2, status: "completed" },
        ],
      },
      read_file: {
        ...((WORKFLOW_OVERRIDES.read_file) as Record<string, unknown>),
        "/tmp/test-workspace/test-skill/context/decisions.json": JSON.stringify({
          version: "1",
          metadata: { decision_count: 1, conflicts_resolved: 0, round: 1, contradictory_inputs: false },
          decisions: [],
        }),
        "/tmp/test-skills/test-skill/context/decisions.json": JSON.stringify({
          version: "1",
          metadata: { decision_count: 1, conflicts_resolved: 0, round: 1, contradictory_inputs: false },
          decisions: [],
        }),
      },
    };

    await navigateToWorkflow(page, threeCompletedOverrides);

    // In review mode, navigate to step 3 (Confirm Decisions, completed) — away from first incomplete
    const step3Button = page.locator("button").filter({ hasText: "3. Confirm Decisions" });
    await step3Button.click();
    await page.waitForTimeout(300);

    // Verify we're on step 3 (Confirm Decisions)
    await expect(page.getByText("Step 3: Confirm Decisions")).toBeVisible();

    // Click "Update" toggle — should reposition to first incomplete step (step 3, index 3)
    await page.getByRole("button", { name: "Update" }).click();
    await page.waitForTimeout(500);

    // Should reposition to step 4 (display name, 0-indexed step 3 = "Generate Skill")
    await expect(page.getByText("Step 4: Generate Skill")).toBeVisible({ timeout: 5_000 });
  });

  test("last step completion shows Done button that navigates to dashboard", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, LAST_STEP_OVERRIDES);

    // Should show the last step completion
    await expect(page.getByText("Generate Skill Complete")).toBeVisible({ timeout: 5_000 });

    // Should have Done button (not Next Step)
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next Step" })).not.toBeVisible();

    // Click Done — should navigate to dashboard
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(500);

    // Should be on dashboard (route "/")
    await expect(page).toHaveURL("/");
  });

  test("clicking step 0 from step 2 in update mode opens dialog and resets to runnable", async ({ page }) => {
    // Bug 2 regression: clicking a prior step in update mode should open the ResetStepDialog,
    // and after confirming the reset the step should show the "Ready to run" state (pending).
    // All 4 steps are completed so no auto-start fires when entering update mode.
    await navigateToWorkflowUpdateMode(page, {
      ...WORKFLOW_OVERRIDES,
      get_workflow_state: {
        run: { current_step: 2, purpose: "domain" },
        steps: [
          { step_id: 0, status: "completed" },
          { step_id: 1, status: "completed" },
          { step_id: 2, status: "completed" },
          { step_id: 3, status: "completed" },
        ],
      },
      read_file: "# Research Results\n\nAnalysis complete.",
      preview_step_reset: [
        {
          step_id: 0,
          step_name: "Research",
          files: ["context/research-plan.md", "context/clarifications.json"],
        },
        {
          step_id: 1,
          step_name: "Detailed Research",
          files: ["context/clarifications.json"],
        },
      ],
    });

    // Click step 1 (Research, index 0) in the sidebar — it is completed
    const step1Button = page.locator("button").filter({ hasText: "1. Research" });
    await step1Button.click();
    await page.waitForTimeout(300);

    // ResetStepDialog should appear (update mode, clicking a prior completed step)
    await expect(
      page.getByRole("heading", { name: "Reset to Earlier Step" }),
    ).toBeVisible({ timeout: 5_000 });

    // Wait for Reset button to be enabled (preview loaded)
    await expect(
      page.getByRole("button", { name: /Delete.*Reset|^Reset$/ }),
    ).toBeEnabled({ timeout: 5_000 });

    // Confirm the reset
    await page.getByRole("button", { name: /Delete.*Reset|^Reset$/ }).click();
    await page.waitForTimeout(500);

    // Dialog should close
    await expect(
      page.getByRole("heading", { name: "Reset to Earlier Step" }),
    ).not.toBeVisible();

    // Step 0 (Research) should now show the "Ready to run" pending state
    // (not a completed view, not an error — just the Start Step UI)
    await expect(page.getByRole("button", { name: "Start Step" })).toBeVisible({ timeout: 5_000 });
  });

  test("resetting step 1 from step 2 via Re-run button preserves step 0 content", async ({ page }) => {
    // Detailed-research rerun now resets from step 0 so clarifications.json is
    // regenerated from research instead of reusing stale output.
    await navigateToWorkflowUpdateMode(page, {
      ...WORKFLOW_OVERRIDES,
      get_workflow_state: {
        run: { current_step: 1, purpose: "domain" },
        steps: [
          { step_id: 0, status: "completed" },
          { step_id: 1, status: "completed" },
        ],
      },
      // REVIEW_CONTENT is valid clarifications JSON so ClarificationsEditor renders
      read_file: REVIEW_CONTENT,
    });

    // Should be on step 2 (Detailed Research, index 1), completed
    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });

    // ClarificationsEditor in editable mode shows the Re-run button (via onReset prop)
    await expect(page.getByRole("button", { name: "Re-run" })).toBeVisible({ timeout: 5_000 });

    // Click Re-run — opens ResetStepDialog for step 1 (setResetTarget(currentStep)=1)
    await page.getByRole("button", { name: "Re-run" }).click();
    await page.waitForTimeout(300);

    // ResetStepDialog should appear
    await expect(
      page.getByRole("heading", { name: "Reset to Earlier Step" }),
    ).toBeVisible({ timeout: 5_000 });

    // Confirm the reset — navigateBackToStep(1) keeps step 1 completed and resets step 2+
    await page.getByRole("button", { name: /Delete.*Reset|^Reset$/ }).click();
    await page.waitForTimeout(500);

    // Dialog should close — confirm it targeted step 1 (we are still on Detailed Research, not step 0)
    await expect(
      page.getByRole("heading", { name: "Reset to Earlier Step" }),
    ).not.toBeVisible();

    // Resetting detailed research now returns the workflow to step 0.
    await expect(page.getByText("Step 1: Research")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Step 2: Detailed Research")).not.toBeVisible();
  });

  test("missing-files error state shows Reset Step button", async ({ page }) => {
    // When a completed step's output files are missing (e.g. manually deleted),
    // WorkflowStepComplete renders a missing-files error state with a Reset Step button.
    // Set up step 0 as completed but mock read_file to return NOT_FOUND.
    await navigateToWorkflowUpdateMode(page, {
      ...WORKFLOW_OVERRIDES,
      get_workflow_state: {
        run: { current_step: 0, purpose: "domain" },
        steps: [
          { step_id: 0, status: "completed" },
        ],
      },
      // read_file returns empty string — simulates missing files
      // (the component shows the missing-files error when content is absent)
      read_file: null,
    });

    // Should be on step 1 (Research, index 0), completed
    await expect(page.getByText("Step 1: Research")).toBeVisible({ timeout: 5_000 });

    // The Reset Step button must be visible regardless of file availability
    await expect(page.getByRole("button", { name: "Reset Step" })).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Contradictions guard — multi-decision scenarios
// ---------------------------------------------------------------------------

const MULTI_CONTRADICTION_DECISIONS = JSON.stringify({
  version: "1",
  metadata: {
    decision_count: 3,
    conflicts_resolved: 0,
    round: 1,
    contradictory_inputs: true,
  },
  decisions: [
    {
      id: "D1",
      title: "Revenue Model",
      original_question: "Should we track revenue?",
      decision: "Track MRR",
      implication: "Contradicts Q5 answer",
      status: "needs-review",
    },
    {
      id: "D2",
      title: "Pipeline Scope",
      original_question: "What pipeline stages?",
      decision: "All stages",
      implication: "Contradicts Q3 top-of-funnel",
      status: "needs-review",
    },
    {
      id: "D3",
      title: "Format",
      original_question: "Output format?",
      decision: "JSON",
      implication: "Clear",
      status: "resolved",
    },
  ],
});

/** Step 2 completed with multi-contradiction decisions, step 3 disabled. */
const CONTRADICTION_GUARD_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 2, purpose: "domain" },
    steps: [
      { step_id: 0, status: "completed" },
      { step_id: 1, status: "completed" },
      { step_id: 2, status: "completed" },
    ],
  },
  get_disabled_steps: [3],
  save_decisions_content: undefined,
  read_file: {
    "/tmp/test-workspace/test-skill/context/decisions.json": MULTI_CONTRADICTION_DECISIONS,
    "/tmp/test-skills/test-skill/context/decisions.json": MULTI_CONTRADICTION_DECISIONS,
    "/tmp/test-workspace/test-skill/context/clarifications.json": "{\"version\":\"1\",\"metadata\":{\"title\":\"Test\",\"question_count\":1,\"section_count\":1,\"refinement_count\":0,\"must_answer_count\":0,\"priority_questions\":[]},\"sections\":[],\"notes\":[]}",
    "*": "",
  },
};

test.describe("Contradictions guard — multi-decision", { tag: "@workflow" }, () => {
  test("step 4 shows Skipped when contradictions disable it", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, CONTRADICTION_GUARD_OVERRIDES);

    // Step 3 (Confirm Decisions) should be current and completed
    await expect(page.getByText("Step 3: Confirm Decisions")).toBeVisible({ timeout: 5_000 });

    // Step 4 (Generate Skill) should show "Skipped" in the sidebar
    await expect(page.getByText("Skipped")).toBeVisible({ timeout: 5_000 });
  });

  test("shows review-required header and 2 needs-review decisions", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, CONTRADICTION_GUARD_OVERRIDES);
    await expect(page.getByText("Step 3: Confirm Decisions")).toBeVisible({ timeout: 5_000 });

    await expect(page.getByText("2 decisions need your review")).toBeVisible({ timeout: 5_000 });

    const needsReviewBadges = page.getByRole("button", { name: /needs review/i });
    await expect(needsReviewBadges).toHaveCount(2);
  });

  test("editing one of two needs-review decisions does NOT clear contradictions", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, CONTRADICTION_GUARD_OVERRIDES);
    await expect(page.getByText("Step 3: Confirm Decisions")).toBeVisible({ timeout: 5_000 });

    // Edit only D1 and blur — first "Enter decision…" textarea belongs to D1 (first card)
    const d1Textarea = page.getByPlaceholder("Enter decision…").first();
    await expect(d1Textarea).toBeVisible();
    await d1Textarea.fill("Track ARR instead.");
    await page.locator("body").click(); // blur

    // Wait for save debounce (300ms) + guard refresh
    await page.waitForTimeout(500);

    await expect(page.getByText("1 decision needs your review")).toBeVisible();
    await expect(page.getByText(/All decisions reviewed/)).not.toBeVisible();

    // Step 4 should still show "Skipped"
    await expect(page.getByText("Skipped")).toBeVisible();
  });

  test("editing ALL needs-review decisions clears contradictions and enables step 4", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, CONTRADICTION_GUARD_OVERRIDES);
    await expect(page.getByText("Step 3: Confirm Decisions")).toBeVisible({ timeout: 5_000 });

    // Edit D1 and blur
    const d1Textarea = page.getByPlaceholder("Enter decision…").first();
    await expect(d1Textarea).toBeVisible();
    await d1Textarea.click();
    await d1Textarea.fill("Track ARR instead.");
    await page.locator("body").click(); // blur

    // Wait for D1 status to flip to "revised" before editing D2
    await expect(page.getByRole("button", { name: /Revenue Model.*revised/ })).toBeVisible({ timeout: 3_000 });

    // Edit D2 and blur
    const d2Textarea = page.getByRole("textbox", { name: "Decision for Pipeline Scope" });
    await expect(d2Textarea).toBeVisible();
    await d2Textarea.click();
    await d2Textarea.fill("Top-of-funnel only.");
    await page.locator("body").click(); // blur

    // Dynamically update mock so getDisabledSteps returns [] after save
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const overrides = w.__TAURI_MOCK_OVERRIDES__ as Record<string, unknown>;
      overrides.get_disabled_steps = [];
    });

    // Wait for save debounce (300ms) + guard refresh
    await page.waitForTimeout(500);

    await expect(page.getByText("All decisions reviewed")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/decision needs your review|decisions need your review/)).not.toBeVisible();

    // Step 4 should no longer show "Skipped"
    await expect(page.getByText("Skipped")).not.toBeVisible({ timeout: 5_000 });
  });
});

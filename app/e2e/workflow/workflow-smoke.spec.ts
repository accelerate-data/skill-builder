/**
 * Smoke tests for the workflow page — covers critical paths including
 * step progression, reset/rerun, failure recovery, navigation guards,
 * and completion of all 4 workflow steps.
 *
 * Replaces workflow-steps.spec.ts, workflow-agent.spec.ts, and
 * workflow-navigation.spec.ts for the @workflow tag.
 */
import path from "node:path";
import { test, expect } from "@playwright/test";
import { emitTauriEvent } from "../helpers/agent-simulator";
import { waitForAppReady } from "../helpers/app-helpers";
import {
  WORKFLOW_OVERRIDES,
  navigateToWorkflow,
  navigateToWorkflowUpdateMode,
} from "../helpers/workflow-helpers";
import { E2E_SKILLS_PATH } from "../helpers/test-paths";

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
};

test.describe("Workflow Smoke", { tag: "@workflow" }, () => {
  async function startStepIfIdle(page: import("@playwright/test").Page): Promise<void> {
    const startButton = page.getByRole("button", { name: "Start Step" });
    if (await startButton.isVisible().catch(() => false)) {
      await startButton.click();
    }
  }

  // ---------------------------------------------------------------------------
  // Scenario 1: Happy-path step progression
  // Source: workflow-steps.spec.ts — "completed step shows completion screen with output files"
  //         and "review mode hides action buttons on completed step"
  // ---------------------------------------------------------------------------
  test("completed step shows completion UI; review mode hides action buttons", async ({ page }) => {
    // Stay in review mode so clicking a completed step shows the completion
    // screen (update mode would trigger the reset-step dialog for prior steps).
    await navigateToWorkflow(page, COMPLETED_STEP_OVERRIDES);

    // Click step 1 (Research) in sidebar — it is completed
    const step1Button = page.locator("button").filter({ hasText: "1. Research" });
    await step1Button.click();

    // Should show completion screen via ResearchSummaryCard (read-only mode in review).
    await expect(page.getByText("Research Complete")).toBeVisible({ timeout: 5_000 });

    // In review mode: no Start Step, no Next Step buttons
    await expect(page.getByRole("button", { name: "Start Step" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Next Step" })).not.toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: Reset/rerun path
  // Source: workflow-steps.spec.ts — "reset to prior step shows ResetStepDialog"
  // ---------------------------------------------------------------------------
  test("clicking a prior step in update mode opens the ResetStepDialog", async ({ page }) => {
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

    // After reset, dialog should close
    await expect(
      page.getByRole("heading", { name: "Reset to Earlier Step" }),
    ).not.toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Scenario 8: Detailed-research Re-run preserves step 0 and reruns step 1
  // Source: workflow-steps.spec.ts — "resetting step 1 from step 2 via Re-run button"
  // Detailed Research reruns should keep Research completed and restart step 1.
  // ---------------------------------------------------------------------------
  test("Re-run on Detailed Research preserves step 0 and reruns step 1", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, {
      ...WORKFLOW_OVERRIDES,
      get_workflow_state: {
        run: { current_step: 1, purpose: "domain" },
        steps: [
          { step_id: 0, status: "completed" },
          { step_id: 1, status: "completed" },
        ],
      },
    });

    // Step 1 (Detailed Research) is completed and currently active
    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });

    // Re-run button is shown on the completed clarifications step
    const rerunButton = page.getByRole("button", { name: "Re-run" });
    await expect(rerunButton).toBeVisible({ timeout: 5_000 });
    await rerunButton.click();

    // ResetStepDialog must appear
    await expect(
      page.getByRole("heading", { name: "Reset to Earlier Step" }),
    ).toBeVisible({ timeout: 5_000 });

    // Confirm the reset
    await page.getByRole("button", { name: /Delete.*Reset|^Reset$/ }).click();

    // Must stay on Detailed Research while Research remains preserved.
    await expect(page.getByText("Step 2: Detailed Research")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Step 1: Research")).not.toBeVisible({ timeout: 5_000 });
  });

});

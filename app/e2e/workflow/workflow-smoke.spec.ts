/**
 * Smoke tests for the workflow page — 5 scenarios covering the most critical paths.
 *
 * Replaces workflow-steps.spec.ts, workflow-agent.spec.ts, and
 * workflow-navigation.spec.ts for the @workflow tag.
 */
import { test, expect } from "@playwright/test";
import { emitTauriEvent } from "../helpers/agent-simulator";
import { waitForAppReady } from "../helpers/app-helpers";
import {
  WORKFLOW_OVERRIDES,
  navigateToWorkflow,
  navigateToWorkflowUpdateMode,
} from "../helpers/workflow-helpers";

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

/**
 * Fresh workflow for testing error state. We start a step and then
 * simulate an agent error exit. The read_file mock returns content
 * so errorHasArtifacts is true (partial output detection).
 */
const ERROR_STEP_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  read_file: "# Partial Output\n\nSome data was produced before the error.",
};

test.describe("Workflow Smoke", { tag: "@workflow" }, () => {
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
    await page.waitForTimeout(300);

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

    // After reset, dialog should close
    await expect(
      page.getByRole("heading", { name: "Reset to Earlier Step" }),
    ).not.toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: Failure/recovery path
  // Source: workflow-steps.spec.ts — "error state shows Retry and Reset Step buttons"
  // ---------------------------------------------------------------------------
  test("agent error state shows Retry and Reset Step buttons", async ({ page }) => {
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

  // ---------------------------------------------------------------------------
  // Scenario 4: Navigation guard while running
  // Source: workflow-navigation.spec.ts — "blocks navigation while agent is running —
  //         Stay keeps page, Leave navigates away"
  // ---------------------------------------------------------------------------
  test("navigation guard while running — Stay keeps page, Leave navigates away", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page);

    // Agent auto-starts in update mode — wait for init indicator
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });

    // Simulate agent init so the UI is in running state
    await emitTauriEvent(page, "agent-init-progress", {
      agent_id: "agent-001",
      stage: "init_start",
      timestamp: Date.now(),
    });
    await page.waitForTimeout(100);

    // Try to navigate away by clicking Dashboard in the app sidebar
    const skillsLink = page.locator("aside nav").getByText("Dashboard");
    await skillsLink.click();
    await page.waitForTimeout(300);

    // Navigation guard dialog should appear
    await expect(
      page.getByRole("heading", { name: "Agent Running" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("An agent is still running")).toBeVisible();

    // Click "Stay" — should dismiss dialog and remain on workflow
    await page.getByRole("button", { name: "Stay" }).click();
    await page.waitForTimeout(200);
    await expect(
      page.getByRole("heading", { name: "Agent Running" }),
    ).not.toBeVisible();
    // Still on workflow page
    await expect(page.getByText("Workflow Steps")).toBeVisible();

    // Try to navigate again
    await skillsLink.click();
    await page.waitForTimeout(300);

    // Dialog appears again
    await expect(
      page.getByRole("heading", { name: "Agent Running" }),
    ).toBeVisible({ timeout: 5_000 });

    // This time click "Leave" — should navigate away
    await page.getByRole("button", { name: "Leave" }).click();
    await page.waitForTimeout(500);

    // Should be on dashboard
    await expect(page).toHaveURL("/");
  });

  // ---------------------------------------------------------------------------
  // Scenario 5: Step-switch guard while running
  // Source: workflow-navigation.spec.ts — "blocks step switch while agent is running"
  // ---------------------------------------------------------------------------
  test("blocks step switch while agent is running — Stay and Leave", async ({ page }) => {
    // Steps 0 and 1 completed, currently on step 2 so sidebar has completed steps to click.
    await navigateToWorkflowUpdateMode(page, {
      ...WORKFLOW_OVERRIDES,
      get_workflow_state: {
        run: { current_step: 2, purpose: "domain" },
        steps: [
          { step_id: 0, status: "completed" },
          { step_id: 1, status: "completed" },
        ],
      },
      read_file: "# Results\n\nAnalysis complete.",
    });

    // Agent auto-starts in update mode — wait for init indicator
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });

    // Simulate agent init so the UI is in running state
    await emitTauriEvent(page, "agent-init-progress", {
      agent_id: "agent-001",
      stage: "init_start",
      timestamp: Date.now(),
    });
    await page.waitForTimeout(100);

    // Click a completed step in the workflow sidebar (step 1: Research)
    const step1Button = page.locator("button").filter({ hasText: "1. Research" });
    await step1Button.click();
    await page.waitForTimeout(300);

    // Step-switch guard dialog should appear
    await expect(
      page.getByRole("heading", { name: "Agent Running" }),
    ).toBeVisible({ timeout: 5_000 });

    // Click "Stay" — should dismiss dialog
    await page.getByRole("button", { name: "Stay" }).click();
    await page.waitForTimeout(200);
    await expect(
      page.getByRole("heading", { name: "Agent Running" }),
    ).not.toBeVisible();

    // Click the completed step again
    await step1Button.click();
    await page.waitForTimeout(300);

    // Click "Leave" — should switch steps
    await expect(
      page.getByRole("heading", { name: "Agent Running" }),
    ).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Leave" }).click();
    await page.waitForTimeout(300);

    // Should now be on step 1 (Research)
    await expect(page.getByText("Step 1: Research")).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Scenario 6: Review/update toggle disabled while running
  // Source: workflow-navigation.spec.ts — "review/update toggle is disabled while agent is running"
  // ---------------------------------------------------------------------------
  test("review/update toggle is disabled while agent is running", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page);

    // Agent auto-starts in update mode — wait for init indicator
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });

    // Simulate agent init so the UI is in running state
    await emitTauriEvent(page, "agent-init-progress", {
      agent_id: "agent-001",
      stage: "init_start",
      timestamp: Date.now(),
    });
    await page.waitForTimeout(100);

    // The "Review" button in the toggle should be disabled while agent is running
    const reviewToggleButton = page.locator("header").getByRole("button", { name: "Review" });
    await expect(reviewToggleButton).toBeDisabled();

    // The "Update" button should also be disabled (both sides locked)
    const updateToggleButton = page.locator("header").getByRole("button", { name: "Update" });
    await expect(updateToggleButton).toBeDisabled();

    // Simulate agent completion
    await emitTauriEvent(page, "agent-exit", { agent_id: "agent-001", success: true });
    await page.waitForTimeout(500);

    // After agent completes, the toggle should be enabled again
    await expect(reviewToggleButton).toBeEnabled({ timeout: 5_000 });
    await expect(updateToggleButton).toBeEnabled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 8: Detailed-research Re-run resets to step 0
  // Source: workflow-steps.spec.ts — "resetting step 1 from step 2 via Re-run button"
  // The Re-run button on step 1 (Detailed Research) must reset to step 0, not step 1.
  // This guards the special-case: setResetTarget(currentStep === 1 ? 0 : currentStep).
  // ---------------------------------------------------------------------------
  test("Re-run on Detailed Research resets workflow to step 0", async ({ page }) => {
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

    // Must land on step 0 (Research), not step 1 (Detailed Research)
    await expect(page.getByText("Step 1: Research")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Step 2: Detailed Research")).not.toBeVisible({ timeout: 5_000 });
  });

  // ---------------------------------------------------------------------------
  // Scenario 7: Lock-acquisition failure
  // Source: workflow-navigation.spec.ts — "lock acquisition failure redirects to
  //         dashboard with error toast"
  // ---------------------------------------------------------------------------
  test("lock acquisition failure redirects to dashboard with error toast", async ({ page }) => {
    // For lock failure, we need acquire_lock to throw an error.
    // Since addInitScript serializes values and Error instances don't
    // survive, we use a special string sentinel and patch the mock
    // to recognize it via addInitScript.
    const overrides = {
      ...WORKFLOW_OVERRIDES,
      acquire_lock: "__THROW_ERROR__",
    };

    // First, set up the standard mock overrides
    await page.addInitScript((o) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
    }, overrides);

    // Then patch the mock's invoke to throw for acquire_lock
    await page.addInitScript(() => {
      const origOverrides = (window as unknown as Record<string, unknown>)
        .__TAURI_MOCK_OVERRIDES__ as Record<string, unknown>;
      if (origOverrides && origOverrides.acquire_lock === "__THROW_ERROR__") {
        origOverrides.acquire_lock = new Error("Skill is locked by another session");
      }
    });

    await page.goto("/skill/test-skill");
    await waitForAppReady(page);

    // Should redirect to dashboard after lock failure
    await expect(page).toHaveURL("/", { timeout: 10_000 });

    // Error toast should be visible
    await expect(
      page.getByText(/Could not lock skill/),
    ).toBeVisible({ timeout: 5_000 });
  });
});

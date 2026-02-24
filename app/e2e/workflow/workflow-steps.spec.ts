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
  resolve(__dirname, "../fixtures/agent-responses/review-content.md"),
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
  read_file: "# Research Results\n\nAnalysis complete.",
};

/** Step 0 completed, currently on human review step 1. */
const HUMAN_REVIEW_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 1, purpose: "domain" },
    steps: [{ step_id: 0, status: "completed" }],
  },
  read_file: REVIEW_CONTENT,
};

/** All steps completed, currently viewing the last step (step 5 = Generate Skill). */
const LAST_STEP_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 5, purpose: "domain" },
    steps: [
      { step_id: 0, status: "completed" },
      { step_id: 1, status: "completed" },
      { step_id: 2, status: "completed" },
      { step_id: 3, status: "completed" },
      { step_id: 4, status: "completed" },
      { step_id: 5, status: "completed" },
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
 * Step 0 completed, current step is human review (step 1), with steps
 * 2-5 disabled. The human review UI checks whether the next step after
 * review is disabled and shows "Scope Too Broad" when it is.
 */
const DISABLED_STEPS_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 1, purpose: "domain" },
    steps: [{ step_id: 0, status: "completed" }],
  },
  get_disabled_steps: [2, 3, 4, 5],
  read_file: "# Scope Recommendation\n\nThis skill topic is too broad for a single skill.",
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

    // Should show completion screen with output file names
    await expect(page.getByText("context/research-plan.md")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("context/clarifications.md")).toBeVisible();
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

    // Should be on step 2 (Review) which is human review
    await expect(page.getByText("Step 2: Review")).toBeVisible();

    // MDEditor should have loaded the review content
    // The editor renders inside a data-color-mode="dark" div
    const editorContainer = page.locator("[data-color-mode='dark']");
    await expect(editorContainer).toBeVisible({ timeout: 5_000 });

    // Verify the content loaded by checking the textarea value
    const textarea = editorContainer.locator("textarea").first();
    await expect(textarea).toHaveValue(/Primary focus area/);
  });

  test("human review shows dirty indicator on edit", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, HUMAN_REVIEW_OVERRIDES);
    await page.waitForTimeout(500);

    // Type in the MDEditor textarea
    const textarea = page.locator("[data-color-mode='dark'] textarea").first();
    await textarea.click();
    await textarea.press("End");
    await textarea.type(" my edit");
    await page.waitForTimeout(200);

    // The Save button should have an orange dot (dirty indicator)
    const saveButton = page.getByRole("button", { name: "Save" });
    await expect(saveButton).toBeVisible();
    // The orange dot is a span inside the Save button with bg-orange-500
    const dirtyDot = saveButton.locator("span.bg-orange-500");
    await expect(dirtyDot).toBeVisible();
  });

  test("human review save clears dirty indicator and shows toast", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, HUMAN_REVIEW_OVERRIDES);
    await page.waitForTimeout(500);

    // Type to make dirty
    const textarea = page.locator("[data-color-mode='dark'] textarea").first();
    await textarea.click();
    await textarea.press("End");
    await textarea.type(" edit");
    await page.waitForTimeout(200);

    // Click Save
    const saveButton = page.getByRole("button", { name: "Save" });
    await saveButton.click();
    await page.waitForTimeout(300);

    // Dirty indicator should be gone
    const dirtyDot = saveButton.locator("span.bg-orange-500");
    await expect(dirtyDot).not.toBeVisible();

    // Toast should appear
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 3_000 });
  });

  test("human review reload re-reads from disk", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, HUMAN_REVIEW_OVERRIDES);
    await page.waitForTimeout(500);

    // Type to make dirty
    const textarea = page.locator("[data-color-mode='dark'] textarea").first();
    await textarea.click();
    await textarea.press("End");
    await textarea.type(" custom text");
    await page.waitForTimeout(200);

    // Change the mock to return different content before clicking Reload.
    // This ensures setReviewContent receives a new value, triggering the
    // useEffect that syncs editorContent (same-value sets are no-ops in React).
    await page.evaluate(() => {
      const overrides = (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ as
        Record<string, unknown>;
      overrides.read_file = "# Reloaded Content\n\nThis is the reloaded version.";
    });

    // Click Reload
    await page.getByRole("button", { name: "Reload" }).click();
    await page.waitForTimeout(300);

    // The textarea should show the reloaded content (no "custom text")
    await expect(textarea).not.toHaveValue(/custom text/);
    // Reloaded content should be present
    await expect(textarea).toHaveValue(/Reloaded Content/);
  });

  test("human review complete with unsaved changes shows dialog", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, HUMAN_REVIEW_OVERRIDES);
    await page.waitForTimeout(500);

    // Type to make dirty
    const textarea = page.locator("[data-color-mode='dark'] textarea").first();
    await textarea.click();
    await textarea.press("End");
    await textarea.type(" unsaved edit");
    await page.waitForTimeout(200);

    // Click Complete Step
    await page.getByRole("button", { name: "Complete Step" }).click();
    await page.waitForTimeout(200);

    // Dialog should appear
    await expect(
      page.getByRole("heading", { name: "Unsaved Changes" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Discard & Continue" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save & Continue" })).toBeVisible();
  });

  test("reset to prior step shows ResetStepDialog", async ({ page }) => {
    // Use a human step as current (step 3 = Review) to avoid auto-start of agent
    await navigateToWorkflowUpdateMode(page, {
      ...WORKFLOW_OVERRIDES,
      get_workflow_state: {
        run: { current_step: 3, purpose: "domain" },
        steps: [
          { step_id: 0, status: "completed" },
          { step_id: 1, status: "completed" },
          { step_id: 2, status: "completed" },
        ],
      },
      read_file: "# Review\n\nDetailed review content.",
      preview_step_reset: [
        {
          step_id: 0,
          step_name: "Research",
          files: ["context/research-plan.md", "context/clarifications.md"],
        },
        {
          step_id: 1,
          step_name: "Review",
          files: ["context/clarifications.md"],
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

  test("disabled steps show Skipped label and scope-too-broad message", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, DISABLED_STEPS_OVERRIDES);

    // Should be on step 2 (Review) — human review with disabled next steps
    await expect(page.getByText("Step 2: Review")).toBeVisible({ timeout: 5_000 });

    // Disabled steps in sidebar should show "Skipped" labels
    await expect(page.getByText("Skipped").first()).toBeVisible({ timeout: 5_000 });

    // The human review step detects that the next step (2) is disabled
    // and shows "Scope Too Broad" with "Return to Dashboard" button
    await expect(page.getByText("Scope Too Broad")).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("button", { name: "Return to Dashboard" }),
    ).toBeVisible();
  });

  test("error state shows Retry and Reset Step buttons", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, ERROR_STEP_OVERRIDES);

    // Agent auto-starts — wait for init indicator
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });

    // Simulate agent init then error exit
    await emitTauriEvent(page, "agent-init-progress", {
      agent_id: "agent-001",
      subtype: "init_start",
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

  test("completed human step shows readonly markdown in review mode", async ({ page }) => {
    // Steps 0 and 1 completed, current_step=2.
    // Navigate in review mode (NOT update) and click step 2 (Review, index 1).
    await navigateToWorkflow(page, COMPLETED_STEP_OVERRIDES);

    // Click step 2 (Review, human, completed) in sidebar
    const step2Button = page.locator("button").filter({ hasText: "2. Review" });
    await step2Button.click();
    await page.waitForTimeout(300);

    // Verify we're on the human review step
    await expect(page.getByText("Step 2: Review")).toBeVisible({ timeout: 5_000 });

    // Should show readonly markdown preview (ReactMarkdown renders inside .markdown-body)
    await expect(page.locator(".markdown-body")).toBeVisible({ timeout: 5_000 });

    // Verify the loaded content is rendered (read_file mock returns "Research Results")
    await expect(page.getByText("Research Results")).toBeVisible();

    // Should NOT show MDEditor (update-mode editor uses data-color-mode="dark")
    await expect(page.locator("[data-color-mode='dark']")).not.toBeVisible();

    // Should NOT show "Complete Step" button (step already completed, and we're in review mode)
    await expect(page.getByRole("button", { name: "Complete Step" })).not.toBeVisible();
  });

  test("completed human step shows editor without Complete button in update mode", async ({ page }) => {
    // All steps completed, current_step=3 (human Review step, completed).
    // Navigate to update mode — the reposition effect targets step 5 (last step,
    // all completed). After reposition settles, programmatically navigate to step 3
    // via the exposed Zustand store to test the completed-human-step UI in update mode.
    const allCompletedOnHuman: Record<string, unknown> = {
      ...WORKFLOW_OVERRIDES,
      get_workflow_state: {
        run: { current_step: 3, purpose: "domain" },
        steps: [
          { step_id: 0, status: "completed" },
          { step_id: 1, status: "completed" },
          { step_id: 2, status: "completed" },
          { step_id: 3, status: "completed" },
          { step_id: 4, status: "completed" },
          { step_id: 5, status: "completed" },
        ],
      },
      read_file: REVIEW_CONTENT,
    };

    await navigateToWorkflowUpdateMode(page, allCompletedOnHuman);
    // Reposition settles on step 5 (all completed, target = last step)
    await page.waitForTimeout(500);

    // Programmatically navigate to the completed human step via the store
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__TEST_WORKFLOW_STORE__ as {
        getState: () => { setCurrentStep: (step: number) => void };
      };
      store.getState().setCurrentStep(3);
    });
    await page.waitForTimeout(500);

    // Should be on step 4 (Review, 0-indexed step 3)
    await expect(page.getByText("Step 4: Review")).toBeVisible({ timeout: 5_000 });

    // Should show MDEditor (data-color-mode="dark" container)
    const editorContainer = page.locator("[data-color-mode='dark']");
    await expect(editorContainer).toBeVisible({ timeout: 5_000 });

    // Should show Save and Reload buttons
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();

    // Should NOT show "Complete Step" button (step already completed)
    await expect(page.getByRole("button", { name: "Complete Step" })).not.toBeVisible();
  });

  test("Review to Update toggle repositions to first incomplete step", async ({ page }) => {
    // Steps 0,1,2 completed, current_step=3 (human step, pending).
    // Navigate in review mode, then click on a completed step to move away from
    // the first incomplete step. Toggling to Update should reposition back.
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
      read_file: "# Research Results\n\nAnalysis complete.",
    };

    await navigateToWorkflow(page, threeCompletedOverrides);

    // In review mode, navigate to step 1 (Research, completed) — away from first incomplete
    const step1Button = page.locator("button").filter({ hasText: "1. Research" });
    await step1Button.click();
    await page.waitForTimeout(300);

    // Verify we're on step 1 (Research)
    await expect(page.getByText("Step 1: Research")).toBeVisible();

    // Click "Update" toggle — should reposition to first incomplete step (step 3, index 3)
    await page.getByRole("button", { name: "Update" }).click();
    await page.waitForTimeout(500);

    // Should reposition to step 4 (display name, 0-indexed step 3 = "Review")
    await expect(page.getByText("Step 4: Review")).toBeVisible({ timeout: 5_000 });
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
});

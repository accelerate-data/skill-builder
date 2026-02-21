/**
 * E2E tests for workflow navigation guards and lock management.
 *
 * Covers the useBlocker-based navigation guard (agent running /
 * unsaved changes), step-switch guard when agent is running, and
 * lock acquisition failure redirect.
 */
import { test, expect } from "@playwright/test";
import { emitTauriEvent, simulateAgentRun } from "../helpers/agent-simulator";
import { waitForAppReady } from "../helpers/app-helpers";
import {
  WORKFLOW_OVERRIDES,
  navigateToWorkflow,
  navigateToWorkflowUpdateMode,
} from "../helpers/workflow-helpers";

// --- Override presets ---

/** Step 0 completed, currently on human review step 1 (for unsaved changes test). */
const HUMAN_REVIEW_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { domain: "Testing", current_step: 1, skill_type: "domain" },
    steps: [{ step_id: 0, status: "completed" }],
  },
  read_file: "# Clarifications\n\n## Q1\n\nSample content for editing.",
};

/** Steps 0 and 1 completed, for step-switch guard test. */
const COMPLETED_STEPS_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { domain: "Testing", current_step: 2, skill_type: "domain" },
    steps: [
      { step_id: 0, status: "completed" },
      { step_id: 1, status: "completed" },
    ],
  },
  read_file: "# Results\n\nAnalysis complete.",
};

test.describe("Workflow Navigation Guards", { tag: "@workflow" }, () => {
  test("blocks navigation while agent is running — Stay keeps page, Leave navigates away", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page);

    // Agent auto-starts in update mode — wait for init indicator
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });

    // Simulate agent init so the UI is in running state
    await emitTauriEvent(page, "agent-init-progress", {
      agent_id: "agent-001",
      subtype: "init_start",
      timestamp: Date.now(),
    });
    await page.waitForTimeout(100);

    // Try to navigate away by clicking Skill Library in the app sidebar
    // (sidebar nav was renamed from "Skills" / "Dashboard" to "Skill Library")
    const skillsLink = page.locator("aside nav").getByText("Skill Library");
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

  test("blocks navigation with unsaved review edits", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, HUMAN_REVIEW_OVERRIDES);
    await page.waitForTimeout(500);

    // Type in the MDEditor to create unsaved changes
    const textarea = page.locator("[data-color-mode='dark'] textarea").first();
    await textarea.click();
    await textarea.press("End");
    await textarea.type(" unsaved edit");
    await page.waitForTimeout(200);

    // Try to navigate away by clicking Skill Library in the app sidebar
    // (sidebar nav was renamed from "Skills" to "Skill Library")
    const skillsLink = page.locator("aside nav").getByText("Skill Library");
    await skillsLink.click();
    await page.waitForTimeout(300);

    // Navigation guard dialog should appear with "Unsaved Changes" title
    await expect(
      page.getByRole("heading", { name: "Unsaved Changes" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText("You have unsaved edits"),
    ).toBeVisible();

    // Click Stay to remain on workflow
    await page.getByRole("button", { name: "Stay" }).click();
    await page.waitForTimeout(200);

    // Should still be on workflow
    await expect(page.getByText("Step 2: Review")).toBeVisible();
  });

  test("blocks step switch while agent is running", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, COMPLETED_STEPS_OVERRIDES);

    // Verify we're on step 3 (Detailed Research)
    await expect(page.getByText("Step 3: Detailed Research")).toBeVisible();

    // Agent auto-starts in update mode — wait for init indicator
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });

    // Simulate agent init
    await emitTauriEvent(page, "agent-init-progress", {
      agent_id: "agent-001",
      subtype: "init_start",
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

    // Click "Stay" — should dismiss dialog and stay on current step
    await page.getByRole("button", { name: "Stay" }).click();
    await page.waitForTimeout(200);
    await expect(
      page.getByRole("heading", { name: "Agent Running" }),
    ).not.toBeVisible();
    // Still on step 3
    await expect(page.getByText("Step 3: Detailed Research")).toBeVisible();

    // Click the completed step again
    await step1Button.click();
    await page.waitForTimeout(300);

    // Click "Leave" this time — should switch steps
    await expect(
      page.getByRole("heading", { name: "Agent Running" }),
    ).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Leave" }).click();
    await page.waitForTimeout(300);

    // Should now be on step 1 (Research)
    await expect(page.getByText("Step 1: Research")).toBeVisible();
  });

  test("review/update toggle is disabled while agent is running", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page);

    // Agent auto-starts in update mode — wait for init indicator
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });

    // Simulate agent init so the UI is in running state
    await emitTauriEvent(page, "agent-init-progress", {
      agent_id: "agent-001",
      subtype: "init_start",
      timestamp: Date.now(),
    });
    await page.waitForTimeout(100);

    // The "Review" button in the toggle should be disabled while agent is running
    const reviewToggleButton = page.locator("header").getByRole("button", { name: "Review" });
    await expect(reviewToggleButton).toBeDisabled();

    // The "Update" button should also be disabled (both sides locked)
    const updateToggleButton = page.locator("header").getByRole("button", { name: "Update" });
    await expect(updateToggleButton).toBeDisabled();

    // Simulate agent completion — full run with result and exit
    await simulateAgentRun(page, {
      agentId: "agent-001",
      messages: ["Processing..."],
      result: "Done.",
    });
    await page.waitForTimeout(500);

    // After agent completes, the toggle should be enabled again
    await expect(reviewToggleButton).toBeEnabled({ timeout: 5_000 });
    await expect(updateToggleButton).toBeEnabled();
  });

  test("lock acquisition failure redirects to dashboard with error toast", async ({ page }) => {
    // For lock failure, we need acquire_lock to throw an error.
    // Since addInitScript serializes values and Error instances don't
    // survive, we use a special string sentinel and patch the mock
    // to recognize it via addInitScript.
    const overrides = {
      ...WORKFLOW_OVERRIDES,
      // Use a sentinel value; we'll override acquire_lock behavior
      // via a separate addInitScript that replaces the mock
      acquire_lock: "__THROW_ERROR__",
    };

    // First, set up the standard mock overrides
    await page.addInitScript((o) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
    }, overrides);

    // Then patch the mock's invoke to throw for acquire_lock
    await page.addInitScript(() => {
      // Store original check value so the mock invoke function knows to throw
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

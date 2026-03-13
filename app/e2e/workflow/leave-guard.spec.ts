/**
 * E2E tests for leave-guard behavior: store state verification for
 * navigation guard integration.
 *
 * Complements workflow-navigation.spec.ts which covers the dialog UI.
 * This spec focuses on store state transitions and guard trigger conditions.
 */
import { test, expect } from "@playwright/test";
import { simulateAgentRun } from "../helpers/agent-simulator";
import {
  WORKFLOW_OVERRIDES,
  navigateToWorkflow,
  navigateToWorkflowUpdateMode,
} from "../helpers/workflow-helpers";

/** Step 0 completed, currently on human review step 1. */
const HUMAN_REVIEW_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 1, purpose: "domain" },
    steps: [{ step_id: 0, status: "completed" }],
  },
  read_file: "# Clarifications\n\n## Q1\n\nSample content for editing.",
};

test.describe("Leave Guard — Store State", { tag: "@workflow" }, () => {
  test("navigating away from clean review does not trigger guard", async ({ page }) => {
    await navigateToWorkflow(page, HUMAN_REVIEW_OVERRIDES);

    // In review mode (no edits), navigate away directly
    const dashboardLink = page.locator("aside nav").getByText("Dashboard");
    await dashboardLink.click();

    // Should navigate without guard dialog
    await expect(page).toHaveURL("/");
  });

  test("workflow store isRunning is false in review mode", async ({ page }) => {
    await navigateToWorkflow(page);

    // Check store state via exposed test handle
    const isRunning = await page.evaluate(async () => {
      const store = (window as unknown as Record<string, unknown>).__TEST_WORKFLOW_STORE__ as {
        getState: () => { isRunning: boolean };
      };
      return store.getState().isRunning;
    });

    expect(isRunning).toBe(false);
  });

  test("workflow store isRunning becomes false after agent completes", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page);

    // Agent auto-starts — verify isRunning is true
    await expect.poll(async () => page.evaluate(async () => {
      const store = (window as unknown as Record<string, unknown>).__TEST_WORKFLOW_STORE__ as {
        getState: () => { isRunning: boolean };
      };
      return store.getState().isRunning;
    }), { timeout: 5_000 }).toBe(true);

    // Complete the agent run
    await simulateAgentRun(page, {
      agentId: "agent-001",
      messages: ["Processing..."],
      result: "Done.",
    });
    await page.waitForTimeout(500);

    // isRunning should be false after completion
    const isRunning = await page.evaluate(async () => {
      const store = (window as unknown as Record<string, unknown>).__TEST_WORKFLOW_STORE__ as {
        getState: () => { isRunning: boolean };
      };
      return store.getState().isRunning;
    });

    expect(isRunning).toBe(false);
  });

  test("guard does not trigger when navigating from completed step in review mode", async ({ page }) => {
    const completedOverrides = {
      ...WORKFLOW_OVERRIDES,
      get_workflow_state: {
        run: { current_step: 2, purpose: "domain" },
        steps: [
          { step_id: 0, status: "completed" },
          { step_id: 1, status: "completed" },
        ],
      },
    };

    await navigateToWorkflow(page, completedOverrides);

    // Click on step 1 in review mode — should navigate without dialog
    const step1 = page.locator("button").filter({ hasText: "1. Research" });
    await step1.click();
    await page.waitForTimeout(300);

    // No guard dialog should appear (review mode, no running agent)
    await expect(
      page.getByRole("heading", { name: /Agent Running/i }),
    ).not.toBeVisible();
  });
});

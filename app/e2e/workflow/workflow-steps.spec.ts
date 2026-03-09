import { test, expect } from "@playwright/test";
import { emitTauriEvent } from "../helpers/agent-simulator";
import { WORKFLOW_OVERRIDES, navigateToWorkflow, navigateToWorkflowUpdateMode } from "../helpers/workflow-helpers";

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
};

const ERROR_STEP_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  read_file: "# Partial Output\n\nSome data was produced before the error.",
};

test.describe("Workflow Step Progression", { tag: "@workflow" }, () => {
  test("review mode hides action buttons on completed step", async ({ page }) => {
    await navigateToWorkflow(page, COMPLETED_STEP_OVERRIDES);
    await page.locator("button").filter({ hasText: "1. Research" }).click();
    await page.waitForTimeout(250);
    await expect(page.getByRole("button", { name: "Start Step" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Next Step" })).not.toBeVisible();
  });

  test("update mode auto-starts agent on pending step", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page);
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });
  });

  test("clicking prior completed step while running shows guard dialog", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, COMPLETED_STEP_OVERRIDES);
    await page.locator("button").filter({ hasText: "1. Research" }).click();
    await expect(page.getByRole("heading", { name: "Agent Running" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Stay" })).toBeVisible();
  });

  test("error state shows Retry and Reset Step buttons", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, ERROR_STEP_OVERRIDES);
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });
    await emitTauriEvent(page, "agent-exit", { agent_id: "agent-001", success: false });
    await page.waitForTimeout(400);
    await expect(page.locator("main").getByText("Step 1 failed")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset Step" })).toBeVisible();
  });

  test("last step completion shows Done button that navigates to dashboard", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, LAST_STEP_OVERRIDES);
    await expect(page.getByText("Generate Skill Complete")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next Step" })).not.toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page).toHaveURL("/");
  });

  test("missing-files error state shows Reset Step button", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, {
      ...WORKFLOW_OVERRIDES,
      get_workflow_state: {
        run: { current_step: 0, purpose: "domain" },
        steps: [{ step_id: 0, status: "completed" }],
      },
      read_file: null,
    });
    await expect(page.getByText("Step 1: Research")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Reset Step" })).toBeVisible({ timeout: 5_000 });
  });
});

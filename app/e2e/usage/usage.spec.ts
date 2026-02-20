import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";
import usageData from "../fixtures/usage-data.json" with { type: "json" };

test.describe("Usage Page", { tag: "@usage" }, () => {
  test("shows empty state by default", async ({ page }) => {
    await page.goto("/usage");
    await waitForAppReady(page);

    // Default mocks return zero summary and empty sessions
    // Check for the empty state icon specifically (size-12 class makes it unique)
    await expect(page.locator("svg.lucide-dollar-sign.size-12")).toBeVisible();
    await expect(page.getByText("No usage data yet.")).toBeVisible();
    await expect(page.getByText("Run an agent to start tracking costs.")).toBeVisible();
  });

  test("shows summary cards with populated data", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      get_usage_summary: usageData.summary,
      get_recent_workflow_sessions: usageData.sessions,
      get_usage_by_step: usageData.byStep,
      get_usage_by_model: usageData.byModel,
    });

    await page.goto("/usage");
    await waitForAppReady(page);

    // Verify summary cards
    await expect(page.getByTestId("total-cost")).toHaveText("$4.52");
    await expect(page.getByTestId("total-runs")).toHaveText("12");
    await expect(page.getByTestId("avg-cost")).toHaveText("$0.38");
  });

  test("shows cost by step breakdown", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      get_usage_summary: usageData.summary,
      get_recent_workflow_sessions: usageData.sessions,
      get_usage_by_step: usageData.byStep,
      get_usage_by_model: usageData.byModel,
    });

    await page.goto("/usage");
    await waitForAppReady(page);

    // Verify step names appear (use exact match to avoid conflicts)
    await expect(page.getByText("Research", { exact: true })).toBeVisible();
    await expect(page.getByText("Detailed Research")).toBeVisible();
    await expect(page.getByText("Confirm Decisions")).toBeVisible();
    await expect(page.getByText("Generate Skill")).toBeVisible();
  });

  test("shows cost by model breakdown", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      get_usage_summary: usageData.summary,
      get_recent_workflow_sessions: usageData.sessions,
      get_usage_by_step: usageData.byStep,
      get_usage_by_model: usageData.byModel,
    });

    await page.goto("/usage");
    await waitForAppReady(page);

    // Verify model names appear
    await expect(page.getByText("sonnet")).toBeVisible();
    await expect(page.getByText("opus")).toBeVisible();
    await expect(page.getByText("haiku")).toBeVisible();
  });

  test("expands session to show agent run details", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      get_usage_summary: usageData.summary,
      get_recent_workflow_sessions: usageData.sessions,
      get_usage_by_step: usageData.byStep,
      get_usage_by_model: usageData.byModel,
      get_session_agent_runs: usageData.agentRuns,
    });

    await page.goto("/usage");
    await waitForAppReady(page);

    // Find and click the session row for "data-analytics"
    const sessionButton = page.getByRole("button", { name: /Toggle details for data-analytics workflow run/ });
    await expect(sessionButton).toBeVisible();
    await expect(sessionButton).toHaveAttribute("aria-expanded", "false");

    await sessionButton.click();

    // Session should now be expanded
    await expect(sessionButton).toHaveAttribute("aria-expanded", "true");

    // Step table should appear with agent run details
    const stepTable = page.getByTestId("step-table");
    await expect(stepTable).toBeVisible();

    // Verify step details appear
    await expect(stepTable.getByText("Research")).toBeVisible();
    await expect(stepTable.getByText("Confirm Decisions")).toBeVisible();
  });

  test("toggles hide cancelled runs checkbox", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      get_usage_summary: usageData.summary,
      get_recent_workflow_sessions: usageData.sessions,
      get_usage_by_step: usageData.byStep,
      get_usage_by_model: usageData.byModel,
    });

    await page.goto("/usage");
    await waitForAppReady(page);

    // Find and check the "Hide cancelled runs" checkbox
    const checkbox = page.locator('input[type="checkbox"]');
    await expect(checkbox).not.toBeChecked();

    await checkbox.check();
    await expect(checkbox).toBeChecked();

    // Note: The store re-fetches data when toggled, but we don't need to verify
    // the API call in this test since we're just testing the UI interaction
  });

  test("opens reset dialog and confirms reset", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      get_usage_summary: usageData.summary,
      get_recent_workflow_sessions: usageData.sessions,
      get_usage_by_step: usageData.byStep,
      get_usage_by_model: usageData.byModel,
      reset_usage: undefined,
    });

    await page.goto("/usage");
    await waitForAppReady(page);

    // Click Reset button
    const resetButton = page.getByRole("button", { name: /Reset/ });
    await resetButton.click();

    // Dialog should appear
    await expect(page.getByRole("heading", { name: "Reset Usage Data" })).toBeVisible();
    await expect(page.getByText(/This will permanently delete all usage tracking data/)).toBeVisible();

    // Confirm reset
    const confirmButton = page.getByRole("button", { name: "Reset All Data" });
    await confirmButton.click();

    // Dialog should close (reset_usage mock succeeds)
    await expect(page.getByRole("heading", { name: "Reset Usage Data" })).not.toBeVisible();
  });

  test("opens reset dialog and cancels", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      get_usage_summary: usageData.summary,
      get_recent_workflow_sessions: usageData.sessions,
      get_usage_by_step: usageData.byStep,
      get_usage_by_model: usageData.byModel,
    });

    await page.goto("/usage");
    await waitForAppReady(page);

    // Click Reset button
    const resetButton = page.getByRole("button", { name: /Reset/ });
    await resetButton.click();

    // Dialog should appear
    await expect(page.getByRole("heading", { name: "Reset Usage Data" })).toBeVisible();

    // Cancel
    const cancelButton = page.getByRole("button", { name: "Cancel" });
    await cancelButton.click();

    // Dialog should close, data should remain
    await expect(page.getByRole("heading", { name: "Reset Usage Data" })).not.toBeVisible();
    await expect(page.getByTestId("total-cost")).toHaveText("$4.52");
  });

  test("shows error state when fetch fails", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_usage_summary: new Error("Database error"),
      };
    });

    await page.goto("/usage");
    await waitForAppReady(page);

    // Error message should be visible
    await expect(page.getByText(/Failed to load usage data/)).toBeVisible();
    await expect(page.getByText(/Database error/)).toBeVisible();
  });
});

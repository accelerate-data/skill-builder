import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";
import { E2E_MODEL_SETTINGS, E2E_SKILLS_PATH, E2E_WORKSPACE_PATH } from "../helpers/test-paths";

const BASE_OVERRIDES = {
  get_settings: {
    model_settings: E2E_MODEL_SETTINGS,
    workspace_path: E2E_WORKSPACE_PATH,
    skills_path: E2E_SKILLS_PATH,
  },
  check_workspace_path: true,
  list_skills: [],
};

/**
 * Navigate to the Usage section within the Settings page.
 */
async function navigateToUsageSection(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/settings");
  await waitForAppReady(page);
  // Click the "Usage" section button in the settings sidebar
  await page.getByRole("button", { name: "Usage" }).click();
}

test.describe("Usage Page Smoke", { tag: "@dashboard" }, () => {
  test("renders empty-state usage page without errors", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      ...BASE_OVERRIDES,
      get_usage_summary: { total_cost: 0, total_runs: 0, avg_cost_per_run: 0 },
      get_recent_workflow_sessions: [],
      get_agent_runs: [],
      get_usage_by_step: [],
      get_usage_by_model: [],
      get_usage_by_day: [],
      get_workflow_skill_names: [],
    });

    await navigateToUsageSection(page);

    // Empty state is shown when there are no runs
    await expect(page.getByText("No usage data yet.")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Run an agent to start tracking costs.")).toBeVisible();
  });

  test("renders summary cards when usage data is present", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      ...BASE_OVERRIDES,
      get_usage_summary: { total_cost: 1.23, total_runs: 5, avg_cost_per_run: 0.246 },
      get_recent_workflow_sessions: [],
      get_agent_runs: [
        {
          agent_id: "agent-001",
          skill_name: "test-skill",
          step_id: 0,
          model: "claude-sonnet-4-5",
          started_at: new Date().toISOString(),
          total_cost: 1.23,
          input_tokens: 1000,
          output_tokens: 500,
          status: "completed",
        },
      ],
      get_usage_by_step: [
        { step_id: 0, step_name: "Research", total_cost: 1.23, run_count: 5 },
      ],
      get_usage_by_model: [
        { model: "Sonnet", total_cost: 1.23, run_count: 5 },
      ],
      get_usage_by_day: [],
      get_workflow_skill_names: ["test-skill"],
    });

    await navigateToUsageSection(page);

    // Summary cards should be visible
    await expect(page.getByText("Total Spent (USD)")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Total Runs")).toBeVisible();
    await expect(page.getByText("Avg Cost/Run")).toBeVisible();

    // Summary values rendered
    await expect(page.getByTestId("total-cost")).toBeVisible();
    await expect(page.getByTestId("total-runs")).toBeVisible();
    await expect(page.getByTestId("avg-cost")).toBeVisible();
  });

  test("supports usage filters, hide-cancelled toggle, reset dialog, and session history", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      ...BASE_OVERRIDES,
      get_usage_summary: { total_cost: 8.42, total_runs: 3, avg_cost_per_run: 2.81 },
      get_recent_workflow_sessions: [],
      get_agent_runs: [
        {
          agent_id: "agent-001",
          skill_name: "test-skill",
          step_id: 0,
          model: "claude-sonnet-4-5",
          started_at: "2026-03-20T12:00:00.000Z",
          total_cost: 3.12,
          input_tokens: 1000,
          output_tokens: 500,
          status: "completed",
        },
        {
          agent_id: "agent-002",
          skill_name: "other-skill",
          step_id: -10,
          model: "claude-haiku-4-5",
          started_at: "2026-03-19T09:00:00.000Z",
          total_cost: 1.1,
          input_tokens: 300,
          output_tokens: 150,
          status: "cancelled",
        },
      ],
      get_usage_by_step: [
        { step_id: 0, step_name: "Research", total_cost: 3.12, run_count: 1 },
        { step_id: -10, step_name: "Refine", total_cost: 1.1, run_count: 1 },
      ],
      get_usage_by_model: [
        { model: "Sonnet", total_cost: 3.12, run_count: 1 },
        { model: "Haiku", total_cost: 1.1, run_count: 1 },
      ],
      get_usage_by_day: [
        { day: "2026-03-19", total_cost: 1.1 },
        { day: "2026-03-20", total_cost: 3.12 },
      ],
      get_workflow_skill_names: ["other-skill", "test-skill"],
      reset_usage: undefined,
    });

    await navigateToUsageSection(page);

    await expect(page.getByText("Step History").first()).toBeVisible();
    await expect(page.getByTestId("step-table")).toBeVisible();
    await expect(page.getByText("test-skill")).toBeVisible();
    await expect(page.getByText("other-skill")).toBeVisible();

    await page.getByRole("button", { name: "30d" }).click();
    await expect(page.getByRole("button", { name: "30d" })).toHaveClass(/bg-background/);

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "test-skill" }).click();
    await expect(page.getByRole("combobox").first()).toContainText("test-skill");

    await page.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "Research", exact: true }).click();
    await expect(page.getByRole("combobox").nth(1)).toContainText("Research");

    await page.getByRole("combobox").nth(2).click();
    await page.getByRole("option", { name: "Haiku" }).click();
    await expect(page.getByRole("combobox").nth(2)).toContainText("Haiku");

    const hideCancelled = page.getByRole("checkbox", { name: "Hide cancelled runs" });
    await hideCancelled.click();
    await expect(hideCancelled).toBeChecked();

    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByRole("heading", { name: "Reset Usage Data" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Reset Usage Data" })).not.toBeVisible();

    await page.getByRole("button", { name: "Reset" }).click();
    await page.getByRole("button", { name: "Reset All Data" }).click();
    await expect(page.getByRole("heading", { name: "Reset Usage Data" })).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Step History").first()).toBeVisible();
  });
});

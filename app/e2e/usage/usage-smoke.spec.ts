import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";
import { E2E_SKILLS_PATH, E2E_WORKSPACE_PATH } from "../helpers/test-paths";

const BASE_OVERRIDES = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: E2E_WORKSPACE_PATH,
    skills_path: E2E_SKILLS_PATH,
  },
  check_workspace_path: true,
  list_skills: [],
};

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

    await page.goto("/usage");
    await waitForAppReady(page);

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

    await page.goto("/usage");
    await waitForAppReady(page);

    // Summary cards should be visible
    await expect(page.getByText("Total Spent (USD)")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Total Runs")).toBeVisible();
    await expect(page.getByText("Avg Cost/Run")).toBeVisible();

    // Summary values rendered
    await expect(page.getByTestId("total-cost")).toBeVisible();
    await expect(page.getByTestId("total-runs")).toBeVisible();
    await expect(page.getByTestId("avg-cost")).toBeVisible();
  });
});

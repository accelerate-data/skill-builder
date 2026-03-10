/**
 * E2E tests for multi-model usage tracking on the Usage page.
 *
 * Verifies that when agents use multiple models (e.g., sonnet + haiku for
 * sub-agents), the Usage tab shows accurate per-model cost breakdowns.
 *
 * VD-665: Track API spend per model when agents spawn sub-agents.
 */
import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";

// Mock data simulating multi-model usage: an agent run that used both
// sonnet (primary) and haiku (sub-agent) models.
const MULTI_MODEL_OVERRIDES = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: "/tmp/test-workspace",
    skills_path: "/tmp/test-skills",
  },
  check_workspace_path: true,
  list_skills: [],
  // Usage summary reflecting total across both models
  get_usage_summary: {
    total_cost: 2.75,
    total_runs: 3,
    avg_cost_per_run: 0.917,
  },
  // Per-model breakdown: sonnet and haiku each have separate rows
  get_usage_by_model: [
    { model: "claude-sonnet-4-520250514", total_cost: 1.85, run_count: 2 },
    { model: "claude-haiku-3-520250514", total_cost: 0.90, run_count: 1 },
  ],
  // Per-step breakdown
  get_usage_by_step: [
    { step_id: 1, step_name: "Research", total_cost: 2.75, run_count: 3 },
  ],
  // A recent session with multi-model usage
  get_recent_workflow_sessions: [
    {
      session_id: "ws-multi-model",
      skill_name: "multi-model-skill",
      min_step: 1,
      max_step: 1,
      steps_csv: "1",
      agent_count: 3,
      total_cost: 2.75,
      total_input_tokens: 80000,
      total_output_tokens: 12000,
      total_cache_read: 30000,
      total_cache_write: 5000,
      total_duration_ms: 45000,
      started_at: new Date(Date.now() - 60000).toISOString(),
      completed_at: new Date(Date.now() - 15000).toISOString(),
    },
  ],
  // Session detail: one agent produced rows for two different models
  get_session_agent_runs: [
    {
      agent_id: "agent-001",
      skill_name: "multi-model-skill",
      step_id: 1,
      model: "claude-sonnet-4-520250514",
      status: "completed",
      input_tokens: 40000,
      output_tokens: 6000,
      cache_read_tokens: 15000,
      cache_write_tokens: 2500,
      total_cost: 1.25,
      duration_ms: 20000,
      num_turns: 8,
      stop_reason: "end_turn",
      duration_api_ms: 18000,
      tool_use_count: 12,
      compaction_count: 0,
      session_id: "ws-multi-model",
      started_at: new Date(Date.now() - 60000).toISOString(),
      completed_at: new Date(Date.now() - 40000).toISOString(),
    },
    {
      agent_id: "agent-001",
      skill_name: "multi-model-skill",
      step_id: 1,
      model: "claude-haiku-3-520250514",
      status: "completed",
      input_tokens: 20000,
      output_tokens: 3000,
      cache_read_tokens: 8000,
      cache_write_tokens: 1000,
      total_cost: 0.90,
      duration_ms: 20000,
      num_turns: 8,
      stop_reason: "end_turn",
      duration_api_ms: 18000,
      tool_use_count: 12,
      compaction_count: 0,
      session_id: "ws-multi-model",
      started_at: new Date(Date.now() - 60000).toISOString(),
      completed_at: new Date(Date.now() - 40000).toISOString(),
    },
    {
      agent_id: "agent-002",
      skill_name: "multi-model-skill",
      step_id: 1,
      model: "claude-sonnet-4-520250514",
      status: "completed",
      input_tokens: 20000,
      output_tokens: 3000,
      cache_read_tokens: 7000,
      cache_write_tokens: 1500,
      total_cost: 0.60,
      duration_ms: 15000,
      num_turns: 4,
      stop_reason: "end_turn",
      duration_api_ms: 12000,
      tool_use_count: 6,
      compaction_count: 0,
      session_id: "ws-multi-model",
      started_at: new Date(Date.now() - 40000).toISOString(),
      completed_at: new Date(Date.now() - 25000).toISOString(),
    },
  ],
};

test.describe("Usage Multi-Model Tracking", { tag: "@dashboard" }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, MULTI_MODEL_OVERRIDES);
  });

  test("Cost by Model section shows both models with correct costs", async ({ page }) => {
    await page.goto("/usage");
    await waitForAppReady(page);

    // Verify the Usage page loaded with data (not empty state)
    await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();
    await expect(page.getByTestId("total-cost")).toHaveText("$2.75");
    await expect(page.getByTestId("total-runs")).toHaveText("3");

    // Verify the "Cost by Model" card is present
    await expect(page.getByText("Cost by Model")).toBeVisible();

    // Verify both models appear with their respective costs
    await expect(page.locator("[title='claude-sonnet-4-520250514']")).toBeVisible();
    await expect(page.locator("[title='claude-haiku-3-520250514']")).toBeVisible();

    // Verify per-model cost and agent counts are displayed
    await expect(page.getByText("$1.85 (2 agents)")).toBeVisible();
    await expect(page.getByText("$0.90 (1 agents)")).toBeVisible();
  });

  test("step history section renders for multi-model usage", async ({ page }) => {
    await page.goto("/usage");
    await waitForAppReady(page);

    await expect(page.getByText("Step History")).toBeVisible();
    await expect(page.getByText("No runs in this period")).toBeVisible();
  });
});

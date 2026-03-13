/**
 * E2E tests for test-store lifecycle:
 * - Phase transitions (idle → running → done)
 * - CloseGuard integration (isRunning blocks window close)
 * - Cleanup on navigation away
 */
import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";
import { emitTauriEvent, simulateAgentRun } from "../helpers/agent-simulator";

const BASE_OVERRIDES = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: "/tmp/test-workspace",
    skills_path: "/tmp/test-skills",
  },
  list_models: [],
  get_workspace_path: "/tmp/test-workspace",
  list_refinable_skills: [
    { name: "my-skill", purpose: "domain" },
  ],
  has_running_agents: false,
  prepare_skill_test: {
    test_id: "test-lifecycle-001",
    baseline_cwd: "/tmp/skill-builder-test-lifecycle/baseline",
    with_skill_cwd: "/tmp/skill-builder-test-lifecycle/with-skill",
    transcript_log_dir: "/tmp/test-workspace/my-skill/logs",
  },
  start_agent: "agent-lifecycle-mock",
  cleanup_skill_test: undefined,
  cleanup_skill_sidecar: undefined,
};

async function waitForAgentId(page: import("@playwright/test").Page, pattern: string): Promise<string> {
  await expect
    .poll(async () => page.evaluate(async (p) => {
      const { useAgentStore } = await import("/src/stores/agent-store.ts");
      const ids = Object.keys(useAgentStore.getState().runs);
      return ids.find((id) => id.includes(p)) ?? null;
    }, pattern), { timeout: 5_000 })
    .not.toBeNull();

  const agentId = await page.evaluate(async (p) => {
    const { useAgentStore } = await import("/src/stores/agent-store.ts");
    const ids = Object.keys(useAgentStore.getState().runs);
    return ids.find((id) => id.includes(p)) ?? null;
  }, pattern);
  expect(agentId).toBeTruthy();
  return agentId!;
}

async function startTestRun(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: /select a skill/i }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: /select a skill/i }).click();
  await page.getByText("my-skill").click();
  await page.getByPlaceholder("Describe a task to test the skill against...").fill("test prompt");
  await page.getByRole("button", { name: /run test/i }).click();
  await expect(page.getByRole("button", { name: /running/i })).toBeVisible({ timeout: 5_000 });
}

test.describe("Test Store Lifecycle", { tag: "@skill-tester" }, () => {
  test("test-store isRunning becomes true during test run", async ({ page }) => {
    await page.addInitScript((o) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
    }, BASE_OVERRIDES);

    await page.goto("/test");
    await waitForAppReady(page);

    // Initially, isRunning should be false
    const initialRunning = await page.evaluate(async () => {
      const { useTestStore } = await import("/src/stores/test-store.ts");
      return useTestStore.getState().isRunning;
    });
    expect(initialRunning).toBe(false);

    // Start a test run
    await startTestRun(page);

    // isRunning should now be true
    const runningDuring = await page.evaluate(async () => {
      const { useTestStore } = await import("/src/stores/test-store.ts");
      return useTestStore.getState().isRunning;
    });
    expect(runningDuring).toBe(true);
  });

  test("navigation guard blocks when test is running", async ({ page }) => {
    await page.addInitScript((o) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
    }, BASE_OVERRIDES);

    await page.goto("/test");
    await waitForAppReady(page);
    await startTestRun(page);

    // Try to navigate away
    const dashboardLink = page.locator("aside nav").getByText("Dashboard");
    await dashboardLink.click();
    await page.waitForTimeout(300);

    // Navigation guard dialog should appear
    const guardHeading = page.getByRole("heading", { name: /running|leaving/i });
    await expect(guardHeading).toBeVisible({ timeout: 5_000 });

    // Stay on the page
    await page.getByRole("button", { name: "Stay" }).click();
    await page.waitForTimeout(200);

    // Should still be on test page
    await expect(page).toHaveURL("/test");
  });

  test("test-store isRunning resets to false after full test lifecycle completes", async ({ page }) => {
    await page.addInitScript((o) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
    }, BASE_OVERRIDES);

    await page.goto("/test");
    await waitForAppReady(page);
    await startTestRun(page);

    // The test page runs 3 agents sequentially:
    // 1. with-skill plan agent
    // 2. baseline (without-skill) plan agent
    // 3. evaluator agent (auto-started when both plans complete)

    // Phase 1: Complete both plan agents
    const withId = await waitForAgentId(page, "-test-with-");
    const withoutId = await waitForAgentId(page, "-test-without-");

    await simulateAgentRun(page, {
      agentId: withId,
      messages: ["With-skill analysis..."],
      result: "With-skill complete.",
    });

    // isRunning should still be true (baseline not done)
    await page.waitForTimeout(300);
    const stillRunning = await page.evaluate(async () => {
      const { useTestStore } = await import("/src/stores/test-store.ts");
      return useTestStore.getState().isRunning;
    });
    expect(stillRunning).toBe(true);

    await simulateAgentRun(page, {
      agentId: withoutId,
      messages: ["Baseline analysis..."],
      result: "Baseline complete.",
    });

    // Phase 2: Wait for evaluator agent to be registered, then complete it
    const evalId = await waitForAgentId(page, "-test-eval-");
    await simulateAgentRun(page, {
      agentId: evalId,
      messages: ["Evaluating differences..."],
      result: "## Evaluation\n\nSkill improved output quality.",
    });

    // Phase 3: isRunning should now be false (all 3 agents done → phase "done")
    await expect.poll(async () => page.evaluate(async () => {
      const { useTestStore } = await import("/src/stores/test-store.ts");
      return useTestStore.getState().isRunning;
    }), { timeout: 5_000 }).toBe(false);
  });

  test("navigating away during idle does not trigger guard", async ({ page }) => {
    await page.addInitScript((o) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
    }, BASE_OVERRIDES);

    await page.goto("/test");
    await waitForAppReady(page);

    // Navigate away without starting a test
    const dashboardLink = page.locator("aside nav").getByText("Dashboard");
    await dashboardLink.click();

    // Should navigate directly without guard
    await expect(page).toHaveURL("/");
  });
});

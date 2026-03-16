import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";
import { emitTauriEvent, simulateAgentRun } from "../helpers/agent-simulator";
import {
  E2E_SKILLS_PATH,
  E2E_WORKSPACE_PATH,
  joinE2ePath,
} from "../helpers/test-paths";

const BASE_OVERRIDES = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: E2E_WORKSPACE_PATH,
    skills_path: E2E_SKILLS_PATH,
  },
  list_models: [],
  get_workspace_path: E2E_WORKSPACE_PATH,
  list_refinable_skills: [
    { name: "my-skill", purpose: "domain" },
  ],
  has_running_agents: false,
};

/** Poll the agent store for a run ID matching the given substring. */
async function waitForAgentId(page: import("@playwright/test").Page, pattern: string): Promise<string> {
  await expect
    .poll(async () => page.evaluate(async (p) => {
      const { useAgentStore } = await import("/src/stores/agent-store.ts");
      return Object.keys(useAgentStore.getState().runs).find((id) => id.includes(p)) ?? null;
    }, pattern), { timeout: 5_000 })
    .not.toBeNull();

  const agentId = await page.evaluate(async (p) => {
    const { useAgentStore } = await import("/src/stores/agent-store.ts");
    return Object.keys(useAgentStore.getState().runs).find((id) => id.includes(p)) ?? null;
  }, pattern);
  expect(agentId).toBeTruthy();
  return agentId!;
}

test.describe("Skill Tester", { tag: "@skill-tester" }, () => {
  test("runs test with wrapped prompt and workspace preparation", async ({ page }) => {
    await page.addInitScript((o) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
    }, {
      ...BASE_OVERRIDES,
      prepare_skill_test: {
        test_id: "test-123",
        baseline_cwd: joinE2ePath("skill-test-123", "baseline"),
        with_skill_cwd: joinE2ePath("skill-test-123", "with-skill"),
        transcript_log_dir: `${E2E_WORKSPACE_PATH}/my-skill/logs`,
      },
      start_agent: "agent-id-mock",
    });

    await page.goto("/test");
    await waitForAppReady(page);

    // Wait for skill picker to finish loading
    await page.getByRole("button", { name: /select a skill/i }).waitFor({ timeout: 10_000 });

    // Select skill
    await page.getByRole("button", { name: /select a skill/i }).click();
    await page.getByText("my-skill").click();

    // Verify skill was selected
    await expect(page.getByRole("button", { name: /my-skill/i })).toBeVisible();

    // Enter prompt
    await page.getByPlaceholder("Describe a task to test the skill against...").fill("build a customer model");

    // Run test button should now be enabled
    const runButton = page.getByRole("button", { name: /run test/i });
    await expect(runButton).toBeEnabled();

    // Run test
    await runButton.click();

    // Verify the page transitions to running state (button changes to "Running")
    await expect(page.getByRole("button", { name: /running/i })).toBeVisible({ timeout: 5_000 });
  });

  test("streaming content shows tool_use and text blocks as they arrive", async ({ page }) => {
    await page.addInitScript((o) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
    }, {
      ...BASE_OVERRIDES,
      prepare_skill_test: {
        test_id: "test-stream-456",
        baseline_cwd: joinE2ePath("skill-test-456", "baseline"),
        with_skill_cwd: joinE2ePath("skill-test-456", "with-skill"),
        transcript_log_dir: `${E2E_WORKSPACE_PATH}/my-skill/logs`,
      },
      start_agent: "agent-id-stream",
    });

    await page.goto("/test");
    await waitForAppReady(page);

    await page.getByRole("button", { name: /select a skill/i }).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: /select a skill/i }).click();
    await page.getByText("my-skill").click();
    await page.getByPlaceholder("Describe a task to test the skill against...").fill("analyze customer churn");
    await page.getByRole("button", { name: /run test/i }).click();

    // Wait for running state
    await expect(page.getByRole("button", { name: /running/i })).toBeVisible({ timeout: 5_000 });

    // Emit a tool_use block followed by a text block to the with-skill agent
    const withId = await waitForAgentId(page, "-test-with-");
    await emitTauriEvent(page, "agent-init-progress", {
      agent_id: withId,
      stage: "init_start",
      timestamp: Date.now(),
    });

    // Emit tool call display item
    await emitTauriEvent(page, "agent-message", {
      agent_id: withId,
      message: {
        type: "display_item",
        item: {
          id: "di-tool-1",
          type: "tool_call",
          timestamp: Date.now(),
          toolName: "Read",
          toolSummary: "Reading schema.md",
          toolStatus: "completed",
        },
      },
    });

    // tool_use header (tool name) should be visible in collapsed state
    await expect(page.getByText("Read").last()).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText("Reading schema.md").last()).toBeVisible({ timeout: 3_000 });

    // Emit an output display item
    await emitTauriEvent(page, "agent-message", {
      agent_id: withId,
      message: {
        type: "display_item",
        item: {
          id: "di-output-1",
          type: "output",
          timestamp: Date.now(),
          outputText: "The schema has 12 columns including churn_flag.",
        },
      },
    });

    // Text content should be immediately visible (not collapsed)
    await expect(page.getByText("The schema has 12 columns including churn_flag.").last()).toBeVisible({ timeout: 3_000 });
  });

  test("full test run shows completion panel with eval lines and recommendations", async ({ page }) => {
    await page.addInitScript((o) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
    }, {
      ...BASE_OVERRIDES,
      prepare_skill_test: {
        test_id: "test-done-789",
        baseline_cwd: joinE2ePath("skill-test-789", "baseline"),
        with_skill_cwd: joinE2ePath("skill-test-789", "with-skill"),
        transcript_log_dir: `${E2E_WORKSPACE_PATH}/my-skill/logs`,
      },
      start_agent: "agent-id-done",
      cleanup_skill_test: undefined,
    });

    await page.goto("/test");
    await waitForAppReady(page);

    // Select skill and start test
    await page.getByRole("button", { name: /select a skill/i }).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: /select a skill/i }).click();
    await page.getByText("my-skill").click();
    await page.getByPlaceholder("Describe a task to test the skill against...").fill("build a model");
    await page.getByRole("button", { name: /run test/i }).click();
    await expect(page.getByRole("button", { name: /running/i })).toBeVisible({ timeout: 5_000 });

    // Discover both plan agent IDs
    const withId = await waitForAgentId(page, "-test-with-");
    const withoutId = await waitForAgentId(page, "-test-without-");

    // Complete both plan agents
    await simulateAgentRun(page, {
      agentId: withId,
      messages: ["Built customer churn model with 95% accuracy."],
      result: "Plan A complete.",
    });
    await simulateAgentRun(page, {
      agentId: withoutId,
      messages: ["Built basic model with default parameters."],
      result: "Plan B complete.",
    });

    // Wait for evaluator agent to be registered (phase → evaluating)
    const evalId = await waitForAgentId(page, "-test-eval-");

    // Complete the evaluator with structured directional output + recommendations
    const evalOutput = [
      "↑ **Skill context** improved domain accuracy",
      "↓ **Response length** was longer than baseline",
      "→ **Code quality** was comparable",
    ].join("\n");
    const evalRecommendations = "Consider adding concise output guidelines to the skill.";

    await simulateAgentRun(page, {
      agentId: evalId,
      messages: [`${evalOutput}\n\n## Recommendations\n\n${evalRecommendations}`],
      result: "Evaluation complete.",
    });

    // Assert done-phase UI
    await expect(page.getByText("completed")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Skill context")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText("Response length")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText("Recommendations")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole("button", { name: "Refine skill" })).toBeVisible({ timeout: 3_000 });
  });

  test("run test button is disabled without skill selected", async ({ page }) => {
    await page.addInitScript((o) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
    }, BASE_OVERRIDES);

    await page.goto("/test");
    await waitForAppReady(page);

    // Wait for skill picker to finish loading
    await page.getByRole("button", { name: /select a skill/i }).waitFor({ timeout: 10_000 });

    // Run Test button should be disabled when no skill is selected
    const runButton = page.getByRole("button", { name: /run test/i });
    await expect(runButton).toBeDisabled();

    // Enter prompt but no skill — still disabled
    await page.getByPlaceholder("Describe a task to test the skill against...").fill("build a customer model");
    await expect(runButton).toBeDisabled();
  });
});

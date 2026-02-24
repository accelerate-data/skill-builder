import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";

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
};

test.describe("Skill Tester", { tag: "@skill-tester" }, () => {
  test("runs test with wrapped prompt and workspace preparation", async ({ page }) => {
    await page.addInitScript((o) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
    }, {
      ...BASE_OVERRIDES,
      prepare_skill_test: {
        test_id: "test-123",
        baseline_cwd: "/tmp/skill-builder-test-123/baseline",
        with_skill_cwd: "/tmp/skill-builder-test-123/with-skill",
        transcript_log_dir: "/tmp/test-workspace/my-skill/logs",
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

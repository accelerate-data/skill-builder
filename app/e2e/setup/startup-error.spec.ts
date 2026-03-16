import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";
import { simulateAgentInitError } from "../helpers/agent-simulator";
import { E2E_SKILLS_PATH, E2E_WORKSPACE_PATH } from "../helpers/test-paths";
import { WORKFLOW_OVERRIDES } from "../helpers/workflow-helpers";

test.describe("Startup Error (agent-init-error)", { tag: "@setup" }, () => {
  test("shows error dialog when agent-init-error fires on workflow page", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, WORKFLOW_OVERRIDES);

    await page.goto("/skill/test-skill");
    await waitForAppReady(page);
    await page.getByText("Workflow Steps").waitFor({ timeout: 10_000 });

    // Simulate the agent-init-error event firing (e.g. Node.js not found)
    await simulateAgentInitError(page, {
      errorType: "node_missing",
      message: "Node.js could not be found on your system.",
      fixHint: "Install Node.js 18+ from https://nodejs.org",
    });

    // RuntimeErrorDialog should appear with the error message
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Node.js could not be found on your system.")).toBeVisible();
    await expect(page.getByText("Install Node.js 18+ from https://nodejs.org")).toBeVisible();
  });

  test("shows spawn_failed error dialog with correct title", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      ...WORKFLOW_OVERRIDES,
      get_settings: {
        anthropic_api_key: "sk-ant-test",
        workspace_path: E2E_WORKSPACE_PATH,
        skills_path: E2E_SKILLS_PATH,
      },
    });

    await page.goto("/skill/test-skill");
    await waitForAppReady(page);
    await page.getByText("Workflow Steps").waitFor({ timeout: 10_000 });

    await simulateAgentInitError(page, {
      errorType: "spawn_failed",
      message: "The agent runtime process failed to start.",
      fixHint: "Check that the sidecar bundle exists at sidecar/dist/agent-runner.js",
    });

    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Failed to Start Agent Runtime")).toBeVisible();
    await expect(page.getByText("The agent runtime process failed to start.")).toBeVisible();

    // Dismiss the dialog
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});

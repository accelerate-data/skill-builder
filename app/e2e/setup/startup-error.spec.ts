import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";
import { simulateAgentInitError } from "../helpers/agent-simulator";
import { WORKFLOW_OVERRIDES } from "../helpers/workflow-helpers";

test.describe("Startup Error (agent-init-error)", { tag: "@setup" }, () => {
  test("shows error dialog when agent-init-error fires on workflow page", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, WORKFLOW_OVERRIDES);

    await page.goto("/workflow/301");
    await waitForAppReady(page);
    await page.getByText("STEPS").waitFor({ timeout: 10_000 });

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
});

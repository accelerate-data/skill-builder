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

test.describe("Reconciliation Notification", { tag: "@dashboard" }, () => {
  test("shows reconciliation dialog when startup returns notifications", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      ...BASE_OVERRIDES,
      reconcile_startup: {
        orphans: [],
        notifications: [
          "Removed stale lock for skill: old-skill",
          "Cleaned up 2 orphaned workflow sessions",
        ],
        auto_cleaned: 2,
        discovered_skills: [],
      },
    });

    await page.goto("/");
    await waitForAppReady(page);

    // ReconciliationAckDialog should appear with the title
    await expect(page.getByText("Startup Reconciliation")).toBeVisible({ timeout: 5_000 });

    // Both notification messages should be visible in the list
    await expect(page.getByText("Removed stale lock for skill: old-skill")).toBeVisible();
    await expect(page.getByText("Cleaned up 2 orphaned workflow sessions")).toBeVisible();
  });

  test("reconciliation dialog can be acknowledged", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      ...BASE_OVERRIDES,
      reconcile_startup: {
        orphans: [],
        notifications: ["Removed stale lock for skill: old-skill"],
        auto_cleaned: 1,
        discovered_skills: [],
      },
      record_reconciliation_cancel: undefined,
    });

    await page.goto("/");
    await waitForAppReady(page);

    // Dialog should be open
    await expect(page.getByText("Startup Reconciliation")).toBeVisible({ timeout: 5_000 });

    // Notifications trigger requireApply — button says "Apply Reconciliation"
    await page.getByRole("button", { name: "Apply Reconciliation" }).click();

    // Dialog should close
    await expect(page.getByText("Startup Reconciliation")).not.toBeVisible({ timeout: 5_000 });
  });
});

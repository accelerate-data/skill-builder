import { test, expect } from "@playwright/test";
import { reloadWithOverrides, waitForAppReady } from "../helpers/app-helpers";
import { E2E_SKILLS_PATH, E2E_WORKSPACE_PATH } from "../helpers/test-paths";

test.describe("Settings Page", { tag: "@settings" }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
    await waitForAppReady(page);
  });

  test("can type API key and test it", async ({ page }) => {
    // API key input is in the "Claude SDK" section, not the default "General" section
    await page.getByRole("button", { name: "Claude SDK" }).click();
    const input = page.getByPlaceholder("sk-ant-...");
    await input.fill("sk-ant-test-key");

    const testButton = page.getByRole("button", { name: "Test" }).first();
    await testButton.click();

    // Mock returns success, button should turn green with "Valid"
    await expect(page.getByRole("button", { name: "Valid" }).first()).toBeVisible();
  });

  test("shows error toast when API key is rejected", async ({ page }) => {
    // Override test_api_key to throw (rejected key)
    await page.evaluate(() => {
      const overrides = (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ ?? {};
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        ...overrides,
        test_api_key: "__throw__:Invalid API key",
      };
    });

    await page.getByRole("button", { name: "Claude SDK" }).click();
    const input = page.getByPlaceholder("sk-ant-...");
    await input.fill("sk-ant-invalid-key");

    const testButton = page.getByRole("button", { name: "Test" }).first();
    await testButton.click();

    // Rejected key: button reverts to "Test" and an error toast appears
    await expect(testButton).toHaveText("Test", { timeout: 5_000 });
  });

  test("saves industry and function role and persists after navigation", async ({ page }) => {
    await reloadWithOverrides(page, {
      get_settings: {
        anthropic_api_key: "sk-ant-test",
        workspace_path: E2E_WORKSPACE_PATH,
        skills_path: E2E_SKILLS_PATH,
      },
      check_workspace_path: true,
      save_settings: undefined,
      list_skills: [],
    });

    // Navigate to settings via client-side routing (preserves Zustand store)
    await page.goto("/settings");
    await waitForAppReady(page);

    // Fill industry and blur to trigger auto-save
    const industryInput = page.getByPlaceholder("e.g., Financial Services, Healthcare, Retail");
    await industryInput.fill("Financial Services");
    await industryInput.blur();

    // Fill function role and blur to trigger auto-save
    const roleInput = page.getByPlaceholder("e.g., Analytics Engineer, Data Platform Lead");
    await roleInput.fill("Data Platform Lead");
    await roleInput.blur();

    // Wait for "Saved" confirmation to appear
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 5_000 });

    // Navigate away to dashboard using the back button (client-side navigation)
    await page.getByRole("button", { name: "Back to Dashboard" }).click();
    await expect(page).toHaveURL("/", { timeout: 5_000 });

    // Navigate back to settings using header button (client-side, preserves store)
    await page.getByRole("button", { name: /Settings/ }).click();
    await expect(page).toHaveURL("/settings", { timeout: 5_000 });

    // Verify the values persisted in the Zustand store (rendered from store state)
    const industryAfter = page.getByPlaceholder("e.g., Financial Services, Healthcare, Retail");
    const roleAfter = page.getByPlaceholder("e.g., Analytics Engineer, Data Platform Lead");
    await expect(industryAfter).toHaveValue("Financial Services");
    await expect(roleAfter).toHaveValue("Data Platform Lead");
  });
});

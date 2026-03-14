import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";

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

  test("shows invalid state when API key is rejected", async ({ page }) => {
    // Override test_api_key to return false (invalid key)
    await page.evaluate(() => {
      const overrides = (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ ?? {};
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        ...overrides,
        test_api_key: false,
      };
    });

    await page.getByRole("button", { name: "Claude SDK" }).click();
    const input = page.getByPlaceholder("sk-ant-...");
    await input.fill("sk-ant-invalid-key");

    const testButton = page.getByRole("button", { name: "Test" }).first();
    await testButton.click();

    // Mock returns false, button should show invalid/error state
    await expect(page.getByRole("button", { name: "Invalid" }).first()).toBeVisible();
  });
});

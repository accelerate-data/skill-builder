import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";

test.describe("Settings Page", { tag: "@settings" }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
    await waitForAppReady(page);
  });

  test("can type API key and test it", async ({ page }) => {
    const input = page.getByPlaceholder("sk-ant-...");
    await input.fill("sk-ant-test-key");

    const testButton = page.getByRole("button", { name: "Test" }).first();
    await testButton.click();

    // Mock returns success, button should turn green with "Valid"
    await expect(page.getByRole("button", { name: "Valid" }).first()).toBeVisible();
  });

  test("GitHub account shows sign-in button when not logged in", async ({ page }) => {
    // Switch to GitHub section
    await page.getByRole("button", { name: /GitHub/i }).click();

    // Default mock returns github_get_user: null — user is not logged in
    await expect(page.getByText("GitHub Account", { exact: true })).toBeVisible();
    await expect(page.getByText("Not connected")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
  });

  test("settings auto-save shows saved indicator", async ({ page }) => {
    // Change the API key field and blur to trigger auto-save
    const input = page.getByPlaceholder("sk-ant-...");
    await input.fill("sk-ant-new-key");
    await input.blur();

    // Auto-save should show "Saved" indicator near the header
    await expect(page.getByText("Saved")).toBeVisible();
  });

  test("shows Marketplace Registries section in Marketplace tab", async ({ page }) => {
    // Switch to Marketplace section
    await page.getByRole("button", { name: /Marketplace/i }).click();

    // Registries card should be visible
    await expect(page.getByText("Registries", { exact: true })).toBeVisible();
  });
});

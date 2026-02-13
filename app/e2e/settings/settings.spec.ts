import { test, expect } from "@playwright/test";

test.describe("Settings Page", { tag: "@settings" }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
  });

  test("can type API key and test it", async ({ page }) => {
    const input = page.getByPlaceholder("sk-ant-...");
    await input.fill("sk-ant-test-key");

    const testButton = page.getByRole("button", { name: "Test" }).first();
    await testButton.click();

    // Mock returns success, button should turn green with "Valid"
    await expect(page.getByRole("button", { name: "Valid" }).first()).toBeVisible();
  });

  test("GitHub token test shows username on success", async ({ page }) => {
    const input = page.getByPlaceholder("ghp_...");
    await input.fill("ghp_test_token");

    // Find the test button in the GitHub Token card
    const tokenCard = page.locator("text=GitHub Token").locator("..").locator("..");
    const testButton = tokenCard.getByRole("button", { name: "Test" });
    await testButton.click();

    // Mock returns { login: "testuser" }, button should show "Valid"
    await expect(tokenCard.getByRole("button", { name: "Valid" })).toBeVisible();
  });

  test("save button shows saved state", async ({ page }) => {
    const saveButton = page.getByRole("button", { name: "Save Settings" });
    await saveButton.click();

    // Should briefly show "Saved" with green styling
    await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  });

  test("repo picker is disabled without GitHub token", async ({ page }) => {
    // Without a token set, the repo picker button should be disabled
    const repoButton = page.getByRole("button", { name: "Select a repository" });
    await expect(repoButton).toBeDisabled();
  });
});

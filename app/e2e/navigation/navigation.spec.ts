import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";

test.describe("Navigation", { tag: "@navigation" }, () => {
  test("loads the dashboard by default", async ({ page }) => {
    await page.goto("/");
    await waitForAppReady(page);
    // Dashboard should be visible (sidebar has Dashboard link)
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Settings/i })).toBeVisible();
  });

  test("theme toggle switches between system, light, and dark", async ({ page }) => {
    // Theme toggle is on the Settings page (Appearance card)
    await page.goto("/settings");
    await waitForAppReady(page);

    // Find theme toggle buttons
    const lightButton = page.getByRole("button", { name: "Light" });
    const darkButton = page.getByRole("button", { name: "Dark" });
    const systemButton = page.getByRole("button", { name: "System" });

    await expect(lightButton).toBeVisible();
    await expect(darkButton).toBeVisible();
    await expect(systemButton).toBeVisible();

    // Click dark mode
    await darkButton.click();
    // The html element should have class "dark"
    await expect(page.locator("html")).toHaveClass(/dark/);

    // Click light mode
    await lightButton.click();
    await expect(page.locator("html")).toHaveClass(/light/);
  });
});

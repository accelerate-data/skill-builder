import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";

test.describe("Navigation", { tag: "@navigation" }, () => {
  test("loads the dashboard by default", async ({ page }) => {
    await page.goto("/");
    await waitForAppReady(page);
    // Sidebar has "Skill Library" nav link (dashboard was renamed)
    await expect(page.getByRole("link", { name: "Skill Library" })).toBeVisible();
    // Settings is an icon button in the header (no text label, use title attribute)
    await expect(page.locator("header button[title*='Settings']")).toBeVisible();
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

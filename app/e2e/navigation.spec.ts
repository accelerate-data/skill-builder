import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("loads the dashboard by default", async ({ page }) => {
    await page.goto("/");
    // Dashboard should be visible (sidebar has Dashboard link)
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  });

  test("sidebar links navigate between pages", async ({ page }) => {
    await page.goto("/");

    // Navigate to settings (use exact match to avoid matching "Open Settings" button)
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings/);

    // Navigate back to dashboard
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("active sidebar link is highlighted", async ({ page }) => {
    await page.goto("/settings");
    const settingsLink = page.getByRole("link", { name: "Settings", exact: true });
    // The active link has bg-sidebar-accent class
    await expect(settingsLink).toHaveClass(/bg-sidebar-accent/);
  });

  test("theme toggle switches between system, light, and dark", async ({ page }) => {
    await page.goto("/");

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

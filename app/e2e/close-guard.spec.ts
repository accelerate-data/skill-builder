import { test, expect } from "@playwright/test";

/**
 * Close Guard E2E Tests
 *
 * LIMITATION: The CloseGuard component relies on `@tauri-apps/api/event` (listen)
 * and `@tauri-apps/api/window` (getCurrentWindow), which are NOT aliased/mocked
 * in the E2E vite config. Only `@tauri-apps/api/core` (invoke) is mocked.
 *
 * This means we cannot trigger the close-requested event flow in E2E tests.
 * The component will silently fail to register the event listener since the
 * Tauri runtime is not present.
 *
 * These tests verify what IS testable: that the component renders without
 * crashing and that the page is functional despite the missing Tauri runtime.
 *
 * Full close-guard behavior is tested via unit tests in:
 *   src/__tests__/components/close-guard.test.tsx
 */
test.describe("Close Guard", () => {
  test("app loads without errors despite CloseGuard event listener failure", async ({
    page,
  }) => {
    // CloseGuard is mounted in AppLayout. If it crashes, the whole app breaks.
    await page.goto("/");
    await page.waitForTimeout(500);

    // App should still render normally
    await expect(page.getByRole("heading", { name: "Skill Builder" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  });

  test("navigation works with CloseGuard mounted", async ({ page }) => {
    await page.goto("/");

    // Navigate to settings
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings/);

    // Navigate back
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("no close dialog is visible on normal page load", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(500);

    // Close guard dialog should not be present
    await expect(page.getByText("Agents Still Running")).not.toBeVisible();
  });
});

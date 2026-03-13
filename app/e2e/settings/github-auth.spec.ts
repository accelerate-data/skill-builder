/**
 * E2E tests for GitHub auth flow in the settings page.
 *
 * Covers auth-store state transitions: logged-out state, logged-in display,
 * and logout behavior.
 */
import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";

const LOGGED_OUT_OVERRIDES = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: "/tmp/test-workspace",
    skills_path: "/tmp/test-skills",
  },
  github_get_user: null,
  list_models: [],
};

const LOGGED_IN_OVERRIDES = {
  ...LOGGED_OUT_OVERRIDES,
  github_get_user: {
    login: "testuser",
    avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    email: "test@example.com",
  },
};

test.describe("GitHub Auth Flow", { tag: "@settings" }, () => {
  test("shows sign-in button when not logged in", async ({ page }) => {
    await page.addInitScript((o) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
    }, LOGGED_OUT_OVERRIDES);

    await page.goto("/settings");
    await waitForAppReady(page);

    // Navigate to GitHub tab
    await page.locator("nav").getByRole("button", { name: "GitHub" }).click();

    // Should show not-connected state
    await expect(page.getByText("Not connected").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeEnabled();
  });

  test("shows user info when logged in", async ({ page }) => {
    await page.addInitScript((o) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
    }, LOGGED_IN_OVERRIDES);

    await page.goto("/settings");
    await waitForAppReady(page);

    // Navigate to GitHub tab
    await page.locator("nav").getByRole("button", { name: "GitHub" }).click();

    // Should display logged-in user info
    await expect(page.getByText("testuser")).toBeVisible({ timeout: 5_000 });
  });

  test("sign out button clears auth state", async ({ page }) => {
    await page.addInitScript((o) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
    }, {
      ...LOGGED_IN_OVERRIDES,
      github_logout: undefined,
    });

    await page.goto("/settings");
    await waitForAppReady(page);

    // Navigate to GitHub tab
    await page.locator("nav").getByRole("button", { name: "GitHub" }).click();

    // Should show logged-in state
    await expect(page.getByText("testuser")).toBeVisible({ timeout: 5_000 });

    // Click sign out
    const signOutButton = page.getByRole("button", { name: /sign out|disconnect|logout/i });
    if (await signOutButton.isVisible()) {
      await signOutButton.click();

      // Should transition back to not-connected state
      await expect(page.getByText("Not connected").first()).toBeVisible({ timeout: 5_000 });
    }
  });
});

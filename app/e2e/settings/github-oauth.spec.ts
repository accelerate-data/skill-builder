import { test, expect } from "@playwright/test";
import { reloadWithOverrides } from "../helpers/app-helpers";
import { BASE_SETTINGS_OVERRIDES } from "../helpers/settings-helpers";

const DEVICE_FLOW_OVERRIDES: Record<string, unknown> = {
  ...BASE_SETTINGS_OVERRIDES,
  github_get_user: null,
  github_start_device_flow: {
    device_code: "DEVICE-CODE-E2E",
    user_code: "ABCD-1234",
    verification_uri: "https://github.com/login/device",
    expires_in: 900,
    interval: 0, // poll fires instantly in setTimeout(fn, 0)
  },
  github_poll_for_token: { status: "pending" },
  update_github_identity: undefined,
};

const OAUTH_SUCCESS_OVERRIDES: Record<string, unknown> = {
  ...DEVICE_FLOW_OVERRIDES,
  github_poll_for_token: {
    status: "success",
    user: {
      login: "testuser",
      avatar_url: "https://avatars.example.com/1",
      email: "test@example.com",
    },
  },
};

const LOGGED_IN_OVERRIDES: Record<string, unknown> = {
  ...BASE_SETTINGS_OVERRIDES,
  github_get_user: {
    login: "testuser",
    avatar_url: "https://avatars.example.com/1",
    email: "test@example.com",
  },
  github_logout: undefined,
};

test.describe("GitHub OAuth", { tag: "@settings" }, () => {
  test("shows device code after clicking Sign in", async ({ page }) => {
    await reloadWithOverrides(page, DEVICE_FLOW_OVERRIDES);
    await page.goto("/settings");
    const { waitForAppReady } = await import("../helpers/app-helpers");
    await waitForAppReady(page);

    // Navigate to GitHub section
    await page.getByRole("button", { name: "GitHub" }).click();

    // Click Sign in
    await page.getByRole("button", { name: "Sign in with GitHub" }).click();

    // Dialog should open and show the device code
    await expect(page.getByText("ABCD-1234")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Copy your device code")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open GitHub" })).toBeVisible();
  });

  test("polling UI shows waiting state after clicking Open GitHub", async ({ page }) => {
    await reloadWithOverrides(page, DEVICE_FLOW_OVERRIDES);
    await page.goto("/settings");
    const { waitForAppReady } = await import("../helpers/app-helpers");
    await waitForAppReady(page);

    await page.getByRole("button", { name: "GitHub" }).click();
    await page.getByRole("button", { name: "Sign in with GitHub" }).click();
    await expect(page.getByText("ABCD-1234")).toBeVisible({ timeout: 10_000 });

    // Click Open GitHub to start polling
    await page.getByRole("button", { name: "Open GitHub" }).click();

    // Should show polling state
    await expect(page.getByText("Waiting for authorization...")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("ABCD-1234")).toBeVisible();
  });

  test("successful OAuth login shows success state", async ({ page }) => {
    await reloadWithOverrides(page, OAUTH_SUCCESS_OVERRIDES);
    await page.goto("/settings");
    const { waitForAppReady } = await import("../helpers/app-helpers");
    await waitForAppReady(page);

    await page.getByRole("button", { name: "GitHub" }).click();
    await page.getByRole("button", { name: "Sign in with GitHub" }).click();
    await expect(page.getByText("ABCD-1234")).toBeVisible({ timeout: 10_000 });

    // Click Open GitHub — poll returns success immediately (interval: 0)
    await page.getByRole("button", { name: "Open GitHub" }).click();

    // Should show success (must assert before 1500ms auto-close)
    await expect(page.getByText("Signed in successfully")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Welcome, testuser")).toBeVisible();
  });

  test("shows logged-in user profile when already connected", async ({ page }) => {
    await reloadWithOverrides(page, LOGGED_IN_OVERRIDES);
    await page.goto("/settings");
    const { waitForAppReady } = await import("../helpers/app-helpers");
    await waitForAppReady(page);

    await page.getByRole("button", { name: "GitHub" }).click();

    // Should show the connected badge and user profile
    await expect(page.getByText("Connected")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("@testuser")).toBeVisible();
    await expect(page.getByText("test@example.com")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign Out" })).toBeVisible();
  });

  test("logout clears user profile", async ({ page }) => {
    await reloadWithOverrides(page, LOGGED_IN_OVERRIDES);
    await page.goto("/settings");
    const { waitForAppReady } = await import("../helpers/app-helpers");
    await waitForAppReady(page);

    await page.getByRole("button", { name: "GitHub" }).click();
    await expect(page.getByText("@testuser")).toBeVisible({ timeout: 5_000 });

    // Click Sign Out
    await page.getByRole("button", { name: "Sign Out" }).click();

    // Should show disconnected state (use role to avoid matching both badge and paragraph)
    await expect(page.getByRole("paragraph").filter({ hasText: "Not connected" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
  });
});

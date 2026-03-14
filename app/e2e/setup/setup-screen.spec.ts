import { test, expect } from "@playwright/test";

test.describe("Setup Screen", { tag: "@workflow" }, () => {
  test("shows setup screen when API key is missing", async ({ page }) => {
    // Override settings to have no API key
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: null,
          workspace_path: null,
          skills_path: "/tmp/e2e-skills",
          preferred_model: null,
          log_level: "info",
        },
      };
    });

    await page.goto("/");
    const splash = page.getByTestId("splash-screen");
    await splash.waitFor({ state: "attached", timeout: 5_000 });
    await splash.waitFor({ state: "detached", timeout: 10_000 });

    // Setup screen should appear
    await expect(page.getByTestId("setup-screen")).toBeVisible();
    await expect(page.getByText("Welcome to Skill Builder")).toBeVisible();
    await expect(page.getByLabel("Anthropic API Key")).toBeVisible();
    await expect(page.getByLabel("Skills Folder")).toBeVisible();
  });

  test("completing setup navigates to dashboard", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: null,
          workspace_path: null,
          skills_path: null,
          preferred_model: null,
          log_level: "info",
        },
        get_default_skills_path: "/tmp/default-skills",
      };
    });

    await page.goto("/");
    const splash = page.getByTestId("splash-screen");
    await splash.waitFor({ state: "attached", timeout: 5_000 });
    await splash.waitFor({ state: "detached", timeout: 10_000 });

    // Fill both fields
    await page.getByLabel("Anthropic API Key").fill("sk-ant-test");
    await page.getByRole("button", { name: "Get Started" }).click();

    // Setup screen should disappear, skill library page should load
    await expect(page.getByTestId("setup-screen")).not.toBeVisible({ timeout: 5_000 });
    // Sidebar has "Dashboard" nav link.
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  });

});

import { test, expect } from "@playwright/test";
import { E2E_DEFAULT_SKILLS_PATH, E2E_SKILLS_PATH } from "../helpers/test-paths";

test.describe("Setup Screen", { tag: "@setup" }, () => {
  test("does not show setup screen when only API key is missing", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      get_settings: {
        model_settings: null,
        workspace_path: null,
        skills_path: E2E_SKILLS_PATH,
        log_level: "info",
      },
    });

    await page.goto("/");
    const splash = page.getByTestId("splash-screen");
    await splash.waitFor({ state: "attached", timeout: 5_000 });
    await splash.waitFor({ state: "detached", timeout: 10_000 });

    await expect(page.getByTestId("setup-screen")).not.toBeVisible();
    await expect(page.getByText("Skills").first()).toBeVisible();
  });

  test("completing setup navigates to dashboard", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      get_settings: {
        model_settings: null,
        workspace_path: null,
        skills_path: null,
        log_level: "info",
      },
      get_default_skills_path: E2E_DEFAULT_SKILLS_PATH,
    });

    await page.goto("/");
    const splash = page.getByTestId("splash-screen");
    await splash.waitFor({ state: "attached", timeout: 5_000 });
    await splash.waitFor({ state: "detached", timeout: 10_000 });

    await page.getByRole("button", { name: "Get Started" }).click();

    // Setup screen should disappear, dashboard should load
    await expect(page.getByTestId("setup-screen")).not.toBeVisible({ timeout: 5_000 });
    // Sidebar shows the Skills panel header.
    await expect(page.getByText("Skills").first()).toBeVisible();
  });

});

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

  test("shows setup screen when skills path is missing", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          workspace_path: null,
          skills_path: null,
          preferred_model: null,
          log_level: "info",
        },
      };
    });

    await page.goto("/");
    const splash = page.getByTestId("splash-screen");
    await splash.waitFor({ state: "attached", timeout: 5_000 });
    await splash.waitFor({ state: "detached", timeout: 10_000 });

    await expect(page.getByTestId("setup-screen")).toBeVisible();
  });

  test("skips setup screen when both settings are configured", async ({ page }) => {
    // Default E2E mock has both api_key and skills_path set
    await page.goto("/");
    const splash = page.getByTestId("splash-screen");
    await splash.waitFor({ state: "attached", timeout: 5_000 });
    await splash.waitFor({ state: "detached", timeout: 10_000 });

    // Setup screen should NOT appear, skill library page should load
    await expect(page.getByTestId("setup-screen")).not.toBeVisible();
    // Sidebar has "Skill Library" nav link (previously "Skills")
    await expect(page.getByRole("link", { name: "Skill Library" })).toBeVisible();
  });

  test("Get Started button is disabled until both fields are filled", async ({ page }) => {
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

    const getStarted = page.getByRole("button", { name: "Get Started" });

    // Default skills path is pre-populated, but API key is empty → disabled
    await expect(getStarted).toBeDisabled();

    // Type API key
    await page.getByLabel("Anthropic API Key").fill("sk-ant-test");
    await expect(getStarted).toBeEnabled();
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
    // Sidebar has "Skill Library" nav link (previously "Skills")
    await expect(page.getByRole("link", { name: "Skill Library" })).toBeVisible();
  });

  test("Test button validates API key", async ({ page }) => {
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

    await page.getByLabel("Anthropic API Key").fill("sk-ant-test");
    await page.getByRole("button", { name: "Test" }).click();

    // Mock returns success, button should show "Valid"
    await expect(page.getByRole("button", { name: "Valid" })).toBeVisible();
  });
});

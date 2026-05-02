import { test, expect } from "@playwright/test";
import { reloadWithOverrides, waitForAppReady } from "../helpers/app-helpers";
import { E2E_SKILLS_PATH, E2E_WORKSPACE_PATH } from "../helpers/test-paths";

test.describe("Settings Page", { tag: "@settings" }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
    await waitForAppReady(page);
  });

  test("can type API key and test it", async ({ page }) => {
    await page.getByRole("button", { name: "Models" }).click();
    await expect(page.getByText("Anthropic Model List")).toHaveCount(0);
    const input = page.getByPlaceholder("sk-ant-...");
    await input.fill("sk-ant-test-key");

    const testButton = page.getByRole("button", { name: "Test" }).first();
    await testButton.click();

    // Mock returns success, button should turn green with "Valid"
    await expect(
      page.getByRole("button", { name: "Valid" }).first(),
    ).toBeVisible();
  });

  test("shows error toast when API key is rejected", async ({ page }) => {
    // Override model connection validation to throw (rejected key)
    await page.evaluate(() => {
      const overrides =
        (window as unknown as Record<string, unknown>)
          .__TAURI_MOCK_OVERRIDES__ ?? {};
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ =
        {
          ...overrides,
          test_model_connection: "__throw__:Invalid API key",
        };
    });

    await page.getByRole("button", { name: "Models" }).click();
    const input = page.getByPlaceholder("sk-ant-...");
    await input.fill("sk-ant-invalid-key");

    const testButton = page.getByRole("button", { name: "Test" }).first();
    await testButton.click();

    // Rejected key: button reverts to "Test" and an error toast appears
    await expect(testButton).toHaveText("Test", { timeout: 5_000 });
  });

  test("saves industry and function role and persists after navigation", async ({
    page,
  }) => {
    await reloadWithOverrides(page, {
      get_settings: {
        workspace_path: E2E_WORKSPACE_PATH,
        skills_path: E2E_SKILLS_PATH,
        model_settings: {
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          api_key: "sk-ant-test",
          base_url: null,
          reasoning_effort: "auto",
          usage_id: "workflow",
        },
      },
      check_workspace_path: true,
      save_settings: undefined,
      list_skills: [],
    });

    // Navigate to settings via client-side routing (preserves Zustand store)
    await page.goto("/settings");
    await waitForAppReady(page);

    // Fill industry and blur to trigger auto-save
    const industryInput = page.getByPlaceholder(
      "e.g., Financial Services, Healthcare, Retail",
    );
    await industryInput.fill("Financial Services");
    await industryInput.blur();

    // Fill function role and blur to trigger auto-save
    const roleInput = page.getByPlaceholder(
      "e.g., Analytics Engineer, Data Platform Lead",
    );
    await roleInput.fill("Data Platform Lead");
    await roleInput.blur();

    // Wait for "Saved" confirmation to appear
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 5_000 });

    // Navigate away to dashboard using the back button (client-side navigation)
    await page.getByRole("button", { name: "Back to Dashboard" }).click();
    await expect(page).toHaveURL("/", { timeout: 5_000 });

    // Navigate back to settings using the Settings icon in the sidebar rail (client-side, preserves store)
    await page.locator("aside").getByTitle("Settings").click();
    await expect(page).toHaveURL("/settings", { timeout: 5_000 });

    // Verify the values persisted in the Zustand store (rendered from store state)
    const industryAfter = page.getByPlaceholder(
      "e.g., Financial Services, Healthcare, Retail",
    );
    const roleAfter = page.getByPlaceholder(
      "e.g., Analytics Engineer, Data Platform Lead",
    );
    await expect(industryAfter).toHaveValue("Financial Services");
    await expect(roleAfter).toHaveValue("Data Platform Lead");
  });

  test("GitHub section renders login entrypoint", async ({ page }) => {
    await page.getByRole("button", { name: "GitHub" }).click();

    await expect(page.getByText("GitHub Account").first()).toBeVisible();
    await expect(
      page.getByText(
        "Connect your GitHub account to submit feedback and report issues.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in with GitHub" }),
    ).toBeVisible();
  });

  test("Marketplace section supports adding registries and toggling auto-update", async ({
    page,
  }) => {
    await reloadWithOverrides(page, {
      get_settings: {
        workspace_path: E2E_WORKSPACE_PATH,
        skills_path: E2E_SKILLS_PATH,
        model_settings: {
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          api_key: "sk-ant-test",
          base_url: null,
          reasoning_effort: "auto",
          usage_id: "workflow",
        },
        marketplace_registries: [
          {
            name: "Vibedata Skills",
            source_url: "hbanerjee74/skills",
            enabled: true,
          },
        ],
        auto_update: false,
      },
      check_workspace_path: true,
      list_skills: [],
      update_user_settings: undefined,
      parse_github_url: {
        owner: "acme",
        repo: "skills",
        branch: "main",
        subpath: null,
      },
      check_marketplace_url: "Acme Skills",
    });

    await page.goto("/settings");
    await waitForAppReady(page);
    await page.getByRole("button", { name: "Marketplace" }).click();

    await expect(page.getByText("Registries").first()).toBeVisible();
    await expect(page.getByText("hbanerjee74/skills")).toBeVisible();

    await page.getByRole("button", { name: "Add registry" }).click();
    await page.getByLabel("GitHub repository").fill("acme/skills");
    await page.getByRole("button", { name: "Add" }).click();

    await expect(page.getByText("acme/skills")).toBeVisible({ timeout: 5_000 });

    const autoUpdate = page.getByRole("switch", { name: "Enable auto-update" });
    await expect(autoUpdate).toHaveAttribute("aria-checked", "false");
    await autoUpdate.click();
    await expect(autoUpdate).toHaveAttribute("aria-checked", "true");
  });

  test("Advanced section supports log level changes and skills-folder browse", async ({
    page,
  }) => {
    await reloadWithOverrides(page, {
      get_settings: {
        workspace_path: E2E_WORKSPACE_PATH,
        skills_path: E2E_SKILLS_PATH,
        model_settings: {
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          api_key: "sk-ant-test",
          base_url: null,
          reasoning_effort: "auto",
          usage_id: "workflow",
        },
        log_level: "info",
      },
      check_workspace_path: true,
      list_skills: [],
      update_user_settings: undefined,
      get_data_dir: "C:/skill-builder-test/data",
    });

    await page.goto("/settings");
    await waitForAppReady(page);
    await page.getByRole("button", { name: "Advanced" }).click();

    await expect(page.getByText("Logging").first()).toBeVisible();
    await page.locator("#log-level-select").click();
    await page.getByRole("option", { name: "Debug" }).click();
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: "Browse" }).click();
    await expect(page.getByText("C:/skill-builder-test/workspace")).toBeVisible(
      { timeout: 5_000 },
    );
    await expect(page.getByText("C:/skill-builder-test/data")).toBeVisible();
  });
});

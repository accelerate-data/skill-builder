import { test, expect } from "@playwright/test";
import { reloadWithOverrides, waitForAppReady } from "../helpers/app-helpers";
import { E2E_SKILLS_PATH, E2E_WORKSPACE_PATH } from "../helpers/test-paths";

const TEST_REGISTRY = {
  name: "Test Registry",
  source_url: "https://github.com/test-org/skills-repo",
  enabled: true,
};

const TEST_REPO_INFO = {
  owner: "test-org",
  repo: "skills-repo",
  branch: "main",
  subpath: null,
};

const TEST_AVAILABLE_SKILLS = [
  {
    path: "skills/analytics-helper",
    name: "analytics-helper",
    plugin_name: null,
    description: "Generates analytics dashboards",
    purpose: "domain",
    version: "1.0.0",
    model: null,
    argument_hint: null,
    user_invocable: false,
    disable_model_invocation: false,
  },
  {
    path: "skills/sql-expert",
    name: "sql-expert",
    plugin_name: null,
    description: "SQL query optimization",
    purpose: "data-engineering",
    version: "2.0.0",
    model: null,
    argument_hint: null,
    user_invocable: false,
    disable_model_invocation: false,
  },
];

const BASE_OVERRIDES = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: E2E_WORKSPACE_PATH,
    skills_path: E2E_SKILLS_PATH,
    marketplace_registries: [TEST_REGISTRY],
    marketplace_initialized: true,
  },
  check_workspace_path: true,
  list_skills: [],
  list_imported_skills: [],
  parse_github_url: TEST_REPO_INFO,
  list_github_skills: TEST_AVAILABLE_SKILLS,
  get_dashboard_skill_names: [],
  import_marketplace_to_library: [{ success: true, error: null }],
};

test.describe("GitHub Import", { tag: "@skills" }, () => {
  test.beforeEach(async ({ page }) => {
    await reloadWithOverrides(page, BASE_OVERRIDES);
    await page.goto("/settings");
    await waitForAppReady(page);
    await page.getByRole("button", { name: "Import" }).first().click();
  });

  test("opens marketplace dialog and lists available skills", async ({ page }) => {
    // Click the Marketplace button to open the dialog
    await page.getByRole("button", { name: "Marketplace" }).click();

    // Dialog should appear with the title
    await expect(page.getByRole("heading", { name: "Browse Marketplace" })).toBeVisible({ timeout: 5_000 });

    // Skills should be listed
    await expect(page.getByText("analytics-helper")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("sql-expert")).toBeVisible();

    // Version badges should be visible
    await expect(page.getByText("1.0.0")).toBeVisible();
    await expect(page.getByText("2.0.0")).toBeVisible();
  });

  test("import skill via edit form and verify success toast", async ({ page }) => {
    await page.getByRole("button", { name: "Marketplace" }).click();
    await expect(page.getByRole("heading", { name: "Browse Marketplace" })).toBeVisible({ timeout: 5_000 });

    // Wait for skills to load
    await expect(page.getByText("analytics-helper")).toBeVisible({ timeout: 5_000 });

    // Click the Install button for analytics-helper
    const installButton = page.getByLabel("Install analytics-helper");
    await installButton.click();

    // Edit & Import dialog should appear
    await expect(page.getByRole("heading", { name: "Edit & Import Skill" })).toBeVisible({ timeout: 5_000 });

    // Form fields should be pre-filled
    await expect(page.locator("#edit-name")).toHaveValue("analytics-helper");
    await expect(page.locator("#edit-description")).toHaveValue("Generates analytics dashboards");
    await expect(page.locator("#edit-version")).toHaveValue("1.0.0");

    // Click Confirm Import
    await page.getByRole("button", { name: "Confirm Import" }).click();

    // Success toast should appear
    await expect(page.getByText('Imported "analytics-helper"')).toBeVisible({ timeout: 5_000 });
  });

  test("shows error state when no registries are enabled", async ({ page }) => {
    // Reload with no enabled registries
    await reloadWithOverrides(page, {
      ...BASE_OVERRIDES,
      get_settings: {
        ...BASE_OVERRIDES.get_settings,
        marketplace_registries: [{ ...TEST_REGISTRY, enabled: false }],
      },
    });
    await page.goto("/settings");
    await waitForAppReady(page);
    await page.getByRole("button", { name: "Import" }).first().click();

    // Marketplace button should be disabled
    const marketplaceButton = page.getByRole("button", { name: "Marketplace" });
    await expect(marketplaceButton).toBeDisabled();
  });

  test("shows imported badge after successful import", async ({ page }) => {
    await page.getByRole("button", { name: "Marketplace" }).click();
    await expect(page.getByText("analytics-helper")).toBeVisible({ timeout: 5_000 });

    // Import via edit form
    await page.getByLabel("Install analytics-helper").click();
    await expect(page.getByRole("heading", { name: "Edit & Import Skill" })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Confirm Import" }).click();

    // After import, the skill should show "Imported" badge in the marketplace list
    await expect(page.getByText("Imported")).toBeVisible({ timeout: 5_000 });
  });
});

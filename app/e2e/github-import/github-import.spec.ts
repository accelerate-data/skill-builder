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

const TEST_AVAILABLE_PLUGINS = [
  {
    path: "plugins/analytics-pack",
    name: "analytics-pack",
    description: "Generates analytics dashboards",
    version: "1.0.0",
    skill_count: 0,
    skill_names: [],
  },
  {
    path: "plugins/sql-pack",
    name: "sql-pack",
    description: "SQL query optimization",
    version: "2.0.0",
    skill_count: 0,
    skill_names: [],
  },
];

function pluginInstallButton(
  page: import("@playwright/test").Page,
  pluginName: string,
) {
  return page.getByLabel(`Install ${pluginName}`);
}

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
  list_github_plugins: TEST_AVAILABLE_PLUGINS,
  import_marketplace_plugin_to_library: [{ success: true, error: null }],
  check_marketplace_updates: { library: [], workspace: [], registry_names: [] },
  check_skill_customized: false,
  reconcile_startup: { orphans: [], notifications: [], auto_cleaned: 0, discovered_skills: [] },
};

function marketplaceActionButton(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: "Marketplace" }).filter({ has: page.locator("svg") });
}

test.describe("GitHub Import", { tag: "@skills" }, () => {
  test.beforeEach(async ({ page }) => {
    await reloadWithOverrides(page, BASE_OVERRIDES);
    await page.goto("/settings");
    await waitForAppReady(page);
    await page.getByRole("navigation").getByRole("button", { name: "Import" }).click();
  });

  test("opens marketplace dialog and lists available plugins", async ({ page }) => {
    await marketplaceActionButton(page).click();
    await expect(page.getByRole("heading", { name: "Browse Marketplace" })).toBeVisible({ timeout: 10_000 });

    await expect(pluginInstallButton(page, "analytics-pack")).toBeVisible({ timeout: 10_000 });
    await expect(pluginInstallButton(page, "sql-pack")).toBeVisible();
    await expect(page.getByText("1.0.0")).toBeVisible();
    await expect(page.getByText("2.0.0")).toBeVisible();
  });

  test("import plugin and verify success toast", async ({ page }) => {
    await marketplaceActionButton(page).click();
    await expect(page.getByRole("heading", { name: "Browse Marketplace" })).toBeVisible({ timeout: 10_000 });
    await expect(pluginInstallButton(page, "analytics-pack")).toBeVisible({ timeout: 10_000 });

    await pluginInstallButton(page, "analytics-pack").click();

    await expect(page.getByText('Imported plugin "analytics-pack"')).toBeVisible({ timeout: 5_000 });
  });

  test("shows error state when no registries are enabled", async ({ page }) => {
    await reloadWithOverrides(page, {
      ...BASE_OVERRIDES,
      get_settings: {
        ...BASE_OVERRIDES.get_settings,
        marketplace_registries: [{ ...TEST_REGISTRY, enabled: false }],
      },
    });
    await page.goto("/settings");
    await waitForAppReady(page);
    await page.getByRole("navigation").getByRole("button", { name: "Import" }).click();

    await expect(marketplaceActionButton(page)).toBeDisabled();
  });

  test("shows imported badge after successful import", async ({ page }) => {
    await marketplaceActionButton(page).click();
    await expect(pluginInstallButton(page, "analytics-pack")).toBeVisible({ timeout: 10_000 });

    await pluginInstallButton(page, "analytics-pack").click();

    await expect(page.getByText("Imported", { exact: true })).toBeVisible({ timeout: 5_000 });
  });
});

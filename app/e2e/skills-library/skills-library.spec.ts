import { test, expect } from "@playwright/test";
import { reloadWithOverrides, waitForAppReady } from "../helpers/app-helpers";
import { E2E_SKILLS_PATH, E2E_WORKSPACE_PATH } from "../helpers/test-paths";

const SAMPLE_PLUGINS = [
  {
    id: 1,
    slug: "skills",
    display_name: "Skills",
    version: null,
    source_type: "synthetic",
    source_url: null,
    is_default: true,
  },
  {
    id: 2,
    slug: "analytics-pack",
    display_name: "Analytics Pack",
    version: "1.0.0",
    source_type: "marketplace",
    source_url: "https://github.com/test-org/skills-repo",
    is_default: false,
  },
  {
    id: 3,
    slug: "sql-pack",
    display_name: "SQL Pack",
    version: "2.1.0",
    source_type: "local",
    source_url: null,
    is_default: false,
  },
];

const BASE_OVERRIDES = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: E2E_WORKSPACE_PATH,
    skills_path: E2E_SKILLS_PATH,
  },
  check_workspace_path: true,
  list_plugins: SAMPLE_PLUGINS,
  list_imported_skills: [],
  list_skills: [],
  check_marketplace_updates: { library: [], workspace: [], registry_names: [] },
  check_skill_customized: false,
  reconcile_startup: { orphans: [], notifications: [], auto_cleaned: 0, discovered_skills: [] },
};

test.describe("Skills Library", { tag: "@skills" }, () => {
  test.beforeEach(async ({ page }) => {
    await reloadWithOverrides(page, BASE_OVERRIDES);
    await page.goto("/settings");
    await waitForAppReady(page);
    await page.getByRole("button", { name: "Plugins" }).first().click();
  });

  test("lists plugins with name, version, and source", async ({ page }) => {
    // Non-default plugins should be visible
    await expect(page.getByText("Analytics Pack")).toBeVisible();
    await expect(page.getByText("SQL Pack")).toBeVisible();

    // Version should be visible
    await expect(page.getByText("1.0.0")).toBeVisible();
    await expect(page.getByText("2.1.0")).toBeVisible();

    // Source info should be visible
    await expect(page.getByText("https://github.com/test-org/skills-repo")).toBeVisible();
    await expect(page.getByText("local")).toBeVisible();
  });

  test("default plugin is hidden from the list", async ({ page }) => {
    // The default "Skills" plugin should NOT appear
    // (displayPlugins filters out is_default)
    await expect(page.getByText("Analytics Pack")).toBeVisible();
    // The table should only show 2 rows (non-default plugins)
    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(2);
  });

  test("delete plugin triggers delete and refreshes list", async ({ page }) => {
    await reloadWithOverrides(page, {
      ...BASE_OVERRIDES,
      delete_plugin: undefined,
    });
    await page.goto("/settings");
    await waitForAppReady(page);
    await page.getByRole("button", { name: "Plugins" }).first().click();

    const deleteButton = page.getByLabel("Delete Analytics Pack");
    await deleteButton.click();

    await expect(page.getByText('Deleted plugin "Analytics Pack"')).toBeVisible({ timeout: 5_000 });
  });

  test("Create Plugin button opens dialog and submits", async ({ page }) => {
    await reloadWithOverrides(page, {
      ...BASE_OVERRIDES,
      create_plugin_from_skills: "my-plugin",
    });
    await page.goto("/settings");
    await waitForAppReady(page);
    await page.getByRole("button", { name: "Plugins" }).first().click();

    await page.getByRole("button", { name: /Create Plugin/ }).click();
    await expect(page.getByRole("heading", { name: "Create Plugin" })).toBeVisible({ timeout: 5_000 });

    // Create button should be disabled with empty name
    await expect(page.getByRole("button", { name: "Create" })).toBeDisabled();

    // Type a valid name using the input's placeholder and submit
    await page.getByPlaceholder("my-plugin").fill("my-plugin");
    await expect(page.getByRole("button", { name: "Create" })).not.toBeDisabled();
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByText('Created plugin "my-plugin"')).toBeVisible({ timeout: 5_000 });
  });

  test("shows empty state when no plugins", async ({ page }) => {
    await reloadWithOverrides(page, {
      ...BASE_OVERRIDES,
      list_plugins: [SAMPLE_PLUGINS[0]], // Only the default plugin
    });
    await page.goto("/settings");
    await waitForAppReady(page);
    await page.getByRole("button", { name: "Plugins" }).first().click();

    await expect(page.getByText("No plugins")).toBeVisible();
    await expect(
      page.getByText("Browse the marketplace or upload a plugin package to get started.")
    ).toBeVisible();
  });
});

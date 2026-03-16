import { test, expect } from "@playwright/test";
import { reloadWithOverrides, waitForAppReady } from "../helpers/app-helpers";
import { E2E_SKILLS_PATH, E2E_WORKSPACE_PATH } from "../helpers/test-paths";

const SAMPLE_SKILLS = [
  {
    skill_id: "skill-001",
    skill_name: "analytics-helper",
    description: "Generates analytics dashboards",
    is_active: true,
    disk_path: `${E2E_SKILLS_PATH}/analytics-helper`,
    imported_at: new Date().toISOString(),
    is_bundled: false,
    purpose: "domain",
    version: "1.0.0",
    model: null,
    argument_hint: null,
    user_invocable: null,
    disable_model_invocation: null,
    marketplace_source_url: null,
  },
  {
    skill_id: "skill-002",
    skill_name: "sql-expert",
    description: "SQL query optimization",
    is_active: false,
    disk_path: `${E2E_SKILLS_PATH}/sql-expert`,
    imported_at: new Date().toISOString(),
    is_bundled: true,
    purpose: "data-engineering",
    version: "2.1.0",
    model: null,
    argument_hint: null,
    user_invocable: null,
    disable_model_invocation: null,
    marketplace_source_url: null,
  },
];

const BASE_OVERRIDES = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: E2E_WORKSPACE_PATH,
    skills_path: E2E_SKILLS_PATH,
  },
  check_workspace_path: true,
  list_imported_skills: SAMPLE_SKILLS,
  toggle_skill_active: undefined,
  delete_imported_skill: undefined,
  list_skills: [],
};

test.describe("Skills Library", { tag: "@skills" }, () => {
  test.beforeEach(async ({ page }) => {
    await reloadWithOverrides(page, BASE_OVERRIDES);
    // Navigate to settings → Import tab
    await page.goto("/settings");
    await waitForAppReady(page);
    await page.getByRole("button", { name: "Import" }).first().click();
  });

  test("lists imported skills with name, version, and source", async ({ page }) => {
    // Both skills should be visible
    await expect(page.getByText("analytics-helper")).toBeVisible();
    await expect(page.getByText("sql-expert")).toBeVisible();

    // Version badges should be visible
    await expect(page.getByText("1.0.0")).toBeVisible();
    await expect(page.getByText("2.1.0")).toBeVisible();

    // Source labels should be visible (both are "file" since no marketplace_source_url)
    const sourceLabels = page.getByText("file");
    await expect(sourceLabels.first()).toBeVisible();
  });

  test("delete button visible for non-bundled skill and hidden for bundled", async ({ page }) => {
    // Non-bundled skill (analytics-helper) should have a delete button
    const deleteAnalytics = page.getByLabel("Delete analytics-helper");
    await expect(deleteAnalytics).toBeVisible();

    // Bundled skill (sql-expert) should NOT have a delete button
    const deleteSqlExpert = page.getByLabel("Delete sql-expert");
    await expect(deleteSqlExpert).not.toBeVisible();
  });

  test("delete skill triggers delete and refreshes list", async ({ page }) => {
    const deleteButton = page.getByLabel("Delete analytics-helper");
    await deleteButton.click();

    // After clicking delete, a success toast should appear
    await expect(page.getByText('Deleted "analytics-helper"')).toBeVisible({ timeout: 5_000 });
  });

  test("shows empty state when no imported skills", async ({ page }) => {
    // Reload with empty skills list
    await reloadWithOverrides(page, {
      ...BASE_OVERRIDES,
      list_imported_skills: [],
    });
    await page.goto("/settings");
    await waitForAppReady(page);
    await page.getByRole("button", { name: "Import" }).first().click();

    await expect(page.getByText("No imported skills")).toBeVisible();
    await expect(
      page.getByText("Import a .skill package or browse the marketplace to add skills.")
    ).toBeVisible();
  });
});

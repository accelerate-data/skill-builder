import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";
import { E2E_SKILLS_PATH, E2E_WORKSPACE_PATH } from "../helpers/test-paths";

const WORKSPACE_OVERRIDES = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: E2E_WORKSPACE_PATH,
    skills_path: E2E_SKILLS_PATH,
  },
  check_workspace_path: true,
  list_skills: [],
};

test.describe("Dashboard Smoke", { tag: "@dashboard" }, () => {
  async function reloadDashboardWithOverrides(
    page: import("@playwright/test").Page,
    overrides: Record<string, unknown>,
  ) {
    await page.addInitScript((nextOverrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = nextOverrides;
    }, overrides);
    await page.goto("/");
    await waitForAppReady(page);
  }

  test.beforeEach(async ({ page }) => {
    await reloadDashboardWithOverrides(page, WORKSPACE_OVERRIDES);
  });

  test("shows empty state when workspace configured but no skills", async ({ page }) => {
    await expect(page.getByText("No skills yet")).toBeVisible();
    await expect(
      page.getByText("Create your first skill to get started.")
    ).toBeVisible();
  });

  test("New Skill button visible when workspace configured", async ({ page }) => {
    const newSkillButton = page.getByRole("button", { name: /new skill/i }).first();
    await expect(newSkillButton).toBeVisible();
  });

  test("clicking a skill card navigates to the workflow page", async ({ page }) => {
    await reloadDashboardWithOverrides(page, {
      get_settings: {
        anthropic_api_key: "sk-ant-test",
        workspace_path: E2E_WORKSPACE_PATH,
        skills_path: E2E_SKILLS_PATH,
      },
      check_workspace_path: true,
      list_skills: [
        {
          name: "my-skill",
          purpose: "domain",
          current_step: null,
          status: null,
          last_modified: null,
        },
      ],
    });

    await page.getByText("my-skill").click();
    await expect(page).toHaveURL(/\/skill\/my-skill/);
  });

  test("can submit create skill form", async ({ page }) => {
    const newSkillButton = page.getByRole("button", { name: /new skill/i }).first();
    await newSkillButton.click();

    // Step 1: Fill skill name + select purpose + description (all required to advance)
    await page.getByRole("textbox", { name: "Skill Name" }).fill("hr-analytics");
    await page.getByRole("combobox", { name: /what are you trying to capture/i }).click();
    await page.getByRole("option", { name: /business process knowledge/i }).click();
    await page.getByRole("textbox", { name: "Description" }).fill("HR analytics skill for workforce data.");

    // Next button should now be enabled — wait for it, then advance to Step 2
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled({ timeout: 3_000 });
    await page.getByRole("button", { name: "Next" }).click();

    // Step 2: Create button is available
    const createButton = page.getByRole("button", { name: "Create" });
    await expect(createButton).toBeEnabled();
    await createButton.click();

    // Dialog should close (mock returns success) or navigate away
    await expect(page.getByRole("heading", { name: "Create New Skill" })).not.toBeVisible({ timeout: 5_000 });
  });

  test("can confirm skill deletion", async ({ page }) => {
    await reloadDashboardWithOverrides(page, {
      get_settings: {
        anthropic_api_key: "sk-ant-test",
        workspace_path: E2E_WORKSPACE_PATH,
        skills_path: E2E_SKILLS_PATH,
      },
      check_workspace_path: true,
      list_skills: [
        {
          name: "delete-me",
          purpose: "domain",
          current_step: null,
          status: null,
          last_modified: null,
        },
      ],
      delete_skill: undefined,
    });

    // Open delete dialog
    const deleteButton = page.locator("button").filter({ has: page.locator("svg.lucide-trash-2") });
    await deleteButton.click();

    // Confirm deletion
    const confirmButton = page.getByRole("button", { name: "Delete" });
    await confirmButton.click();

    // Dialog should close
    await expect(page.getByRole("heading", { name: "Delete Skill" })).not.toBeVisible();
  });
});

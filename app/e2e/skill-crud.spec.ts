import { test, expect } from "@playwright/test";

test.describe("Skill CRUD", () => {
  test.beforeEach(async ({ page }) => {
    // Configure a workspace so the dashboard shows the New Skill button
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          github_token: "ghp_test",
          github_repo: "testuser/my-skills",
          workspace_path: "/tmp/test-workspace",
          auto_commit: false,
          auto_push: false,
        },
        check_workspace_path: true,
        list_skills: [],
      };
    });
    await page.goto("/");
    // Wait for settings to hydrate
    await page.waitForTimeout(500);
  });

  test("shows New Skill button when workspace is configured", async ({ page }) => {
    const newSkillButton = page.getByRole("button", { name: /new skill/i });
    await expect(newSkillButton).toBeVisible();
  });

  test("opens create skill dialog and fills form", async ({ page }) => {
    // Click the header New Skill button
    const newSkillButton = page.getByRole("button", { name: /new skill/i }).first();
    await newSkillButton.click();

    // Dialog should appear
    await expect(page.getByRole("heading", { name: "Create New Skill" })).toBeVisible();

    // Fill domain
    const domainInput = page.getByLabel("Domain");
    await domainInput.fill("sales pipeline");

    // Skill name should auto-derive
    const nameInput = page.getByLabel("Skill Name");
    await expect(nameInput).toHaveValue("sales-pipeline");
  });

  test("can submit create skill form", async ({ page }) => {
    const newSkillButton = page.getByRole("button", { name: /new skill/i }).first();
    await newSkillButton.click();

    await page.getByLabel("Domain").fill("HR analytics");
    await expect(page.getByLabel("Skill Name")).toHaveValue("hr-analytics");

    // Submit
    const createButton = page.getByRole("button", { name: "Create" });
    await expect(createButton).toBeEnabled();
    await createButton.click();

    // Dialog should close (mock returns success)
    await expect(page.getByRole("heading", { name: "Create New Skill" })).not.toBeVisible();
  });

  test("create button is disabled without domain", async ({ page }) => {
    const newSkillButton = page.getByRole("button", { name: /new skill/i }).first();
    await newSkillButton.click();

    const createButton = page.getByRole("button", { name: "Create" });
    await expect(createButton).toBeDisabled();
  });

  test("shows skill cards when skills exist", async ({ page }) => {
    // Override with skills data
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          github_token: "ghp_test",
          github_repo: "testuser/my-skills",
          workspace_path: "/tmp/test-workspace",
          auto_commit: false,
          auto_push: false,
        },
        check_workspace_path: true,
        list_skills: [
          {
            name: "sales-pipeline",
            domain: "Sales",
            current_step: "Step 3",
            status: "in_progress",
            last_modified: new Date().toISOString(),
          },
        ],
      };
    });
    await page.goto("/");
    await page.waitForTimeout(500);

    // Skill card should show the formatted name
    await expect(page.getByText("Sales Pipeline")).toBeVisible();
    await expect(page.getByText("Sales")).toBeVisible();
    await expect(page.getByText("In Progress")).toBeVisible();
  });

  test("can open delete dialog from skill card", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          github_token: "ghp_test",
          github_repo: "testuser/my-skills",
          workspace_path: "/tmp/test-workspace",
          auto_commit: false,
          auto_push: false,
        },
        check_workspace_path: true,
        list_skills: [
          {
            name: "my-skill",
            domain: "Testing",
            current_step: null,
            status: null,
            last_modified: null,
          },
        ],
      };
    });
    await page.goto("/");
    await page.waitForTimeout(500);

    // Click the delete icon button on the skill card
    const deleteButton = page.locator("button").filter({ has: page.locator("svg.lucide-trash-2") });
    await deleteButton.click();

    // Delete confirmation dialog should appear
    await expect(page.getByRole("heading", { name: "Delete Skill" })).toBeVisible();
    await expect(page.getByText("my-skill")).toBeVisible();
  });

  test("can confirm skill deletion", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          github_token: "ghp_test",
          github_repo: "testuser/my-skills",
          workspace_path: "/tmp/test-workspace",
          auto_commit: false,
          auto_push: false,
        },
        check_workspace_path: true,
        list_skills: [
          {
            name: "delete-me",
            domain: "Test",
            current_step: null,
            status: null,
            last_modified: null,
          },
        ],
        delete_skill: undefined,
      };
    });
    await page.goto("/");
    await page.waitForTimeout(500);

    // Open delete dialog
    const deleteButton = page.locator("button").filter({ has: page.locator("svg.lucide-trash-2") });
    await deleteButton.click();

    // Confirm deletion
    const confirmButton = page.getByRole("button", { name: "Delete" });
    await confirmButton.click();

    // Dialog should close
    await expect(page.getByRole("heading", { name: "Delete Skill" })).not.toBeVisible();
  });

  test("can cancel delete dialog", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          github_token: "ghp_test",
          github_repo: "testuser/my-skills",
          workspace_path: "/tmp/test-workspace",
          auto_commit: false,
          auto_push: false,
        },
        check_workspace_path: true,
        list_skills: [
          {
            name: "keep-me",
            domain: "Test",
            current_step: null,
            status: null,
            last_modified: null,
          },
        ],
      };
    });
    await page.goto("/");
    await page.waitForTimeout(500);

    // Open delete dialog
    const deleteButton = page.locator("button").filter({ has: page.locator("svg.lucide-trash-2") });
    await deleteButton.click();

    // Cancel
    await page.getByRole("button", { name: "Cancel" }).click();

    // Dialog should close, skill card should remain
    await expect(page.getByRole("heading", { name: "Delete Skill" })).not.toBeVisible();
    await expect(page.getByText("Keep Me")).toBeVisible();
  });
});

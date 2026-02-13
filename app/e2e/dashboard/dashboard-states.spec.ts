import { test, expect } from "@playwright/test";

test.describe("Dashboard States", { tag: "@dashboard" }, () => {
  test("shows empty state with settings link when no workspace configured", async ({ page }) => {
    // Default mock has workspace_path: null
    await page.goto("/");
    await page.waitForTimeout(500);

    // Should show "No skills yet" empty state
    await expect(page.getByText("No skills yet")).toBeVisible();
    await expect(
      page.getByText("Configure a workspace path in Settings to get started.")
    ).toBeVisible();

    // Should show a link to Settings
    await expect(page.getByRole("link", { name: "Open Settings" })).toBeVisible();
  });

  test("shows empty state with create button when workspace is configured but no skills", async ({
    page,
  }) => {
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
    await page.waitForTimeout(500);

    await expect(page.getByText("No skills yet")).toBeVisible();
    await expect(
      page.getByText("Create your first skill to get started.")
    ).toBeVisible();

    // New Skill button should be available
    const newSkillButtons = page.getByRole("button", { name: /new skill/i });
    await expect(newSkillButtons.first()).toBeVisible();
  });

  test("shows workspace warning when path does not exist", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          github_token: null,
          github_repo: null,
          workspace_path: "/nonexistent/path",
          auto_commit: false,
          auto_push: false,
        },
        check_workspace_path: false,
        list_skills: [],
      };
    });
    await page.goto("/");
    await page.waitForTimeout(500);

    await expect(page.getByText("Workspace folder not found")).toBeVisible();
    await expect(
      page.getByText("The configured workspace path no longer exists on disk.")
    ).toBeVisible();

    // Open Settings button in the warning
    await expect(page.getByRole("button", { name: "Open Settings" })).toBeVisible();
  });

  test("does not show workspace warning when path exists", async ({ page }) => {
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
    await page.waitForTimeout(500);

    await expect(page.getByText("Workspace folder not found")).not.toBeVisible();
  });

  test("clicking Continue navigates to workflow page", async ({ page }) => {
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

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/skill\/my-skill/);
  });

  test("no New Skill button when workspace is not configured", async ({ page }) => {
    // Default mock has workspace_path: null
    await page.goto("/");
    await page.waitForTimeout(500);

    // The header area should NOT have a New Skill button
    // (only the empty state card has an Open Settings link)
    const headerButtons = page.locator(".flex.items-center.justify-between").first();
    await expect(headerButtons.getByRole("button", { name: /new skill/i })).not.toBeVisible();
  });
});

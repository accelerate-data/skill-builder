import { test, expect } from "@playwright/test";

test.describe("Dashboard States", () => {
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

  test("shows skill grid with multiple skills", async ({ page }) => {
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
            current_step: "Step 5",
            status: "in_progress",
            last_modified: new Date().toISOString(),
          },
          {
            name: "hr-analytics",
            domain: "Human Resources",
            current_step: "Step 10",
            status: "completed",
            last_modified: new Date().toISOString(),
          },
          {
            name: "customer-support",
            domain: "Support",
            current_step: "Step 2",
            status: "waiting_for_user",
            last_modified: new Date().toISOString(),
          },
        ],
      };
    });
    await page.goto("/");
    await page.waitForTimeout(500);

    // All three skill names should appear (formatted from kebab-case)
    await expect(page.getByText("Sales Pipeline")).toBeVisible();
    await expect(page.getByText("Hr Analytics")).toBeVisible();
    await expect(page.getByText("Customer Support")).toBeVisible();

    // Status badges
    await expect(page.getByText("In Progress")).toBeVisible();
    await expect(page.getByText("Completed")).toBeVisible();
    await expect(page.getByText("Needs Input")).toBeVisible();

    // Domain badges
    await expect(page.getByText("Sales")).toBeVisible();
    await expect(page.getByText("Human Resources")).toBeVisible();
    await expect(page.getByText("Support")).toBeVisible();

    // Each card should have a Continue button
    const continueButtons = page.getByRole("button", { name: "Continue" });
    await expect(continueButtons).toHaveCount(3);
  });

  test("skill cards show progress bar based on step", async ({ page }) => {
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
            name: "test-skill",
            domain: "Test",
            current_step: "Step 5",
            status: "in_progress",
            last_modified: null,
          },
        ],
      };
    });
    await page.goto("/");
    await page.waitForTimeout(500);

    // Step 5 should show 50% progress
    await expect(page.getByText("50%")).toBeVisible();
    await expect(page.getByText("Step 5")).toBeVisible();
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

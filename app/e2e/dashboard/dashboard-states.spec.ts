import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";

test.describe("Dashboard States", { tag: "@dashboard" }, () => {
  test("shows empty state with create button when workspace and skills path are configured", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          workspace_path: "/tmp/test-workspace",
          skills_path: "/tmp/test-skills",
        },
        check_workspace_path: true,
        list_skills: [],
      };
    });
    await page.goto("/");
    await waitForAppReady(page);

    await expect(page.getByText("No skills yet")).toBeVisible();
    await expect(
      page.getByText("Create your first skill to get started.")
    ).toBeVisible();

    // New Skill button should be available (requires both workspacePath and skillsPath)
    const newSkillButtons = page.getByRole("button", { name: /new skill/i });
    await expect(newSkillButtons.first()).toBeVisible();
  });

  test("does not show workspace warning when path exists", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          workspace_path: "/tmp/test-workspace",
          skills_path: "/tmp/test-skills",
        },
        check_workspace_path: true,
        list_skills: [],
      };
    });
    await page.goto("/");
    await waitForAppReady(page);

    await expect(page.getByText("Workspace folder not found")).not.toBeVisible();
  });

  test("clicking skill card navigates to workflow page", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          workspace_path: "/tmp/test-workspace",
          skills_path: "/tmp/test-skills",
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
    await waitForAppReady(page);

    // Skill card shows the raw kebab-case name
    await page.getByText("my-skill").click();
    await expect(page).toHaveURL(/\/skill\/my-skill/);
  });

  test("no New Skill button when workspace is not configured", async ({ page }) => {
    // Default mock has workspace_path: null
    await page.goto("/");
    await waitForAppReady(page);

    // The header area should NOT have a New Skill button
    // (only the empty state card has an Open Settings link)
    const headerButtons = page.locator(".flex.items-center.justify-between").first();
    await expect(headerButtons.getByRole("button", { name: /new skill/i })).not.toBeVisible();
  });
});

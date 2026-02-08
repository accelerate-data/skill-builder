import { test, expect } from "@playwright/test";

const mockFiles = [
  {
    name: "SKILL.md",
    relative_path: "SKILL.md",
    absolute_path: "/tmp/test-workspace/my-skill/SKILL.md",
    is_directory: false,
    is_readonly: false,
    size_bytes: 1024,
  },
  {
    name: "workflow.md",
    relative_path: "workflow.md",
    absolute_path: "/tmp/test-workspace/my-skill/workflow.md",
    is_directory: false,
    is_readonly: true,
    size_bytes: 512,
  },
  {
    name: "clarifications.md",
    relative_path: "context/clarifications.md",
    absolute_path: "/tmp/test-workspace/my-skill/context/clarifications.md",
    is_directory: false,
    is_readonly: true,
    size_bytes: 2048,
  },
];

const settingsWithWorkspace = {
  anthropic_api_key: "sk-ant-test",
  github_token: "ghp_test",
  github_repo: "testuser/my-skills",
  workspace_path: "/tmp/test-workspace",
  auto_commit: false,
  auto_push: false,
};

test.describe("Editor Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(
      ([files, settings]) => {
        (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
          get_settings: settings,
          check_workspace_path: true,
          list_skill_files: files,
          read_file: "# My Skill\n\nThis is the skill content.",
          save_raw_file: undefined,
          git_file_status: [],
        };
      },
      [mockFiles, settingsWithWorkspace] as const
    );
    await page.goto("/skill/my-skill/editor");
    await page.waitForTimeout(500);
  });

  test("shows the editor page with skill name in toolbar", async ({ page }) => {
    await expect(page.getByText("my-skill")).toBeVisible();
  });

  test("displays file tree with files", async ({ page }) => {
    // Files should be listed in the file tree
    await expect(page.getByText("SKILL.md")).toBeVisible();
    await expect(page.getByText("workflow.md")).toBeVisible();
  });

  test("shows context directory in file tree", async ({ page }) => {
    // The context/ directory should be visible
    await expect(page.getByText("context")).toBeVisible();
    // File inside context should be visible (tree starts expanded)
    await expect(page.getByText("clarifications.md")).toBeVisible();
  });

  test("shows empty state when no file is selected", async ({ page }) => {
    await expect(page.getByText("Select a file to edit")).toBeVisible();
  });

  test("can select a file from the tree", async ({ page }) => {
    // Click on SKILL.md in the file tree
    await page.getByText("SKILL.md").click();
    await page.waitForTimeout(300);

    // The breadcrumb should show the file path
    await expect(page.getByText("SKILL.md").first()).toBeVisible();

    // The empty state should be gone
    await expect(page.getByText("Select a file to edit")).not.toBeVisible();
  });

  test("shows read-only badge for readonly files", async ({ page }) => {
    // Click on workflow.md which is readonly
    await page.getByText("workflow.md").click();
    await page.waitForTimeout(300);

    await expect(page.getByText("Read-only")).toBeVisible();
  });

  test("save button is disabled when no file is selected", async ({ page }) => {
    const saveButton = page.getByRole("button", { name: "Save" });
    await expect(saveButton).toBeDisabled();
  });

  test("save button is disabled for readonly files", async ({ page }) => {
    // Select a readonly file
    await page.getByText("workflow.md").click();
    await page.waitForTimeout(300);

    const saveButton = page.getByRole("button", { name: "Save" });
    await expect(saveButton).toBeDisabled();
  });

  test("has back button linking to workflow page", async ({ page }) => {
    // The back arrow button should exist and link to the skill workflow page
    const backLink = page.locator("a[href*='/skill/my-skill']").first();
    await expect(backLink).toBeVisible();
  });

  test("shows no files message when file list is empty", async ({ page }) => {
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
        list_skill_files: [],
        read_file: "",
        git_file_status: [],
      };
    });
    await page.goto("/skill/empty-skill/editor");
    await page.waitForTimeout(500);

    await expect(page.getByText("No files")).toBeVisible();
  });
});

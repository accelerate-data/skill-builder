import { test, expect } from "@playwright/test";
import { navigateToWorkflow, WORKFLOW_OVERRIDES } from "../helpers/workflow-helpers";
import { E2E_SKILLS_PATH } from "../helpers/test-paths";
import path from "node:path";

// Absolute paths that list_skill_files returns and readFile resolves against
const skillRoot = path.join(E2E_SKILLS_PATH, "skills", "test-skill");
const absSkillMd = path.join(skillRoot, "SKILL.md");
const absContextMd = path.join(skillRoot, "references", "context.md");

/** Step 3 completed — triggers the FileViewerStepComplete component. */
const FILE_VIEWER_OVERRIDES: Record<string, unknown> = {
  ...WORKFLOW_OVERRIDES,
  get_workflow_state: {
    run: { current_step: 3, purpose: "domain" },
    steps: [
      { step_id: 0, status: "completed" },
      { step_id: 1, status: "completed" },
      { step_id: 2, status: "completed" },
      { step_id: 3, status: "completed" },
    ],
  },
  list_skill_files: [
    { name: "SKILL.md", relative_path: "SKILL.md", absolute_path: absSkillMd, is_directory: false, is_readonly: false, size_bytes: 512 },
    { name: "references", relative_path: "references/", absolute_path: path.join(skillRoot, "references/"), is_directory: true, is_readonly: false, size_bytes: 0 },
    { name: "context.md", relative_path: "references/context.md", absolute_path: absContextMd, is_directory: false, is_readonly: false, size_bytes: 256 },
  ],
  read_file: {
    [absSkillMd]: "# Test Skill\n\nMain skill file content with **bold** text.",
    [absContextMd]: "# Context Reference\n\nReference content for the skill.",
    "*": "",
  },
};

test.describe("File Viewer", { tag: "@workflow" }, () => {
  test("renders file content for a completed generate step", async ({ page }) => {
    await navigateToWorkflow(page, FILE_VIEWER_OVERRIDES);

    // Click the last step (step 3 — Generate) to see completion screen
    // Click step 4 (Generate Skill) in the sidebar
    const step4 = page.locator("button").filter({ hasText: "4. Generate Skill" });
    await step4.click();

    // The file viewer should render the SKILL.md content
    await expect(page.getByText("SKILL.md")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Main skill file content with")).toBeVisible({ timeout: 5_000 });
  });

  test("shows file picker dropdown when multiple files exist", async ({ page }) => {
    await navigateToWorkflow(page, FILE_VIEWER_OVERRIDES);
    // Click step 4 (Generate Skill) in the sidebar
    const step4 = page.locator("button").filter({ hasText: "4. Generate Skill" });
    await step4.click();

    // Wait for file viewer to load
    await expect(page.getByText("SKILL.md")).toBeVisible({ timeout: 10_000 });

    // The Select trigger should be visible since there are multiple files
    const selectTrigger = page.locator("button[data-slot='select-trigger']");
    await expect(selectTrigger).toBeVisible();
  });

  test("switching file in dropdown renders different content", async ({ page }) => {
    await navigateToWorkflow(page, FILE_VIEWER_OVERRIDES);
    // Click step 4 (Generate Skill) in the sidebar
    const step4 = page.locator("button").filter({ hasText: "4. Generate Skill" });
    await step4.click();

    // Wait for initial content
    await expect(page.getByText("Main skill file content with")).toBeVisible({ timeout: 10_000 });

    // Open the dropdown and select the references/context.md file
    const selectTrigger = page.locator("button[data-slot='select-trigger']");
    await selectTrigger.click();
    await page.getByRole("option", { name: "references/context.md" }).click();

    // Verify the new content renders
    await expect(page.getByText("Reference content for the skill")).toBeVisible({ timeout: 5_000 });
  });

  test("shows 'File not found' state when file content is missing", async ({ page }) => {
    const notFoundOverrides: Record<string, unknown> = {
      ...FILE_VIEWER_OVERRIDES,
      read_file: { "*": "__NOT_FOUND__" },
    };
    await navigateToWorkflow(page, notFoundOverrides);
    // Click step 4 (Generate Skill) in the sidebar
    const step4 = page.locator("button").filter({ hasText: "4. Generate Skill" });
    await step4.click();

    await expect(page.getByText("File not found")).toBeVisible({ timeout: 10_000 });
  });
});

import { test, expect } from "@playwright/test";
import { reloadWithOverrides } from "../helpers/app-helpers";
import { E2E_SKILLS_PATH, E2E_WORKSPACE_PATH } from "../helpers/test-paths";

const COMPLETED_SKILL = {
  name: "test-skill",
  purpose: "domain",
  current_step: null,
  status: "completed",
  last_modified: null,
  tags: [],
  author_login: null,
  author_avatar: null,
  intake_json: null,
};

const HISTORY_OVERRIDES: Record<string, unknown> = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: E2E_WORKSPACE_PATH,
    skills_path: E2E_SKILLS_PATH,
  },
  check_workspace_path: true,
  list_skills: [COMPLETED_SKILL],
  get_skill_history: [
    {
      sha: "abc123def456",
      message: "test-skill: Packaged as v2",
      timestamp: new Date(Date.now() - 86400000).toISOString(),
      version: "2",
    },
    {
      sha: "789012fed345",
      message: "test-skill: Packaged as v1",
      timestamp: new Date(Date.now() - 2 * 86400000).toISOString(),
      version: "1",
    },
  ],
  restore_skill_version: "3",
};

test.describe("Skill History & Restore", { tag: "@dashboard" }, () => {
  test("Restore version menu item opens history dialog", async ({ page }) => {
    await reloadWithOverrides(page, HISTORY_OVERRIDES);

    // Hover the skill row to show the context menu trigger
    const skillRow = page.getByText("test-skill").first();
    await skillRow.hover();

    // Open the "More actions" dropdown
    const moreButton = page.getByLabel("More actions");
    await moreButton.click({ force: true });

    // Click "Restore version"
    await page.getByRole("menuitem", { name: "Restore version" }).click();

    // Dialog should open with "Restore Version" heading
    await expect(page.getByRole("heading", { name: "Restore Version" })).toBeVisible({ timeout: 5_000 });
  });

  test("history dialog displays version badges", async ({ page }) => {
    await reloadWithOverrides(page, HISTORY_OVERRIDES);

    const skillRow = page.getByText("test-skill").first();
    await skillRow.hover();
    const moreButton = page.getByLabel("More actions");
    await moreButton.click({ force: true });
    await page.getByRole("menuitem", { name: "Restore version" }).click();

    // Should show version badges (exact match to avoid matching commit messages)
    await expect(page.getByText("v2", { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("v1", { exact: true })).toBeVisible();

    // Should show commit messages (stripped of prefix)
    await expect(page.getByText("Packaged as v2")).toBeVisible();
    await expect(page.getByText("Packaged as v1")).toBeVisible();

    // Should show Restore buttons
    const restoreButtons = page.getByRole("button", { name: "Restore" });
    await expect(restoreButtons).toHaveCount(2);
  });

  test("restoring a version shows success toast", async ({ page }) => {
    await reloadWithOverrides(page, HISTORY_OVERRIDES);

    const skillRow = page.getByText("test-skill").first();
    await skillRow.hover();
    const moreButton = page.getByLabel("More actions");
    await moreButton.click({ force: true });
    await page.getByRole("menuitem", { name: "Restore version" }).click();

    // Click Restore on the v1 entry (second Restore button)
    const restoreButtons = page.getByRole("button", { name: "Restore" });
    await restoreButtons.last().click();

    // Should show success toast
    await expect(page.getByText("Restored — tagged as v3")).toBeVisible({ timeout: 5_000 });

    // Dialog should close
    await expect(page.getByRole("heading", { name: "Restore Version" })).not.toBeVisible({ timeout: 3_000 });
  });

  test("shows empty state when no tagged versions exist", async ({ page }) => {
    await reloadWithOverrides(page, {
      ...HISTORY_OVERRIDES,
      get_skill_history: [],
    });

    const skillRow = page.getByText("test-skill").first();
    await skillRow.hover();
    const moreButton = page.getByLabel("More actions");
    await moreButton.click({ force: true });
    await page.getByRole("menuitem", { name: "Restore version" }).click();

    await expect(page.getByText("No tagged versions found")).toBeVisible({ timeout: 5_000 });
  });
});

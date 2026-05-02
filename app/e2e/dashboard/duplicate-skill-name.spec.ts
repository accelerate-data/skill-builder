import { test, expect } from "@playwright/test";
import { reloadWithOverrides } from "../helpers/app-helpers";
import { E2E_MODEL_SETTINGS, E2E_SKILLS_PATH, E2E_WORKSPACE_PATH } from "../helpers/test-paths";

const OVERRIDES_WITH_EXISTING_SKILL: Record<string, unknown> = {
  get_settings: {
    model_settings: E2E_MODEL_SETTINGS,
    workspace_path: E2E_WORKSPACE_PATH,
    skills_path: E2E_SKILLS_PATH,
  },
  check_workspace_path: true,
  list_skills: [
    {
      name: "existing-skill",
      purpose: "domain",
      current_step: null,
      status: null,
      last_modified: null,
      tags: [],
      author_login: null,
      author_avatar: null,
      intake_json: null,
    },
  ],
};

test.describe("Duplicate Skill Name", { tag: "@dashboard" }, () => {
  test("create_skill backend error is surfaced in the dialog", async ({ page }) => {
    await reloadWithOverrides(page, {
      ...OVERRIDES_WITH_EXISTING_SKILL,
      create_skill: "__throw__:Skill 'existing-skill' already exists",
    });

    // Open New Skill dialog
    const newSkillButton = page.getByRole("button", { name: /new skill/i }).first();
    await newSkillButton.click();

    // Fill all required fields to enable the Next button
    await page.getByRole("textbox", { name: "Skill Name" }).fill("existing-skill");
    await page.getByRole("combobox", { name: /what are you trying to capture/i }).click();
    await page.getByRole("option", { name: /business process knowledge/i }).click();
    await page.getByRole("textbox", { name: /what the skill does/i }).fill("A duplicate skill.");

    // Advance to step 2 and submit
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled({ timeout: 3_000 });
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Create" }).click();

    // Error message should appear in the dialog
    await expect(page.getByText("Skill 'existing-skill' already exists")).toBeVisible({ timeout: 5_000 });
  });

  test("Next button is disabled when required fields are empty", async ({ page }) => {
    await reloadWithOverrides(page, OVERRIDES_WITH_EXISTING_SKILL);

    const newSkillButton = page.getByRole("button", { name: /new skill/i }).first();
    await newSkillButton.click();

    // With only a name filled, Next should be disabled (purpose + description missing)
    await page.getByRole("textbox", { name: "Skill Name" }).fill("new-skill");
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

    // Fill all required fields to verify Next becomes enabled
    await page.getByRole("combobox", { name: /what are you trying to capture/i }).click();
    await page.getByRole("option", { name: /business process knowledge/i }).click();
    await page.getByRole("textbox", { name: /what the skill does/i }).fill("A valid skill.");

    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled({ timeout: 3_000 });
  });
});

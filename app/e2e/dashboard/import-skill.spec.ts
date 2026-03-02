import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";

/**
 * E2E tests for the "Import Skill from File" feature.
 *
 * Tauri mocking strategy:
 *   - @tauri-apps/plugin-dialog `open()` is mocked by tauri-e2e-dialog.ts to return
 *     "/tmp/test-workspace" (any non-null path triggers parse_skill_file).
 *   - @tauri-apps/api/core `invoke()` is mocked by tauri-e2e.ts; parse_skill_file and
 *     import_skill_from_file are stubbed there with defaults (see tauri-e2e.ts).
 *   - Per-test overrides are injected via __TAURI_MOCK_OVERRIDES__ before page.goto().
 */

const BASE_OVERRIDES = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: "/tmp/test-workspace",
    skills_path: "/tmp/test-skills",
  },
  check_workspace_path: true,
  list_skills: [],
};

test.describe("Import Skill from File", { tag: "@import" }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, BASE_OVERRIDES);
    await page.goto("/");
    await waitForAppReady(page);
  });

  test("shows Import button in the action bar when workspace is configured", async ({ page }) => {
    const importButton = page.getByRole("button", { name: /^Import$/i });
    await expect(importButton).toBeVisible();
  });

  test("clicking Import opens the ImportSkillDialog with pre-filled fields", async ({ page }) => {
    // The file picker mock (tauri-e2e-dialog.ts) returns a non-null path.
    // parse_skill_file mock returns metadata with name "imported-skill".
    await page.getByRole("button", { name: /^Import$/i }).click();

    // Dialog title should appear
    await expect(page.getByRole("heading", { name: "Import Skill" })).toBeVisible({ timeout: 5_000 });

    // Fields should be pre-filled from the mocked parse_skill_file response
    await expect(page.getByRole("textbox", { name: /^Name/i })).toHaveValue("imported-skill");
    await expect(page.getByRole("textbox", { name: /^Description/i })).toHaveValue(
      "A skill imported from a file"
    );
    await expect(page.getByRole("textbox", { name: /^Version/i })).toHaveValue("1.2.0");
  });

  test("Confirm Import button is enabled when fields are pre-filled", async ({ page }) => {
    await page.getByRole("button", { name: /^Import$/i }).click();

    await expect(page.getByRole("heading", { name: "Import Skill" })).toBeVisible({ timeout: 5_000 });

    const confirmButton = page.getByRole("button", { name: /Confirm Import/i });
    await expect(confirmButton).toBeEnabled();
  });

  test("happy path: clicking Confirm Import closes the dialog", async ({ page }) => {
    // import_skill_from_file resolves successfully (default mock in tauri-e2e.ts)
    await page.getByRole("button", { name: /^Import$/i }).click();

    await expect(page.getByRole("heading", { name: "Import Skill" })).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: /Confirm Import/i }).click();

    // Dialog should be dismissed after a successful import
    await expect(page.getByRole("heading", { name: "Import Skill" })).not.toBeVisible({ timeout: 5_000 });
  });

  test("Cancel button closes the dialog without importing", async ({ page }) => {
    await page.getByRole("button", { name: /^Import$/i }).click();

    await expect(page.getByRole("heading", { name: "Import Skill" })).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: /Cancel/i }).click();

    await expect(page.getByRole("heading", { name: "Import Skill" })).not.toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Import Skill from File — conflict handling", { tag: "@import" }, () => {
  test("shows overwrite confirmation when skill already exists (conflict_overwrite_required)", async ({ page }) => {
    // Inject overrides before page load, including the error for import_skill_from_file
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      ...BASE_OVERRIDES,
      import_skill_from_file: new Error("conflict_overwrite_required:imported-skill"),
    });
    await page.goto("/");
    await waitForAppReady(page);

    await page.getByRole("button", { name: /^Import$/i }).click();

    await expect(page.getByRole("heading", { name: "Import Skill" })).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: /Confirm Import/i }).click();

    // Overwrite confirmation should appear in place of the form
    await expect(page.getByRole("button", { name: /Overwrite/i })).toBeVisible({ timeout: 5_000 });
  });
});

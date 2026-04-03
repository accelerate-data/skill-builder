import { test, expect } from "@playwright/test";
import { navigateToSettingsSection, BASE_SETTINGS_OVERRIDES } from "../helpers/settings-helpers";
import { E2E_SKILLS_PATH } from "../helpers/test-paths";

test.describe("Workspace Reconfigure", { tag: "@settings" }, () => {
  test("Advanced section shows current skills path", async ({ page }) => {
    await navigateToSettingsSection(page, "Advanced");

    // Skills Folder label should be visible
    await expect(page.getByText("Skills Folder")).toBeVisible({ timeout: 5_000 });

    // The skills path from settings should be displayed
    await expect(page.getByText(E2E_SKILLS_PATH)).toBeVisible();
  });

  test("Browse button opens folder picker and updates skills path", async ({ page }) => {
    await navigateToSettingsSection(page, "Advanced");

    // Verify the Browse button exists
    const browseButton = page.getByRole("button", { name: "Browse" });
    await expect(browseButton).toBeVisible({ timeout: 5_000 });

    // Click Browse — the Tauri dialog mock returns a synthetic path
    await browseButton.click();

    // The dialog mock should have returned a new path and the UI should reflect it.
    // The E2E dialog mock returns the first available path or the test default.
    // Wait for "Saved" confirmation to appear (auto-save triggers on path change).
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 5_000 });
  });

  test("skills path change with existing skills triggers save", async ({ page }) => {
    await navigateToSettingsSection(page, "Advanced", {
      ...BASE_SETTINGS_OVERRIDES,
      list_skills: [
        {
          name: "existing-skill",
          purpose: "domain",
          current_step: null,
          status: "completed",
          last_modified: null,
          tags: [],
          author_login: null,
          author_avatar: null,
          intake_json: null,
        },
      ],
    });

    // Enable invoke tracking for update_user_settings
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__TAURI_TRACK_INVOKES__ = ["update_user_settings"];
      (window as unknown as Record<string, unknown>).__TAURI_TRACKED_INVOKES__ = [];
    });

    // Click Browse to change skills path
    const browseButton = page.getByRole("button", { name: "Browse" });
    await browseButton.click();

    // Verify update_user_settings was called
    await expect(async () => {
      const tracked = await page.evaluate(() =>
        (window as unknown as Record<string, unknown>).__TAURI_TRACKED_INVOKES__ as Array<{ cmd: string }>,
      );
      expect(tracked.some((t) => t.cmd === "update_user_settings")).toBe(true);
    }).toPass({ timeout: 5_000 });
  });
});

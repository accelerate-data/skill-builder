import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";
import importedSkillsFixture from "../fixtures/imported-skills.json" with { type: "json" };

/** Navigate to the Skills section of the Settings page. */
async function navigateToSkillsLibrary(page: Parameters<typeof waitForAppReady>[0]) {
  await page.goto("/settings");
  await waitForAppReady(page);
  // Wait for settings to finish loading (spinner disappears, nav buttons become visible)
  const skillsNavBtn = page.locator("nav button", { hasText: "Skills" });
  await skillsNavBtn.waitFor({ state: "visible", timeout: 5_000 });
  // Click the "Skills" section in the settings sidebar nav
  await skillsNavBtn.click();
  // Wait for the SkillsLibraryTab to mount
  await page.waitForTimeout(300);
}

test.describe("Skills Library", { tag: "@skills" }, () => {
  test("shows empty state when no skills exist", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_imported_skills: [],
      };
    });

    await navigateToSkillsLibrary(page);

    // Empty state card should be visible (CardTitle renders as <div>, not a heading)
    await expect(page.getByText("No imported skills")).toBeVisible();
    await expect(
      page.getByText("Upload a .skill package or import from GitHub to add skills to your library.")
    ).toBeVisible();

    // Action buttons in empty state card
    const emptyCard = page.locator("[data-slot='card']");
    await expect(emptyCard.getByRole("button", { name: /upload skill/i })).toBeVisible();
    await expect(emptyCard.getByRole("button", { name: /import from github/i })).toBeVisible();
  });

  test("shows action buttons in Skills Library tab", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_imported_skills: [],
      };
    });

    await navigateToSkillsLibrary(page);

    // Settings page header
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Settings sidebar shows "Skills" as active section
    await expect(page.locator("nav button", { hasText: "Skills" })).toBeVisible();

    // Action buttons
    await expect(page.getByRole("button", { name: /import from github/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /upload skill/i }).first()).toBeVisible();
  });

  test("shows populated state with skill cards", async ({ page }) => {
    await page.addInitScript((skills) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_imported_skills: skills,
      };
    }, importedSkillsFixture);

    await navigateToSkillsLibrary(page);

    // Both skill cards should be visible (CardTitle renders as <div>, not a heading)
    await expect(page.getByText("data-analytics")).toBeVisible();
    await expect(page.getByText("api-design")).toBeVisible();

    // Domain badges
    await expect(page.getByText("Data", { exact: true })).toBeVisible();
    await expect(page.getByText("Engineering", { exact: true })).toBeVisible();

    // Trigger text
    await expect(page.getByText("When the user asks about data analysis...")).toBeVisible();
    await expect(page.getByText("When designing REST APIs...")).toBeVisible();
  });

  test("can toggle skill active state", async ({ page }) => {
    await page.addInitScript((skills) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_imported_skills: skills,
        toggle_skill_active: undefined,
      };
    }, importedSkillsFixture);

    await navigateToSkillsLibrary(page);

    // Find the switch for data-analytics skill
    const dataAnalyticsSwitch = page.getByLabel("Toggle data-analytics active");
    await expect(dataAnalyticsSwitch).toBeChecked();

    // Toggle it off
    await dataAnalyticsSwitch.click();

    // The card should now have opacity-60 class (we can verify by checking the card's opacity style)
    const dataAnalyticsCard = page.locator(".opacity-60").filter({
      hasText: "data-analytics",
    });
    await expect(dataAnalyticsCard).toBeVisible();
  });

  test("can delete skill with two-click confirmation", async ({ page }) => {
    await page.addInitScript((skills) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_imported_skills: skills,
        delete_imported_skill: undefined,
      };
    }, importedSkillsFixture);

    await navigateToSkillsLibrary(page);

    // Find the delete button for data-analytics (CardTitle is a <div>, not a heading)
    const dataAnalyticsCard = page.locator("[data-slot='card']").filter({
      hasText: "data-analytics",
    }).first();

    const deleteButton = dataAnalyticsCard.getByLabel("Delete skill");
    await expect(deleteButton).toBeVisible();

    // First click - should change to destructive variant
    await deleteButton.click();
    await expect(dataAnalyticsCard.getByLabel("Confirm delete")).toBeVisible();

    // Second click - should delete the skill
    await dataAnalyticsCard.getByLabel("Confirm delete").click();

    // Card should disappear
    await expect(page.getByText("data-analytics")).not.toBeVisible();
    // But the other skill should remain
    await expect(page.getByText("api-design")).toBeVisible();
  });

  test("can open preview dialog", async ({ page }) => {
    const mockSkillContent = "# Data Analytics Skill\n\nThis is a sample skill for data analytics.";

    await page.addInitScript(
      ({ skills, content }) => {
        (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
          list_imported_skills: skills,
          get_skill_content: content,
        };
      },
      { skills: importedSkillsFixture, content: mockSkillContent }
    );

    await navigateToSkillsLibrary(page);

    // Click the Preview button for data-analytics (CardTitle is a <div>, not a heading)
    const dataAnalyticsCard = page.locator("[data-slot='card']").filter({
      hasText: "data-analytics",
    }).first();

    await dataAnalyticsCard.getByRole("button", { name: /preview/i }).click();

    // Dialog should open with skill name as title (DialogTitle IS a heading)
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "data-analytics" })).toBeVisible();
    await expect(page.getByText("SKILL.md content preview")).toBeVisible();

    // Should show the markdown content
    await expect(page.getByText("Data Analytics Skill")).toBeVisible();
  });

  test("can close preview dialog", async ({ page }) => {
    const mockSkillContent = "# API Design Skill\n\nREST API best practices.";

    await page.addInitScript(
      ({ skills, content }) => {
        (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
          list_imported_skills: skills,
          get_skill_content: content,
        };
      },
      { skills: importedSkillsFixture, content: mockSkillContent }
    );

    await navigateToSkillsLibrary(page);

    // Open preview (CardTitle is a <div>, not a heading)
    const apiDesignCard = page.locator("[data-slot='card']").filter({
      hasText: "api-design",
    }).first();

    await apiDesignCard.getByRole("button", { name: /preview/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Close dialog by pressing Escape (the X button uses sr-only "Close" text)
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("upload skill button is clickable", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_imported_skills: [],
      };
    });

    await navigateToSkillsLibrary(page);

    // Verify the Upload Skill button exists and is clickable
    const uploadButton = page.getByRole("button", { name: /upload skill/i }).first();
    await expect(uploadButton).toBeVisible();
    await expect(uploadButton).toBeEnabled();
  });

  test("can open GitHub import dialog", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_imported_skills: [],
      };
    });

    await navigateToSkillsLibrary(page);

    // Click Import from GitHub button
    await page.getByRole("button", { name: /import from github/i }).first().click();

    // Dialog should open
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Import from GitHub" })).toBeVisible();
    await expect(
      page.getByText("Paste a public GitHub repository URL to browse available skills.")
    ).toBeVisible();
  });

  test("GitHub import wizard - step 1: enter URL and browse", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_imported_skills: [],
        parse_github_url: {
          owner: "test-owner",
          repo: "test-repo",
          branch: "main",
          subpath: null,
        },
        list_github_skills: [
          {
            path: "skills/analytics",
            name: "analytics",
            domain: "Data",
            description: "Data analytics skill",
          },
          {
            path: "skills/testing",
            name: "testing",
            domain: "Engineering",
            description: "Testing best practices",
          },
        ],
      };
    });

    await navigateToSkillsLibrary(page);

    // Open GitHub import dialog
    await page.getByRole("button", { name: /import from github/i }).first().click();

    // Enter GitHub URL
    await page.getByPlaceholder("https://github.com/owner/repo").fill("https://github.com/test-owner/test-repo");

    // Click Browse Skills
    await page.getByRole("button", { name: "Browse Skills" }).click();

    // Should move to step 2: select skills
    await expect(page.getByRole("heading", { name: "Select Skills from test-owner/test-repo" })).toBeVisible();
    await expect(page.getByText("2 skills found. Select the ones you'd like to import.")).toBeVisible();
  });

  test("GitHub import wizard - step 2: select skills", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_imported_skills: [],
        parse_github_url: {
          owner: "test-owner",
          repo: "test-repo",
          branch: "main",
          subpath: null,
        },
        list_github_skills: [
          {
            path: "skills/analytics",
            name: "analytics",
            domain: "Data",
            description: "Data analytics skill",
          },
          {
            path: "skills/testing",
            name: "testing",
            domain: "Engineering",
            description: "Testing best practices",
          },
        ],
      };
    });

    await navigateToSkillsLibrary(page);

    // Open dialog and navigate to step 2
    await page.getByRole("button", { name: /import from github/i }).first().click();
    await page.getByPlaceholder("https://github.com/owner/repo").fill("https://github.com/test-owner/test-repo");
    await page.getByRole("button", { name: "Browse Skills" }).click();

    // Both skills should be selected by default (Radix Checkbox renders as <button role="checkbox">)
    const analyticsCheckbox = page.locator("label").filter({ hasText: "analytics" }).getByRole("checkbox");
    const testingCheckbox = page.locator("label").filter({ hasText: "testing" }).getByRole("checkbox");

    await expect(analyticsCheckbox).toBeChecked();
    await expect(testingCheckbox).toBeChecked();

    // Deselect one skill
    await analyticsCheckbox.click();
    await expect(analyticsCheckbox).not.toBeChecked();

    // Import button should show count
    await expect(page.getByRole("button", { name: "Import Selected (1)" })).toBeVisible();
  });

  test("GitHub import wizard - step 2: select all toggle", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_imported_skills: [],
        parse_github_url: {
          owner: "test-owner",
          repo: "test-repo",
          branch: "main",
          subpath: null,
        },
        list_github_skills: [
          {
            path: "skills/analytics",
            name: "analytics",
            domain: "Data",
            description: "Data analytics skill",
          },
          {
            path: "skills/testing",
            name: "testing",
            domain: "Engineering",
            description: "Testing best practices",
          },
        ],
      };
    });

    await navigateToSkillsLibrary(page);

    // Navigate to step 2
    await page.getByRole("button", { name: /import from github/i }).first().click();
    await page.getByPlaceholder("https://github.com/owner/repo").fill("https://github.com/test-owner/test-repo");
    await page.getByRole("button", { name: "Browse Skills" }).click();

    // Find "Select all" checkbox (Radix Checkbox renders as <button role="checkbox">)
    const selectAllCheckbox = page.locator("label").filter({ hasText: "Select all" }).getByRole("checkbox");
    await expect(selectAllCheckbox).toBeChecked();

    // Uncheck "Select all"
    await selectAllCheckbox.click();
    await expect(selectAllCheckbox).not.toBeChecked();

    // Import button should be disabled
    await expect(page.getByRole("button", { name: /import selected/i })).toBeDisabled();

    // Check "Select all" again
    await selectAllCheckbox.click();
    await expect(page.getByRole("button", { name: "Import Selected (2)" })).toBeEnabled();
  });

  test("GitHub import wizard - full flow to completion", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_imported_skills: [],
        parse_github_url: {
          owner: "test-owner",
          repo: "test-repo",
          branch: "main",
          subpath: null,
        },
        list_github_skills: [
          {
            path: "skills/analytics",
            name: "analytics",
            domain: "Data",
            description: "Data analytics skill",
          },
        ],
        import_github_skills: [
          {
            skill_id: "imported-001",
            skill_name: "analytics",
            domain: "Data",
            description: "Data analytics skill",
            is_active: true,
            disk_path: "/tmp/skills/analytics",
            trigger_text: null,
            imported_at: "2025-01-20T10:00:00Z",
          },
        ],
      };
    });

    await navigateToSkillsLibrary(page);

    // Step 1: Enter URL
    await page.getByRole("button", { name: /import from github/i }).first().click();
    await page.getByPlaceholder("https://github.com/owner/repo").fill("https://github.com/test-owner/test-repo");
    await page.getByRole("button", { name: "Browse Skills" }).click();

    // Step 2: Select skills (analytics is already selected by default)
    await expect(page.getByRole("heading", { name: "Select Skills from test-owner/test-repo" })).toBeVisible();
    await page.getByRole("button", { name: "Import Selected (1)" }).click();

    // Step 3: Importing spinner completes → Step 4: Done
    await expect(page.getByRole("heading", { name: "Import Complete" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Successfully imported 1 skill.")).toBeVisible();

    // Click Done to close dialog
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("GitHub import wizard - back navigation", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_imported_skills: [],
        parse_github_url: {
          owner: "test-owner",
          repo: "test-repo",
          branch: "main",
          subpath: null,
        },
        list_github_skills: [
          {
            path: "skills/analytics",
            name: "analytics",
            domain: "Data",
            description: "Data analytics skill",
          },
        ],
      };
    });

    await navigateToSkillsLibrary(page);

    // Navigate to step 2
    await page.getByRole("button", { name: /import from github/i }).first().click();
    await page.getByPlaceholder("https://github.com/owner/repo").fill("https://github.com/test-owner/test-repo");
    await page.getByRole("button", { name: "Browse Skills" }).click();

    await expect(page.getByRole("heading", { name: "Select Skills from test-owner/test-repo" })).toBeVisible();

    // Click back button (ArrowLeft icon button) — scoped to dialog to avoid matching header's back button
    const backButton = page.getByRole("dialog").locator("button").filter({ has: page.locator("svg.lucide-arrow-left") });
    await backButton.click();

    // Should go back to step 1
    await expect(page.getByRole("heading", { name: "Import from GitHub" })).toBeVisible();
    await expect(page.getByPlaceholder("https://github.com/owner/repo")).toHaveValue("https://github.com/test-owner/test-repo");
  });
});

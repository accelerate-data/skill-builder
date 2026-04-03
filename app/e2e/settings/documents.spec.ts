import { test, expect } from "@playwright/test";
import { navigateToSettingsSection, BASE_SETTINGS_OVERRIDES } from "../helpers/settings-helpers";

const NOW = new Date().toISOString();

const EMPTY_DOCS_OVERRIDES: Record<string, unknown> = {
  ...BASE_SETTINGS_OVERRIDES,
  list_documents: [],
  list_skills_for_documents: [
    { id: 1, name: "test-skill", plugin_slug: "skills", plugin_display_name: "Skills", is_default_plugin: true },
  ],
};

const WITH_DOCS_OVERRIDES: Record<string, unknown> = {
  ...BASE_SETTINGS_OVERRIDES,
  list_documents: [
    {
      id: 1,
      name: "Release Notes",
      source_type: "url",
      source_url: "https://example.com/notes",
      file_path: "",
      scope: "all",
      skill_ids: [],
      created_at: NOW,
      updated_at: NOW,
    },
  ],
  list_skills_for_documents: [
    { id: 1, name: "test-skill", plugin_slug: "skills", plugin_display_name: "Skills", is_default_plugin: true },
  ],
  delete_document: undefined,
};

test.describe("Document Management", { tag: "@settings" }, () => {
  test("shows empty state when no documents exist", async ({ page }) => {
    await navigateToSettingsSection(page, "Documents", EMPTY_DOCS_OVERRIDES);

    await expect(page.getByText("No documents added yet")).toBeVisible({ timeout: 5_000 });
  });

  test("Add URL button opens dialog and creates a document", async ({ page }) => {
    await navigateToSettingsSection(page, "Documents", {
      ...EMPTY_DOCS_OVERRIDES,
      add_document_url: {
        id: 2,
        name: "API Docs",
        source_type: "url",
        source_url: "https://api.example.com/docs",
        file_path: "",
        scope: "all",
        skill_ids: [],
        created_at: NOW,
        updated_at: NOW,
      },
    });

    // Click Add URL button
    await page.getByRole("button", { name: "Add URL" }).click();

    // Fill the dialog form
    await expect(page.getByText("Add document from URL")).toBeVisible({ timeout: 5_000 });
    await page.getByPlaceholder("e.g. Fabric Release Notes").fill("API Docs");
    await page.getByPlaceholder("https://...").fill("https://api.example.com/docs");

    // Submit
    await page.getByRole("button", { name: "Fetch & Add" }).click();

    // Dialog should close and document should appear
    await expect(page.getByText("Add document from URL")).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("API Docs")).toBeVisible();
  });

  test("document appears in table with correct source label", async ({ page }) => {
    await navigateToSettingsSection(page, "Documents", WITH_DOCS_OVERRIDES);

    // Document name should be in the table
    await expect(page.getByText("Release Notes")).toBeVisible({ timeout: 5_000 });

    // Source type should be shown in the table cell
    await expect(page.getByRole("cell", { name: "url" })).toBeVisible();

    // Assignment should show "All skills"
    await expect(page.getByText("All skills")).toBeVisible();
  });

  test("deleting a document removes it from the table", async ({ page }) => {
    await navigateToSettingsSection(page, "Documents", WITH_DOCS_OVERRIDES);

    // Verify document is visible
    await expect(page.getByText("Release Notes")).toBeVisible({ timeout: 5_000 });

    // Click the delete (trash) button
    const deleteButton = page.locator("table button").filter({ has: page.locator("svg") }).last();
    await deleteButton.click();

    // Document should disappear and empty state should appear
    await expect(page.getByText("Release Notes")).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("No documents added yet")).toBeVisible();
  });

  test("scope assignment button opens assignment dialog", async ({ page }) => {
    await navigateToSettingsSection(page, "Documents", WITH_DOCS_OVERRIDES);

    // Click the "All skills" link to open the assignment dialog
    await page.getByText("All skills").click();

    // Assignment dialog should open with "Assign" in the title
    await expect(page.getByText('Assign "Release Notes"')).toBeVisible({ timeout: 5_000 });

    // Should show the "All skills" toggle
    await expect(page.getByLabel("All skills")).toBeVisible();
  });
});

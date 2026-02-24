import { test, expect, type Page } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";

/**
 * Base settings for all dashboard view tests.
 * Provides configured workspace + skills path so dashboard renders fully.
 */
const BASE_SETTINGS = {
  anthropic_api_key: "sk-ant-test",
  workspace_path: "/tmp/test-workspace",
  skills_path: "/tmp/test-skills",
  dashboard_view_mode: null,
};

/** A small set of skills (< 10) — grid should be the auto-selected default. */
const FEW_SKILLS = [
  {
    name: "sales-pipeline",
    current_step: "Step 3",
    status: "in_progress",
    last_modified: new Date().toISOString(),
    tags: ["crm"],
    purpose: "platform",
    skill_source: "skill-builder",
    author_login: null,
    author_avatar: null,
    intake_json: null,
  },
  {
    name: "hr-analytics",
    current_step: "completed",
    status: "completed",
    last_modified: new Date().toISOString(),
    tags: ["workday"],
    purpose: "domain",
    author_login: null,
    author_avatar: null,
    intake_json: null,
  },
  {
    name: "finance-reporting",
    current_step: "Step 1",
    status: "in_progress",
    last_modified: new Date().toISOString(),
    tags: [],
    purpose: "domain",
    author_login: null,
    author_avatar: null,
    intake_json: null,
  },
];

/** Generate N skills for auto-select threshold testing. */
function generateSkills(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `skill-${i}`,
    current_step: "Step 1",
    status: "in_progress",
    last_modified: new Date().toISOString(),
    tags: [],
    purpose: "domain",
    author_login: null,
    author_avatar: null,
    intake_json: null,
  }));
}

function makeMocks(overrides: Record<string, unknown> = {}) {
  return {
    get_settings: BASE_SETTINGS,
    check_workspace_path: true,
    list_skills: FEW_SKILLS,
    get_all_tags: ["crm", "workday"],
    save_settings: undefined,
    delete_skill: undefined,
    package_skill: { file_path: "/tmp/test.skill", size_bytes: 1024 },
    copy_file: undefined,
    ...overrides,
  };
}

/**
 * In grid view, each skill is in a SkillCard wrapped by ContextMenu.
 * Locate the nearest ancestor that contains the skill name and action buttons.
 */
function gridCard(page: Page, skillName: string) {
  // The skill name is inside the card. Find the text, then go up to the card root.
  // SkillCard renders: TooltipProvider > ContextMenu > ContextMenuTrigger > Card[data-slot=card]
  // Use the grid container's direct children as scoping context.
  return page.locator(".grid").locator(">> div").filter({ hasText: skillName }).first();
}

// ---------------------------------------------------------------------------
// 1. View Toggle Mechanics + Persistence
// ---------------------------------------------------------------------------

test.describe("View Toggle", { tag: "@dashboard" }, () => {
  test("1a: defaults to grid view with fewer than 10 skills", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, makeMocks());
    await page.goto("/");
    await waitForAppReady(page);

    await expect(page.getByText("sales-pipeline")).toBeVisible();

    // Grid toggle should be active
    await expect(page.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");

    // Grid layout should be present (responsive grid class)
    await expect(page.locator(".grid.grid-cols-1")).toBeVisible();

    // No list rows should exist
    const listRows = page.locator("tr").filter({ hasText: "sales-pipeline" });
    await expect(listRows).toHaveCount(0);
  });

  test("1b: clicking list toggle switches to list view", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, makeMocks());
    await page.goto("/");
    await waitForAppReady(page);

    await expect(page.getByText("sales-pipeline")).toBeVisible();

    // Click list view toggle
    await page.getByRole("button", { name: "List view" }).click();

    // List toggle should now be active
    await expect(page.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "false");

    // List rows should be rendered (tr elements in the table)
    const rows = page.locator("tr").filter({ hasText: "sales-pipeline" });
    await expect(rows.first()).toBeVisible();

    // Grid layout should NOT be present
    await expect(page.locator(".grid.grid-cols-1")).not.toBeVisible();
  });

  test("1c: clicking grid toggle switches back to grid view", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, makeMocks());
    await page.goto("/");
    await waitForAppReady(page);

    await expect(page.getByText("sales-pipeline")).toBeVisible();

    // Switch to list
    await page.getByRole("button", { name: "List view" }).click();
    await expect(page.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");

    // Switch back to grid
    await page.getByRole("button", { name: "Grid view" }).click();
    await expect(page.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");

    // Grid should be back
    await expect(page.locator(".grid.grid-cols-1")).toBeVisible();
  });

  test("1d: view choice persists across page navigation", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, makeMocks({
      get_settings: { ...BASE_SETTINGS, dashboard_view_mode: "list" },
    }));
    await page.goto("/");
    await waitForAppReady(page);

    await expect(page.getByText("sales-pipeline")).toBeVisible();

    // Should restore list view from saved preference
    await expect(page.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");

    // List rows should be visible
    const rows = page.locator("tr").filter({ hasText: "sales-pipeline" });
    await expect(rows.first()).toBeVisible();
  });

  test("1e: auto-selects list view when >= 10 skills and no saved preference", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, makeMocks({
      list_skills: generateSkills(12),
      get_all_tags: [],
    }));
    await page.goto("/");
    await waitForAppReady(page);

    await expect(page.getByText("skill-0")).toBeVisible();

    // List view should be auto-selected
    await expect(page.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
  });
});

// ---------------------------------------------------------------------------
// 2. Grid View — Actions
// ---------------------------------------------------------------------------

test.describe("Grid View Actions", { tag: "@dashboard" }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, makeMocks());
    await page.goto("/");
    await waitForAppReady(page);
    await expect(page.getByText("sales-pipeline")).toBeVisible();
  });

  test("2a: clicking skill card navigates to skill page in review mode", async ({ page }) => {
    await page.getByText("sales-pipeline").click();
    await expect(page).toHaveURL(/\/skill\/sales-pipeline/);
  });

  test("2b: edit workflow icon navigates to skill page in update mode", async ({ page }) => {
    // sales-pipeline is the only skill-builder skill, so there's exactly one "Edit workflow" button
    const editButton = page.getByRole("button", { name: "Edit workflow" }).first();
    await editButton.click();
    await expect(page).toHaveURL(/\/skill\/sales-pipeline/);
  });

  test("2c: delete icon opens delete confirmation dialog", async ({ page }) => {
    // Click the first delete button (Delete skill)
    const deleteButtons = page.getByRole("button", { name: "Delete skill" });
    await deleteButtons.first().click();

    await expect(page.getByRole("heading", { name: "Delete Skill" })).toBeVisible();
  });

  test("2d: confirming delete closes the dialog", async ({ page }) => {
    const deleteButtons = page.getByRole("button", { name: "Delete skill" });
    await deleteButtons.first().click();

    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("heading", { name: "Delete Skill" })).not.toBeVisible();
  });

  test("2e: cancelling delete keeps the card", async ({ page }) => {
    const deleteButtons = page.getByRole("button", { name: "Delete skill" });
    await deleteButtons.first().click();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Delete Skill" })).not.toBeVisible();
    await expect(page.getByText("sales-pipeline")).toBeVisible();
  });

  test("2f: download icon visible only on completed skills", async ({ page }) => {
    // hr-analytics (completed) should show download
    const downloadButtons = page.getByRole("button", { name: "Download skill" });
    await expect(downloadButtons).toHaveCount(1); // only 1 completed skill

    // The one download button should be in the context of the completed skill
    await expect(downloadButtons.first()).toBeVisible();
  });

  test("2g: refine icon visible only on completed skills", async ({ page }) => {
    const refineButtons = page.getByRole("button", { name: "Refine skill" });
    await expect(refineButtons).toHaveCount(1); // only 1 completed skill
  });

  test("2h: refine icon navigates to refine page", async ({ page }) => {
    await page.getByRole("button", { name: "Refine skill" }).click();
    await expect(page).toHaveURL(/\/refine/);
  });

  test("2i: context menu shows Edit details option", async ({ page }) => {
    // Right-click on the skill name text to open context menu
    await page.getByText("sales-pipeline").click({ button: "right" });
    await expect(page.getByText("Edit details")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. List View — Actions
// ---------------------------------------------------------------------------

test.describe("List View Actions", { tag: "@dashboard" }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, makeMocks());
    await page.goto("/");
    await waitForAppReady(page);
    await expect(page.getByText("sales-pipeline")).toBeVisible();
    // Switch to list view
    await page.getByRole("button", { name: "List view" }).click();
    await expect(page.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
  });

  test("3a: clicking list row navigates to skill page in review mode", async ({ page }) => {
    const row = page.locator("tr").filter({ hasText: "sales-pipeline" });
    await row.locator("div", { hasText: "sales-pipeline" }).first().click();
    await expect(page).toHaveURL(/\/skill\/sales-pipeline/);
  });

  test("3b: edit workflow icon in list row navigates in update mode", async ({ page }) => {
    const row = page.locator("tr").filter({ hasText: "sales-pipeline" });
    await row.getByRole("button", { name: "Edit workflow" }).click();
    await expect(page).toHaveURL(/\/skill\/sales-pipeline/);
  });

  test("3c: delete icon in list row opens delete dialog", async ({ page }) => {
    const row = page.locator("tr").filter({ hasText: "sales-pipeline" });
    await row.getByRole("button", { name: "Delete skill" }).click();

    await expect(page.getByRole("heading", { name: "Delete Skill" })).toBeVisible();
  });

  test("3d: kebab menu shows Edit details option", async ({ page }) => {
    const row = page.locator("tr").filter({ hasText: "sales-pipeline" });
    await row.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByText("Edit details")).toBeVisible();
  });

  test("3e: download and refine icons match card view visibility rules", async ({ page }) => {
    // Completed skill should show download + refine
    const completedRow = page.locator("tr").filter({ hasText: "hr-analytics" });
    await expect(completedRow.getByRole("button", { name: "Download skill" })).toBeVisible();
    await expect(completedRow.getByRole("button", { name: "Refine skill" })).toBeVisible();

    // In-progress skill should NOT
    const inProgressRow = page.locator("tr").filter({ hasText: "sales-pipeline" });
    await expect(inProgressRow.getByRole("button", { name: "Download skill" })).not.toBeVisible();
    await expect(inProgressRow.getByRole("button", { name: "Refine skill" })).not.toBeVisible();
  });

  test("3f: action icon clicks do not trigger row navigation", async ({ page }) => {
    const row = page.locator("tr").filter({ hasText: "sales-pipeline" });

    // Click the delete button — should open dialog, not navigate
    await row.getByRole("button", { name: "Delete skill" }).click();
    await expect(page.getByRole("heading", { name: "Delete Skill" })).toBeVisible();
    // Should still be on dashboard
    await expect(page).toHaveURL("/");
  });

  test("3g: list view shows purpose as text", async ({ page }) => {
    const row = page.locator("tr").filter({ hasText: "hr-analytics" });
    await expect(row.getByText("Business process knowledge", { exact: true })).toBeVisible();
  });

  test("3h: list view shows completed status for completed skills", async ({ page }) => {
    const completedRow = page.locator("tr").filter({ hasText: "hr-analytics" });
    await expect(completedRow.getByText("Completed").first()).toBeVisible();
  });
});

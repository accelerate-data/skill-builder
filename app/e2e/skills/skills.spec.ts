import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";
import workspaceSkillsFixture from "../fixtures/workspace-skills.json" with { type: "json" };

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

/** Navigate to the main dashboard (skills list with grid/list view toggle). */
async function navigateToDashboard(page: Parameters<typeof waitForAppReady>[0]) {
  await page.goto("/");
  await waitForAppReady(page);
  await page.waitForTimeout(300);
}

test.describe("Skills Library", { tag: "@skills" }, () => {
  test("shows empty state when no skills exist", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_workspace_skills: [],
      };
    });

    await navigateToSkillsLibrary(page);

    await expect(page.getByText("No workspace skills")).toBeVisible();
    await expect(
      page.getByText("Upload a .skill package or browse the marketplace to add skills.")
    ).toBeVisible();
  });

  test("shows action buttons in Skills Library tab", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_workspace_skills: [],
      };
    });

    await navigateToSkillsLibrary(page);

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.locator("nav button", { hasText: "Skills" })).toBeVisible();

    // Action buttons — Marketplace button exists (may be disabled without marketplaceUrl)
    await expect(page.getByRole("button", { name: /marketplace/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /upload skill/i }).first()).toBeVisible();
  });

  test("shows skill list with names and version badges", async ({ page }) => {
    const nonBundled = workspaceSkillsFixture.filter((s) => !s.is_bundled);

    await page.addInitScript((skills) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_workspace_skills: skills,
      };
    }, nonBundled);

    await navigateToSkillsLibrary(page);

    // Both skills should be visible in the list
    await expect(page.getByText("data-analytics")).toBeVisible();
    await expect(page.getByText("api-design")).toBeVisible();

    // Purpose subtext
    await expect(page.getByText("domain", { exact: true })).toBeVisible();
    await expect(page.getByText("platform", { exact: true })).toBeVisible();

    // data-analytics has version "1.0.0", api-design has no version (shows "—")
    await expect(page.getByText("1.0.0")).toBeVisible();
  });

  test("can toggle skill active state", async ({ page }) => {
    const nonBundled = workspaceSkillsFixture.filter((s) => !s.is_bundled);

    await page.addInitScript((skills) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_workspace_skills: skills,
        toggle_skill_active: undefined,
      };
    }, nonBundled);

    await navigateToSkillsLibrary(page);

    // Find the active toggle for data-analytics
    const toggle = page.getByLabel("Toggle data-analytics");
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();

    // Toggle it — should fire toggle_skill_active without error
    await toggle.click();
  });

  test("delete button is hidden for bundled skills", async ({ page }) => {
    await page.addInitScript((skills) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_workspace_skills: skills,
      };
    }, workspaceSkillsFixture);

    await navigateToSkillsLibrary(page);

    // Non-bundled skills should have a delete button
    await expect(page.getByLabel("Delete data-analytics")).toBeVisible();

    // Bundled skills must NOT have a delete button
    await expect(page.getByLabel("Delete skill-builder-practices")).not.toBeVisible();
  });

  test("can delete a non-bundled skill", async ({ page }) => {
    const nonBundled = workspaceSkillsFixture.filter((s) => !s.is_bundled);

    await page.addInitScript((skills) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_workspace_skills: skills,
        delete_imported_skill: undefined,
      };
    }, nonBundled);

    await navigateToSkillsLibrary(page);

    // Both skills visible
    await expect(page.getByText("data-analytics")).toBeVisible();
    await expect(page.getByText("api-design")).toBeVisible();

    // Delete data-analytics
    await page.getByLabel("Delete data-analytics").click();

    // data-analytics should disappear; api-design remains
    await expect(page.getByText("data-analytics")).not.toBeVisible();
    await expect(page.getByText("api-design")).toBeVisible();
  });

  test("upload skill button is clickable", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_workspace_skills: [],
      };
    });

    await navigateToSkillsLibrary(page);

    const uploadButton = page.getByRole("button", { name: /upload skill/i }).first();
    await expect(uploadButton).toBeVisible();
    await expect(uploadButton).toBeEnabled();
  });

  test("can open Marketplace import dialog", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_workspace_skills: [],
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          workspace_path: "/tmp/test-workspace",
          skills_path: "/tmp/test-skills",
          marketplace_url: "https://github.com/test-owner/test-repo",
        },
        parse_github_url: {
          owner: "test-owner",
          repo: "test-repo",
          branch: "main",
          subpath: null,
        },
        list_github_skills: [],
        get_installed_skill_names: [],
      };
    });

    await navigateToSkillsLibrary(page);

    // Click Marketplace button (enabled when marketplace_url is configured)
    await page.getByRole("button", { name: /marketplace/i }).first().click();

    // Dialog should open and auto-browse
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  // ─── List view ───────────────────────────────────────────────────────────

  /** SkillSummary-shaped skills for dashboard list view tests. */
  const DASHBOARD_SKILLS = [
    {
      name: "data-analytics",
      current_step: null,
      status: "completed",
      last_modified: "2025-01-15T10:00:00Z",
      tags: [],
      purpose: "domain",
      skill_source: "marketplace",
      author_login: null,
      author_avatar: null,
      intake_json: null,
    },
    {
      name: "api-design",
      current_step: null,
      status: "completed",
      last_modified: "2025-01-14T09:00:00Z",
      tags: [],
      purpose: "platform",
      skill_source: "imported",
      author_login: null,
      author_avatar: null,
      intake_json: null,
    },
  ];

  const DASHBOARD_MOCKS = {
    get_settings: {
      anthropic_api_key: "sk-ant-test",
      workspace_path: "/tmp/ws",
      skills_path: "/tmp/skills",
      dashboard_view_mode: null,
    },
    list_skills: DASHBOARD_SKILLS,
    get_all_tags: [],
    save_settings: undefined,
    check_workspace_path: true,
  };

  test("can switch to list view and back to grid view", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, DASHBOARD_MOCKS);

    await navigateToDashboard(page);

    // Default is grid view
    await expect(page.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");

    // Switch to list view — skills still visible
    await page.getByRole("button", { name: "List view" }).click();
    await expect(page.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("data-analytics")).toBeVisible();
    await expect(page.getByText("api-design")).toBeVisible();

    // Switch back to grid view
    await page.getByRole("button", { name: "Grid view" }).click();
    await expect(page.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
  });

  test("shows table header columns in list view", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, DASHBOARD_MOCKS);

    await navigateToDashboard(page);
    await page.getByRole("button", { name: "List view" }).click();

    await expect(page.getByRole("button", { name: "Name" })).toBeVisible();
    // "Source" and "Status" also appear as filter dropdown buttons; use last() to target the table header
    await expect(page.getByRole("button", { name: "Source" }).last()).toBeVisible();
    await expect(page.getByRole("button", { name: "Status" }).last()).toBeVisible();
    await expect(page.getByText("Actions", { exact: true })).toBeVisible();
  });

  test("source and status column data is left-aligned with column headers", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, DASHBOARD_MOCKS);

    await navigateToDashboard(page);
    await page.getByRole("button", { name: "List view" }).click();

    // Get Source column header button's left edge (the sort button, not the filter dropdown)
    const sourceHeaderBox = await page.getByRole("button", { name: "Source" }).last().boundingBox();
    // Get the Source badge ELEMENT's left edge (not the text inside, which is offset by icon+padding).
    // Scope to the data-analytics row to avoid matching the top-bar "Marketplace" import button.
    const dataAnalyticsRow = page
      .locator("tr")
      .filter({ hasText: "data-analytics" });
    // The Source badge is a <span> containing "Marketplace" text
    const sourceBadgeBox = await dataAnalyticsRow
      .locator("span")
      .filter({ hasText: "Marketplace" })
      .first()
      .boundingBox();

    expect(sourceHeaderBox).not.toBeNull();
    expect(sourceBadgeBox).not.toBeNull();

    // Badge left edge should be within 5px of the header label left edge — both are at the Source column start.
    // If centered in a ~260px column, the offset would be ~130px — this test would catch that.
    expect(Math.abs(sourceBadgeBox!.x - sourceHeaderBox!.x)).toBeLessThan(5);
  });

  test("shows skill type subtitle in list view name column", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, DASHBOARD_MOCKS);

    await navigateToDashboard(page);
    await page.getByRole("button", { name: "List view" }).click();

    // data-analytics has purpose "domain" → "Domain" label
    await expect(page.getByText("Domain", { exact: true })).toBeVisible();
    // api-design has purpose "platform" → "Platform" label
    await expect(page.getByText("Platform", { exact: true })).toBeVisible();
  });

  test("can sort skills by name in list view", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, DASHBOARD_MOCKS);

    await navigateToDashboard(page);
    await page.getByRole("button", { name: "List view" }).click();

    // Default: ascending by name — "api-design" comes before "data-analytics"
    const apiBoxAsc = await page.getByText("api-design").first().boundingBox();
    const dataBoxAsc = await page.getByText("data-analytics").first().boundingBox();
    expect(apiBoxAsc!.y).toBeLessThan(dataBoxAsc!.y);

    // Click Name to reverse to descending
    await page.getByRole("button", { name: "Name" }).click();

    // Now "data-analytics" comes before "api-design"
    const apiBoxDesc = await page.getByText("api-design").first().boundingBox();
    const dataBoxDesc = await page.getByText("data-analytics").first().boundingBox();
    expect(dataBoxDesc!.y).toBeLessThan(apiBoxDesc!.y);
  });

  test("Marketplace button is disabled without marketplace URL configured", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        list_workspace_skills: [],
      };
    });

    await navigateToSkillsLibrary(page);

    const marketplaceButton = page.getByRole("button", { name: /marketplace/i }).first();
    await expect(marketplaceButton).toBeVisible();
    await expect(marketplaceButton).toBeDisabled();
  });

  // ─── Dashboard list view CRUD tests ──────────────────────────────────────

  const DASHBOARD_SKILLS_WITH_BUILDER = [
    ...DASHBOARD_SKILLS,
    {
      name: "my-skill",
      current_step: "Step 2/5",
      status: "in_progress",
      last_modified: "2025-01-13T08:00:00Z",
      tags: [],
      purpose: "domain",
      skill_source: "skill-builder",
      author_login: null,
      author_avatar: null,
      intake_json: null,
    },
  ];

  test("D1 — delete confirmation dialog opens for skill-builder skill", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, { ...DASHBOARD_MOCKS, list_skills: DASHBOARD_SKILLS_WITH_BUILDER, delete_skill: undefined });

    await navigateToDashboard(page);
    await page.getByRole("button", { name: "List view" }).click();

    // Click the "Delete skill" button in the skill-builder skill's row
    const builderRow = page.locator("tr").filter({ hasText: "my-skill" });
    await builderRow.getByLabel("Delete skill").click();

    // Confirmation dialog should appear
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("D2 — delete confirmation dialog opens for marketplace skill in list view", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, { ...DASHBOARD_MOCKS, delete_skill: undefined });

    await navigateToDashboard(page);
    await page.getByRole("button", { name: "List view" }).click();

    // Click "Delete skill" on the data-analytics (marketplace) row
    const dataAnalyticsRow = page.locator("tr").filter({ hasText: "data-analytics" });
    await dataAnalyticsRow.getByLabel("Delete skill").click();

    // Confirmation dialog should appear
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("D3 — edit workflow button only visible for skill-builder skills", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, { ...DASHBOARD_MOCKS, list_skills: DASHBOARD_SKILLS_WITH_BUILDER });

    await navigateToDashboard(page);
    await page.getByRole("button", { name: "List view" }).click();

    // "Edit workflow" should appear exactly once (only for skill-builder skill)
    const editWorkflowButtons = page.getByLabel("Edit workflow");
    await expect(editWorkflowButtons).toBeVisible();
    await expect(editWorkflowButtons).toHaveCount(1);
  });

  test("D4 — more actions dropdown only visible for skill-builder skills", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, { ...DASHBOARD_MOCKS, list_skills: DASHBOARD_SKILLS_WITH_BUILDER });

    await navigateToDashboard(page);
    await page.getByRole("button", { name: "List view" }).click();

    // "More actions" should appear exactly once (only for skill-builder skill)
    const moreActionsButtons = page.getByLabel("More actions");
    await expect(moreActionsButtons).toHaveCount(1);
  });

  test("D5 — test and download buttons visible for marketplace skills in list view", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, DASHBOARD_MOCKS);

    await navigateToDashboard(page);
    await page.getByRole("button", { name: "List view" }).click();

    // data-analytics is marketplace — should show Test and Download buttons
    const dataAnalyticsRow = page.locator("tr").filter({ hasText: "data-analytics" });
    await expect(dataAnalyticsRow.getByRole("button", { name: /test skill/i })).toBeVisible();
    await expect(dataAnalyticsRow.getByRole("button", { name: /download skill/i })).toBeVisible();
  });

  test("D6 — source filter shows only marketplace skills when filtered", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, DASHBOARD_MOCKS);

    await navigateToDashboard(page);
    await page.getByRole("button", { name: "List view" }).click();

    // Click the "Source" filter dropdown (first one — in the filter bar)
    await page.getByRole("button", { name: "Source" }).first().click();

    // Select "Marketplace" option (DropdownMenuCheckboxItem renders as menuitemcheckbox)
    await page.getByRole("menuitemcheckbox", { name: "Marketplace" }).click();

    // data-analytics (marketplace) should be visible; api-design (imported) should not
    await expect(page.getByText("data-analytics")).toBeVisible();
    await expect(page.getByText("api-design")).not.toBeVisible();
  });

  // ─── Version-aware marketplace import tests (settings-skills mode) ────────

  /** Minimal mock set required for the Settings > Skills page and marketplace dialog to load. */
  const MARKETPLACE_BASE_MOCKS = {
    get_settings: {
      anthropic_api_key: "sk-ant-test",
      workspace_path: "/tmp/ws",
      skills_path: "/tmp/skills",
      marketplace_url: "https://github.com/test-owner/test-repo",
    },
    parse_github_url: { owner: "test-owner", repo: "test-repo", branch: "main", subpath: null },
    get_installed_skill_names: [],
    list_skills: [],
  };

  test("T1 — shows Up to date badge when same name and same version installed (settings-skills mode)", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, {
      ...MARKETPLACE_BASE_MOCKS,
      list_github_skills: [
        {
          path: "skills/data-analytics",
          name: "data-analytics",
          version: "1.0.0",
          description: "Analytics skill",
          purpose: null,
          model: null,
          argument_hint: null,
          user_invocable: null,
          disable_model_invocation: null,
        },
      ],
      list_workspace_skills: [
        {
          skill_id: "id-1",
          skill_name: "data-analytics",
          version: "1.0.0",
          description: null,
          is_active: true,
          is_bundled: false,
          disk_path: "/tmp/skills/data-analytics",
          imported_at: "2025-01-01",
          purpose: null,
          model: null,
          argument_hint: null,
          user_invocable: null,
          disable_model_invocation: null,
        },
      ],
    });

    await navigateToSkillsLibrary(page);
    await page.getByRole("button", { name: /marketplace/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500);

    // Skill row should be visible inside the dialog
    await expect(dialog.getByText("data-analytics")).toBeVisible();

    // "Up to date" badge must appear for the same-version skill
    await expect(dialog.getByText("Up to date")).toBeVisible();

    // The action button is replaced by a non-button checkmark icon — no importable button for this skill
    const skillRow = dialog.locator("div").filter({ hasText: /^data-analytics/ }).first();
    await expect(skillRow.getByRole("button")).not.toBeVisible();
  });

  test("T2 — shows Update available badge when same name but different version installed (settings-skills mode)", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, {
      ...MARKETPLACE_BASE_MOCKS,
      list_github_skills: [
        {
          path: "skills/data-analytics",
          name: "data-analytics",
          version: "2.0.0",
          description: "Analytics skill",
          purpose: null,
          model: null,
          argument_hint: null,
          user_invocable: null,
          disable_model_invocation: null,
        },
      ],
      list_workspace_skills: [
        {
          skill_id: "id-1",
          skill_name: "data-analytics",
          version: "1.0.0",
          description: null,
          is_active: true,
          is_bundled: false,
          disk_path: "/tmp/skills/data-analytics",
          imported_at: "2025-01-01",
          purpose: null,
          model: null,
          argument_hint: null,
          user_invocable: null,
          disable_model_invocation: null,
        },
      ],
    });

    await navigateToSkillsLibrary(page);
    await page.getByRole("button", { name: /marketplace/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500);

    await expect(dialog.getByText("data-analytics")).toBeVisible();

    // "Update available" badge must appear for the upgraded skill
    await expect(dialog.getByText("Update available")).toBeVisible();

    // The import button must be enabled (upgrade is allowed)
    const importButton = dialog.getByRole("button").last();
    await expect(importButton).toBeEnabled();
  });

  test("T3 — fresh install has no version badge (settings-skills mode)", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, {
      ...MARKETPLACE_BASE_MOCKS,
      list_github_skills: [
        {
          path: "skills/new-skill",
          name: "new-skill",
          version: "1.0.0",
          description: "A brand new skill",
          purpose: null,
          model: null,
          argument_hint: null,
          user_invocable: null,
          disable_model_invocation: null,
        },
      ],
      list_workspace_skills: [],
    });

    await navigateToSkillsLibrary(page);
    await page.getByRole("button", { name: /marketplace/i }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForTimeout(500);

    await expect(page.getByText("new-skill")).toBeVisible();

    // Neither version badge should appear for a fresh install
    await expect(page.getByText("Up to date")).not.toBeVisible();
    await expect(page.getByText("Update available")).not.toBeVisible();

    // Import button must be present and enabled
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button").last()).toBeEnabled();
  });

  test("T4 — same null versions treated as same version, shows Up to date badge (settings-skills mode)", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, {
      ...MARKETPLACE_BASE_MOCKS,
      list_github_skills: [
        {
          path: "skills/no-version-skill",
          name: "no-version-skill",
          version: null,
          description: "Skill without version",
          purpose: null,
          model: null,
          argument_hint: null,
          user_invocable: null,
          disable_model_invocation: null,
        },
      ],
      list_workspace_skills: [
        {
          skill_id: "id-2",
          skill_name: "no-version-skill",
          version: null,
          description: null,
          is_active: true,
          is_bundled: false,
          disk_path: "/tmp/skills/no-version-skill",
          imported_at: "2025-01-01",
          purpose: null,
          model: null,
          argument_hint: null,
          user_invocable: null,
          disable_model_invocation: null,
        },
      ],
    });

    await navigateToSkillsLibrary(page);
    await page.getByRole("button", { name: /marketplace/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500);

    await expect(dialog.getByText("no-version-skill")).toBeVisible();

    // Both null versions are treated as equal — "Up to date" must appear
    await expect(dialog.getByText("Up to date")).toBeVisible();

    // No enabled import button (replaced by checkmark)
    const skillRow = dialog.locator("div").filter({ hasText: /^no-version-skill/ }).first();
    await expect(skillRow.getByRole("button")).not.toBeVisible();
  });

  // ─── Edit form pre-population tests (skill-library mode via dashboard) ────

  /** Mocks for the dashboard page with skill-library marketplace dialog. */
  const SKILL_LIBRARY_MARKETPLACE_MOCKS = {
    get_settings: {
      anthropic_api_key: "sk-ant-test",
      workspace_path: "/tmp/ws",
      skills_path: "/tmp/skills",
      marketplace_url: "https://github.com/test-owner/test-repo",
      dashboard_view_mode: null,
    },
    parse_github_url: { owner: "test-owner", repo: "test-repo", branch: "main", subpath: null },
    check_marketplace_updates: { library: [], workspace: [] },
    get_installed_skill_names: [],
    list_skills: [],
    get_all_tags: [],
    save_settings: undefined,
    check_workspace_path: true,
  };

  test("T5 — edit form pre-populates installed description when new version lacks it (skill-library mode)", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, {
      ...SKILL_LIBRARY_MARKETPLACE_MOCKS,
      list_github_skills: [
        {
          path: "skills/data-analytics",
          name: "data-analytics",
          version: "2.0.0",
          description: null,
          purpose: "domain",
          model: "claude-opus-4-6",
          argument_hint: null,
          user_invocable: null,
          disable_model_invocation: null,
        },
      ],
      get_dashboard_skill_names: ["data-analytics"],
      list_skills: [
        {
          name: "data-analytics",
          current_step: null,
          status: "completed",
          last_modified: "2025-01-01T00:00:00Z",
          tags: [],
          purpose: "domain",
          skill_source: "marketplace",
          author_login: null,
          author_avatar: null,
          intake_json: null,
          description: "My custom description",
          version: "1.0.0",
          model: null,
          argumentHint: null,
          userInvocable: null,
          disableModelInvocation: null,
        },
      ],
    });

    await navigateToDashboard(page);
    // Open skill-library marketplace dialog via top-bar Marketplace button
    await page.getByRole("button", { name: /marketplace/i }).first().click();
    const marketplaceDialog = page.getByRole("dialog").first();
    await expect(marketplaceDialog).toBeVisible();
    await page.waitForTimeout(500);

    await expect(marketplaceDialog.getByText("data-analytics")).toBeVisible();
    await expect(marketplaceDialog.getByText("Update available")).toBeVisible();

    // Click the edit & import button to open the edit form
    await marketplaceDialog.getByLabel("Import data-analytics").click();

    // Edit & Import Skill dialog should open
    await expect(page.getByText("Edit & Import Skill")).toBeVisible();

    // Description falls back to installed value since new version has null
    const descriptionField = page.getByLabel("Description");
    await expect(descriptionField).toHaveValue("My custom description");

    // Version is always the new version
    const versionField = page.getByLabel(/Version/);
    await expect(versionField).toHaveValue("2.0.0");
  });

  test("T6 — edit form shows new values when marketplace skill provides non-null description (skill-library mode)", async ({ page }) => {
    await page.addInitScript((mocks) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = mocks;
    }, {
      ...SKILL_LIBRARY_MARKETPLACE_MOCKS,
      list_github_skills: [
        {
          path: "skills/data-analytics",
          name: "data-analytics",
          version: "2.0.0",
          description: "New description from marketplace",
          purpose: "domain",
          model: null,
          argument_hint: null,
          user_invocable: null,
          disable_model_invocation: null,
        },
      ],
      get_dashboard_skill_names: ["data-analytics"],
      list_skills: [
        {
          name: "data-analytics",
          current_step: null,
          status: "completed",
          last_modified: "2025-01-01T00:00:00Z",
          tags: [],
          purpose: "domain",
          skill_source: "marketplace",
          author_login: null,
          author_avatar: null,
          intake_json: null,
          description: "Old custom description",
          version: "1.0.0",
          model: null,
          argumentHint: null,
          userInvocable: null,
          disableModelInvocation: null,
        },
      ],
    });

    await navigateToDashboard(page);
    await page.getByRole("button", { name: /marketplace/i }).first().click();
    const marketplaceDialog = page.getByRole("dialog").first();
    await expect(marketplaceDialog).toBeVisible();
    await page.waitForTimeout(500);

    await expect(marketplaceDialog.getByText("data-analytics")).toBeVisible();
    await expect(marketplaceDialog.getByText("Update available")).toBeVisible();

    // Click the edit & import button
    await marketplaceDialog.getByLabel("Import data-analytics").click();

    await expect(page.getByText("Edit & Import Skill")).toBeVisible();

    // New value wins over installed when new is non-null/non-empty
    const descriptionField = page.getByLabel("Description");
    await expect(descriptionField).toHaveValue("New description from marketplace");
  });
});

/**
 * Shared refine-page helpers for E2E tests.
 *
 * Mirrors workflow-helpers.ts: provides mock overrides and navigation
 * utilities so refine specs share the same foundation.
 *
 * Post-VU-550: Refine lives inside WorkspaceShell as a tab. The old
 * /refine route redirects to /?tab=refine. To show the refine UI we
 * need a skill selected in the sidebar first.
 */
import type { Page } from "@playwright/test";
import { waitForAppReady } from "./app-helpers";
import { E2E_SKILLS_PATH, E2E_WORKSPACE_PATH } from "./test-paths";

/**
 * Common mock overrides for the refine page.
 * Configures settings, skills in the sidebar, and skill file listing.
 */
export const REFINE_OVERRIDES: Record<string, unknown> = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: E2E_WORKSPACE_PATH,
    skills_path: E2E_SKILLS_PATH,
  },
  check_workspace_path: true,
  list_skills: [
    {
      name: "test-skill",
      purpose: "domain",
      current_step: null,
      status: "completed",
      last_modified: null,
      tags: [],
      author_login: null,
      author_avatar: null,
      intake_json: null,
    },
    {
      name: "analytics-skill",
      purpose: "source",
      current_step: null,
      status: "completed",
      last_modified: null,
      tags: [],
      author_login: null,
      author_avatar: null,
      intake_json: null,
    },
  ],
  get_skill_content_for_refine: [
    { path: "SKILL.md", content: "# Test Skill\n\nA skill for testing.\n\n## Instructions\n\nFollow these steps..." },
    { path: "references/glossary.md", content: "# Glossary\n\n- **Term**: Definition" },
    { path: "references/checklist.md", content: "# Delivery Checklist\n\n- Validate inputs\n- Log failures\n- Add regression coverage" },
    { path: "references/troubleshooting.md", content: "# Troubleshooting\n\n## Common failures\n\n- Missing configuration\n- Invalid payload shape\n- Timeout during sync" },
  ],
  start_refine_session: {
    session_id: "e2e-refine-session-001",
    skill_name: "test-skill",
    created_at: new Date().toISOString(),
  },
  send_refine_message: "refine-test-skill-e2e-001",
  close_refine_session: undefined,
  acquire_lock: undefined,
  release_lock: undefined,
  cleanup_skill_sidecar: undefined,
  get_disabled_steps: [],
};

/**
 * Navigate to the refine page without a pre-selected skill.
 * In the new UI, this goes to the dashboard with skills in the sidebar.
 */
export async function navigateToRefine(
  page: Page,
  overrides?: Record<string, unknown>,
): Promise<void> {
  const merged = { ...REFINE_OVERRIDES, ...overrides };
  await page.addInitScript((o) => {
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
  }, merged);
  await page.goto("/");
  await waitForAppReady(page);
  // Wait for skills to load in the sidebar
  await page.getByText("test-skill").first().waitFor({ timeout: 10_000 });
}

/**
 * Navigate to the refine page with test-skill selected.
 * Clicks the skill in the sidebar to activate it (since it's "completed",
 * it uses onSelectSkill which sets activeSkill and shows WorkspaceShell),
 * then switches to the Refine tab.
 */
export async function navigateToRefineWithSkill(
  page: Page,
  overrides?: Record<string, unknown>,
): Promise<void> {
  const merged = { ...REFINE_OVERRIDES, ...overrides };
  await page.addInitScript((o) => {
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
  }, merged);
  await page.goto("/");
  await waitForAppReady(page);

  // Wait for skills to load in the sidebar, then click test-skill to select it
  const skillRow = page.getByText("test-skill").first();
  await skillRow.waitFor({ timeout: 10_000 });
  await skillRow.click();

  // WorkspaceShell should appear — click the Refine tab
  const refineTab = page.getByRole("tab", { name: "Refine" });
  await refineTab.waitFor({ timeout: 10_000 });
  await refineTab.click();

  // Wait for the refine UI to hydrate (chat input visible)
  await page.getByTestId("refine-chat-input").waitFor({ timeout: 10_000 });
}

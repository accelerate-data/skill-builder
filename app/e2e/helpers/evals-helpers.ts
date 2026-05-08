/**
 * Shared Eval Workbench helpers for the scenario-only workbench E2E tests.
 */
import type { Page } from "@playwright/test";
import { waitForAppReady } from "./app-helpers";
import {
  E2E_PREFERRED_MODEL,
  E2E_SKILLS_PATH,
  E2E_WORKSPACE_PATH,
} from "./test-paths";

/**
 * Common mock overrides for Eval Workbench.
 * Configures settings and a completed skill in the sidebar.
 */
export const EVALS_OVERRIDES: Record<string, unknown> = {
  get_settings: {
    model_settings: {
      provider: "anthropic",
      model: E2E_PREFERRED_MODEL,
      api_key: "sk-ant-test",
      base_url: null,
      reasoning_effort: "auto",
      usage_id: "workflow",
    },
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
  ],
};

/**
 * Navigate to Eval Workbench with test-skill selected.
 */
export async function navigateToEvalsTab(
  page: Page,
  overrides?: Record<string, unknown>,
): Promise<void> {
  const merged = { ...EVALS_OVERRIDES, ...overrides };
  await page.addInitScript((o) => {
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
  }, merged);
  await page.goto("/");
  await waitForAppReady(page);

  // Click test-skill in the sidebar
  const skillRow = page.getByText("test-skill").first();
  await skillRow.waitFor({ timeout: 10_000 });
  await skillRow.click();

  const workbenchTab = page.getByRole("tab", { name: "Eval Workbench" });
  await workbenchTab.waitFor({ timeout: 10_000 });
  await workbenchTab.click();

  await page.getByRole("heading", { name: "Scenarios" }).waitFor({
    timeout: 10_000,
  });
}

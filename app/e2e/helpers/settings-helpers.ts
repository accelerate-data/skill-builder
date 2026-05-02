import type { Page } from "@playwright/test";
import { reloadWithOverrides } from "./app-helpers";
import {
  E2E_PREFERRED_MODEL,
  E2E_SKILLS_PATH,
  E2E_WORKSPACE_PATH,
} from "./test-paths";

/** Common overrides for a configured workspace on the settings page. */
export const BASE_SETTINGS_OVERRIDES: Record<string, unknown> = {
  get_settings: {
    model_settings: {
      provider: "anthropic",
      model: E2E_PREFERRED_MODEL,
      api_key: "sk-ant-test-e2e",
      base_url: null,
      reasoning_effort: "auto",
      usage_id: "workflow",
    },
    workspace_path: E2E_WORKSPACE_PATH,
    skills_path: E2E_SKILLS_PATH,
  },
  check_workspace_path: true,
  list_skills: [],
  github_get_user: null,
  list_documents: [],
  list_skills_for_documents: [],
};

/**
 * Reload to /settings with the given overrides merged into BASE_SETTINGS_OVERRIDES,
 * then click the named section tab.
 */
export async function navigateToSettingsSection(
  page: Page,
  section: string,
  overrides?: Record<string, unknown>,
): Promise<void> {
  await reloadWithOverrides(page, { ...BASE_SETTINGS_OVERRIDES, ...overrides });
  await page.goto("/settings");
  const { waitForAppReady } = await import("./app-helpers");
  await waitForAppReady(page);
  await page.getByRole("button", { name: section }).click();
}

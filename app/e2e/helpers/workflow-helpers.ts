/**
 * Shared workflow helpers for E2E tests.
 *
 * Extracts the common navigation and mock-override setup so
 * workflow-agent, workflow-steps, and workflow-navigation specs
 * can all share the same foundation.
 */
import type { Page } from "@playwright/test";
import { waitForAppReady } from "./app-helpers";

/**
 * Common mock overrides that configure a workspace + skill so the workflow
 * page can render and the Start button is enabled.
 */
export const WORKFLOW_OVERRIDES: Record<string, unknown> = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: "/tmp/test-workspace",
    skills_path: "/tmp/test-skills",
  },
  check_workspace_path: true,
  list_skills: [
    {
      name: "test-skill",
      purpose: "domain",
      current_step: null,
      status: null,
      last_modified: null,
    },
  ],
  get_workflow_state: { run: null, steps: [] },
  save_workflow_state: undefined,
  capture_step_artifacts: [],
  reset_workflow_step: undefined,
  cleanup_skill_sidecar: undefined,
  run_workflow_step: "agent-001",
  read_file: "",
  get_artifact_content: null,
  verify_step_output: true,
  write_file: undefined,
  get_disabled_steps: [],
  end_workflow_session: undefined,
  acquire_lock: undefined,
  release_lock: undefined,
  preview_step_reset: [],
  get_step_agent_runs: [],
};

/**
 * Navigate to the workflow page for test-skill.
 * Uses `addInitScript` so mock overrides survive page navigation.
 * Waits for the splash screen to dismiss and the workflow page to hydrate.
 *
 * @param page  Playwright page
 * @param overrides  Additional or replacement mock overrides merged on top of WORKFLOW_OVERRIDES
 */
export async function navigateToWorkflow(
  page: Page,
  overrides?: Record<string, unknown>,
): Promise<void> {
  const merged = { ...WORKFLOW_OVERRIDES, ...overrides };
  await page.addInitScript((o) => {
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
  }, merged);
  await page.goto("/skill/test-skill");
  await waitForAppReady(page);
  await page.getByText("Workflow Steps").waitFor({ timeout: 10_000 });
}

/**
 * Navigate to the workflow page and switch from review mode (default)
 * to update mode so Start Step, Save, and other action buttons are visible.
 */
export async function navigateToWorkflowUpdateMode(
  page: Page,
  overrides?: Record<string, unknown>,
): Promise<void> {
  await navigateToWorkflow(page, overrides);
  await page.getByRole("button", { name: "Update" }).click();
}

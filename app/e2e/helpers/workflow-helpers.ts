/**
 * Shared workflow helpers for E2E tests.
 *
 * Extracts the common navigation and mock-override setup so
 * workflow-agent, workflow-steps, and workflow-navigation specs
 * can all share the same foundation.
 */
import type { Page } from "@playwright/test";
import { waitForAppReady } from "./app-helpers";
import {
  E2E_SKILLS_PATH,
  E2E_WORKSPACE_PATH,
  skillContextPath,
} from "./test-paths";

/**
 * Common mock overrides that configure a workspace + skill so the workflow
 * page can render and the Start button is enabled.
 */
export const WORKFLOW_OVERRIDES: Record<string, unknown> = {
  get_settings: {
    model_settings: {
      provider: "anthropic",
      model: "claude-sonnet-4-5",
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
      id: 301,
      name: "test-skill",
      purpose: "domain",
      current_step: null,
      status: null,
      last_modified: null,
      tags: [],
      author_login: null,
      author_avatar: null,
      intake_json: null,
    },
  ],
  get_workflow_state: { run: null, steps: [] },
  save_workflow_state: undefined,
  capture_step_artifacts: [],
  reset_workflow_step: undefined,
  run_workflow_step: "agent-001",
  // Provide canonical step-0 artifacts so workflow completion can advance in e2e mocks.
  read_file: {
    [skillContextPath(E2E_SKILLS_PATH, "test-skill", "research-plan.md")]:
      "# Research Results\n\nAnalysis complete.",
    [skillContextPath(E2E_WORKSPACE_PATH, "test-skill", "research-plan.md")]:
      "# Research Results\n\nAnalysis complete.",
    "*": "",
  },
  get_artifact_content: null,
  verify_step_output: true,
  write_file: undefined,
  get_disabled_steps: [],
  end_workflow_session: undefined,
  acquire_lock: undefined,
  release_lock: undefined,
  preview_step_reset: [],
  get_step_agent_runs: [],
  get_clarifications: {
    skill_id: "test-skill",
    version: "1",
    refinement_count: 0,
    must_answer_count: 0,
    question_count: 1,
    section_count: 1,
    title: "Clarifications",
    created_at: 0,
    updated_at: 0,
    sections: [
      { section_id: 1, ordinal: 0, title: "General" },
    ],
    questions: [
      {
        question_id: "Q1",
        section_id: 1,
        parent_question_id: null,
        ordinal: 0,
        title: "Primary focus",
        text: "What should this skill enable the agent to do?",
        must_answer: false,
        answer_choice: null,
        answer_text: null,
        choices: [],
        refinements: [],
      },
    ],
    notes: [],
  },
  get_decisions: null,
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
  await page.goto("/workflow/301");
  await waitForAppReady(page);
  await page.getByText("STEPS").waitFor({ timeout: 10_000 });
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

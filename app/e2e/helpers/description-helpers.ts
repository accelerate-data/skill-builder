import type { Page } from "@playwright/test";
import { reloadWithOverrides } from "./app-helpers";
import { E2E_SKILLS_PATH, E2E_WORKSPACE_PATH } from "./test-paths";
import {
  DESCRIPTION_OPTIMIZATION_RESULT,
  GENERATED_DESCRIPTION_EVAL_QUERIES,
} from "../fixtures/description-optimization";
import { emitTauriEvent } from "./agent-simulator";

export const DESCRIPTION_OVERRIDES: Record<string, unknown> = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: E2E_WORKSPACE_PATH,
    skills_path: E2E_SKILLS_PATH,
    preferred_model: "sonnet",
  },
  check_workspace_path: true,
  list_skills: [
    {
      name: "test-skill",
      purpose: "domain",
      current_step: null,
      status: "completed",
      last_modified: null,
      created_at: null,
      tags: ["analytics"],
      author_login: null,
      author_avatar: null,
      intake_json: null,
      source: null,
      description: "Use when doing dbt work.",
      version: "1.0.0",
      model: null,
      argumentHint: null,
      userInvocable: false,
      disableModelInvocation: false,
      plugin_slug: "skills",
      plugin_display_name: "Skills",
      is_default_plugin: true,
    },
  ],
  load_eval_queries: [],
  save_eval_queries: undefined,
  start_generate_desc_evals: "desc-evals-agent-001",
  run_optimization_loop: DESCRIPTION_OPTIMIZATION_RESULT,
  apply_description: "1.0.1",
  write_desc_opt_log: undefined,
  get_skill_content_for_refine: [
    {
      path: "SKILL.md",
      content:
        "---\nname: test-skill\ndescription: Use when doing dbt work.\nversion: 1.0.0\n---\n# Test Skill\n",
    },
  ],
};

export async function navigateToDescriptionTab(
  page: Page,
  overrides?: Record<string, unknown>,
): Promise<void> {
  await reloadWithOverrides(page, { ...DESCRIPTION_OVERRIDES, ...overrides });

  const skillRow = page.getByText("test-skill").first();
  await skillRow.waitFor({ timeout: 10_000 });
  await skillRow.click();

  const descriptionTab = page.getByRole("tab", { name: "Optimize Description" });
  await descriptionTab.waitFor({ timeout: 10_000 });
  await descriptionTab.click();
}

export async function emitGeneratedDescriptionQueries(page: Page): Promise<void> {
  await emitTauriEvent(page, "description:eval-queries-generated", {
    skillName: "test-skill",
    queries: GENERATED_DESCRIPTION_EVAL_QUERIES,
  });
}

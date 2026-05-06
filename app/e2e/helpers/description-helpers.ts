import type { Page } from "@playwright/test";
import { reloadWithOverrides } from "./app-helpers";
import { E2E_SKILLS_PATH, E2E_WORKSPACE_PATH } from "./test-paths";

const TRIGGER_SCENARIO = {
  name: "Routing checks",
  tags: ["trigger"] as const,
  cases: [
    {
      id: "case-1",
      prompt: "Reconcile open customer invoices",
      expectedOutcome: null,
      shouldTrigger: true,
      assertions: [],
    },
  ],
};

const TRIGGER_RUN_SUMMARY = {
  id: "run-trigger-1",
  scenarioName: "Routing checks",
  mode: "trigger" as const,
  status: "completed",
  summary: { passed: 3, total: 4 },
  createdAt: "2026-05-04T00:00:00Z",
  completedAt: "2026-05-04T00:05:00Z",
  results: [],
  descriptionCandidates: [],
};

export const TRIGGER_CANDIDATES = [
  {
    id: "candidate-1",
    runId: "draft-run",
    label: "Candidate 1",
    description: "Use when the user needs invoice reconciliation or payment matching",
    rationale: "Best routing precision",
    rank: 1,
  },
  {
    id: "candidate-2",
    runId: "draft-run",
    label: "Candidate 2",
    description: "Use when reconciling invoice balances and customer payment activity",
    rationale: "Covers payments but starts broadening into generic billing help",
    rank: 2,
  },
  {
    id: "candidate-3",
    runId: "draft-run",
    label: "Candidate 3",
    description: "Use for invoice cleanup, credits, and receivables follow-up tasks",
    rationale: "Adds extra finance operations the baseline skill does not own",
    rank: 3,
  },
] as const;

const TRIGGER_RUN_DETAIL = {
  ...TRIGGER_RUN_SUMMARY,
  results: [
    {
      id: "result-1",
      runId: "run-trigger-1",
      caseId: "case-1",
      candidateId: "candidate-1",
      passed: true,
      score: 1,
      output: {},
      reason: "Keeps invoice reconciliation within routing scope",
    },
  ],
  descriptionCandidates: TRIGGER_CANDIDATES,
};

export const DESCRIPTION_OVERRIDES: Record<string, unknown> = {
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
  list_scenarios: [{ name: TRIGGER_SCENARIO.name, tags: TRIGGER_SCENARIO.tags }],
  load_scenario: TRIGGER_SCENARIO,
  save_scenario: TRIGGER_SCENARIO,
  list_eval_runs: [TRIGGER_RUN_SUMMARY],
  read_eval_run: TRIGGER_RUN_DETAIL,
  suggest_description_candidates: TRIGGER_CANDIDATES,
  run_eval_workbench: TRIGGER_RUN_SUMMARY,
  apply_description_candidate: {
    description:
      "Use when the user needs invoice reconciliation or payment matching",
  },
  build_refine_improvement_brief: {
    runId: "run-trigger-1",
    brief: "Tighten routing boundaries around invoice reconciliation",
  },
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

  const workbenchTab = page.getByRole("tab", { name: "Eval Workbench" });
  await workbenchTab.waitFor({ timeout: 10_000 });
  await workbenchTab.click();

  const triggerTab = page.getByRole("tab", { name: "Trigger" });
  await triggerTab.waitFor({ timeout: 10_000 });
  await triggerTab.click();
}

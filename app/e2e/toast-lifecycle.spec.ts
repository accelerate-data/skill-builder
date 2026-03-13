import { test, expect, type Page } from "@playwright/test";
import { waitForAppReady } from "./helpers/app-helpers";
import { navigateToWorkflowUpdateMode, WORKFLOW_OVERRIDES } from "./helpers/workflow-helpers";
import { navigateToRefineWithSkill } from "./helpers/refine-helpers";
import { emitTauriEvent, simulateAgentRun } from "./helpers/agent-simulator";
import usageData from "./fixtures/usage-data.json" with { type: "json" };

const DISMISS_WAIT_MS = 5600;
const WORKSPACE_EVAL_PATH = "/tmp/test-workspace/test-skill/answer-evaluation.json";
const SKILLS_CLARIFICATIONS_PATH = "/tmp/test-skills/test-skill/context/clarifications.json";
const CLARIFICATIONS_JSON = JSON.stringify({
  version: "1",
  metadata: {
    title: "Clarifications",
    question_count: 1,
    section_count: 1,
    refinement_count: 0,
    must_answer_count: 0,
    priority_questions: [],
  },
  sections: [
    {
      id: "S1",
      title: "General",
      questions: [
        {
          id: "Q1",
          title: "Question 1",
          must_answer: false,
          text: "What matters most?",
          choices: [],
          recommendation: null,
          answer_choice: "custom",
          answer_text: "Consistency and observability.",
          refinements: [],
        },
      ],
    },
  ],
  notes: [],
});

async function expectToastAutoDismiss(page: Page, matcher: RegExp): Promise<void> {
  const toast = page.getByText(matcher).first();
  await expect(toast).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(DISMISS_WAIT_MS);
  await expect(toast).not.toBeVisible();
}

async function expectToastSticky(page: Page, matcher: RegExp): Promise<void> {
  const toast = page.getByText(matcher).first();
  await expect(toast).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(DISMISS_WAIT_MS);
  await expect(toast).toBeVisible();
}

async function setReadFileOverride(page: Page, filePath: string, content: string): Promise<void> {
  await page.evaluate(({ filePath, content }) => {
    const root = window as unknown as Record<string, unknown>;
    const overrides = root.__TAURI_MOCK_OVERRIDES__ as Record<string, unknown>;
    const current = overrides.read_file;
    const next =
      current && typeof current === "object" && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : { "*": String(current ?? "") };
    next[filePath] = content;
    overrides.read_file = next;
  }, { filePath, content });
}

test.describe("Toast lifecycle policy", { tag: "@toast" }, () => {
  test("app-layout update info toast auto-dismisses around 5s", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          workspace_path: "/tmp/test-workspace",
          skills_path: "/tmp/test-skills",
          marketplace_registries: [
            { name: "Test", source_url: "owner/repo", enabled: true },
          ],
          auto_update: false,
        },
        parse_github_url: { owner: "owner", repo: "repo", branch: "main", subpath: null },
        check_marketplace_updates: {
          library: [{ name: "sales-skill", path: "skills/sales-skill", version: "1.1.0" }],
          workspace: [],
        },
        reconcile_startup: { orphans: [], notifications: [], auto_cleaned: 0, discovered_skills: [] },
        list_skills: [],
      };
    });

    await page.goto("/");
    await waitForAppReady(page);
    await expectToastAutoDismiss(page, /Dashboard: update available for 1 skill: sales-skill/);
  });

  test("app-layout startup skipped info toast auto-dismisses", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          workspace_path: "/tmp/test-workspace",
          skills_path: "/tmp/test-skills",
          marketplace_registries: [],
        },
        reconcile_startup: {
          orphans: [],
          notifications: ["Removed stale metadata row"],
          auto_cleaned: 0,
          discovered_skills: [],
        },
        list_skills: [],
      };
    });

    await page.goto("/");
    await waitForAppReady(page);
    await page.getByRole("button", { name: "Continue Without Applying" }).click();
    await expectToastAutoDismiss(
      page,
      /Startup reconciliation skipped\. No automatic changes were applied\./,
    );
  });

  test("app-layout startup auto-update shows summary toast", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          workspace_path: "/tmp/test-workspace",
          skills_path: "/tmp/test-skills",
          marketplace_registries: [
            { name: "Test", source_url: "owner/repo", enabled: true },
          ],
          auto_update: true,
        },
        check_marketplace_updates: {
          library: [
            {
              name: "sales-skill",
              path: "skills/sales-skill",
              version: "1.1.0",
              source_url: "owner/repo",
            },
          ],
          workspace: [],
        },
        import_marketplace_to_library: [],
        reconcile_startup: { orphans: [], notifications: [], auto_cleaned: 0, discovered_skills: [] },
        list_skills: [],
      };
    });

    await page.goto("/");
    await waitForAppReady(page);
    await expect(page.getByText(/Auto-updated 1 skill/)).toBeVisible({ timeout: 5000 });
  });

  test("workflow info auto-dismisses and warning stays sticky", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page, {
      ...WORKFLOW_OVERRIDES,
      get_settings: {
        anthropic_api_key: "sk-ant-test",
        workspace_path: "/tmp/test-workspace",
        skills_path: "/tmp/test-skills",
      },
      get_workflow_state: {
        run: { current_step: 1, purpose: "domain" },
        steps: [
          { step_id: 0, status: "completed" },
          { step_id: 1, status: "completed" },
        ],
      },
      run_answer_evaluator: "gate-agent-001",
      read_file: {
        [SKILLS_CLARIFICATIONS_PATH]: CLARIFICATIONS_JSON,
        "*": CLARIFICATIONS_JSON,
      },
    });

    const evalJson = JSON.stringify({
      verdict: "mixed",
      answered_count: 4,
      empty_count: 3,
      vague_count: 2,
      total_count: 9,
      reasoning: "4 of 9 answered; 3 blank and 2 vague.",
      per_question: [
        { question_id: "Q1", verdict: "clear" },
        { question_id: "Q2", verdict: "clear" },
        { question_id: "Q3", verdict: "clear" },
      ],
    });
    await setReadFileOverride(page, WORKSPACE_EVAL_PATH, evalJson);

    await page.getByRole("button", { name: "Continue" }).first().click();
    await simulateAgentRun(page, { agentId: "gate-agent-001", messages: ["Evaluating answers..."] });

    await expect(page.getByRole("button", { name: "Let Me Answer" })).toBeVisible({ timeout: 5000 });
    await setReadFileOverride(page, SKILLS_CLARIFICATIONS_PATH, "not-json");
    await page.getByRole("button", { name: "Let Me Answer" }).click();

    await expectToastAutoDismiss(page, /Refreshing evaluator feedback/);
    await expectToastSticky(page, /Feedback file could not be parsed\. You can still answer manually\./);
  });

  test("refine session-limit info toast auto-dismisses", async ({ page }) => {
    await navigateToRefineWithSkill(page);

    const input = page.getByTestId("refine-chat-input");
    await input.fill("check constraints");
    await page.getByTestId("refine-send-button").click();

    const thinking = page.getByTestId("refine-agent-thinking");
    await thinking.waitFor({ timeout: 5000 });
    const agentId = await thinking.getAttribute("data-agent-id");
    expect(agentId).toBeTruthy();

    await emitTauriEvent(page, "agent-session-exhausted", {
      agent_id: agentId,
      sessionId: "refine-session-001",
      type: "session_exhausted",
      timestamp: Date.now(),
    });
    await emitTauriEvent(page, "agent-exit", {
      agent_id: agentId,
      success: true,
    });

    await expectToastAutoDismiss(
      page,
      /This refine session has reached its limit\. Please start a new session to continue\./,
    );
  });

  test("settings save failure toast stays sticky", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        save_settings: new Error("DB error"),
      };
    });

    await page.goto("/settings");
    await waitForAppReady(page);

    const apiKey = page.getByPlaceholder("sk-ant-...");
    await apiKey.fill("sk-ant-updated");
    await apiKey.blur();

    await expectToastSticky(page, /Failed to save: Error: DB error/);
  });

  test("dashboard import failure toast stays sticky", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          workspace_path: "/tmp/test-workspace",
          skills_path: "/tmp/test-skills",
        },
        check_workspace_path: true,
        list_skills: [],
        parse_skill_file: new Error("bad package"),
      };
    });

    await page.goto("/");
    await waitForAppReady(page);
    await page.getByRole("button", { name: /^Import$/i }).click();

    await expectToastSticky(page, /Import failed: bad package/);
  });

  test("skill tester and workflow errors stay sticky", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          workspace_path: "/tmp/test-workspace",
          skills_path: "/tmp/test-skills",
        },
        list_models: [],
        get_workspace_path: "/tmp/test-workspace",
        list_refinable_skills: [{ name: "my-skill", purpose: "domain" }],
        has_running_agents: false,
        prepare_skill_test: {
          test_id: "test-toast-001",
          baseline_cwd: "/tmp/test-baseline",
          with_skill_cwd: "/tmp/test-with",
          transcript_log_dir: "/tmp/test-workspace/my-skill/logs",
        },
        start_agent: "agent-id-mock",
        cleanup_skill_test: undefined,
        cleanup_skill_sidecar: undefined,
      };
    });
    await page.goto("/test");
    await waitForAppReady(page);
    await page.evaluate(async () => {
      const { useWorkflowStore } = await import("/src/stores/workflow-store.ts");
      useWorkflowStore.setState({ isRunning: true });
    });
    await page.getByRole("button", { name: /select a skill/i }).click();
    await page.getByRole("option", { name: /my-skill/i }).click();
    await page.getByPlaceholder("Describe a task to test the skill against...").fill("run a validation");
    await page.getByRole("button", { name: /run test/i }).click();
    await expectToastSticky(page, /Cannot start test while other agents are running/);
    await page.evaluate(async () => {
      const { useWorkflowStore } = await import("/src/stores/workflow-store.ts");
      useWorkflowStore.setState({ isRunning: false });
    });

    await navigateToWorkflowUpdateMode(page, {
      ...WORKFLOW_OVERRIDES,
      get_settings: {
        anthropic_api_key: "sk-ant-test",
        workspace_path: null,
        skills_path: "/tmp/test-skills",
      },
    });
    await page.getByRole("button", { name: "Start Step" }).click();
    await expectToastSticky(page, /Missing workspace path/);
  });

  test("usage reset failure toast stays sticky", async ({ page }) => {
    await page.addInitScript((overrides) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
    }, {
      get_usage_summary: usageData.summary,
      get_recent_workflow_sessions: usageData.sessions,
      get_agent_runs: [],
      get_usage_by_step: usageData.byStep,
      get_usage_by_model: usageData.byModel,
      get_usage_by_day: [],
      get_workflow_skill_names: [],
    });

    await page.goto("/usage");
    await waitForAppReady(page);
    await page.evaluate(async () => {
      const usageStoreModule = await import("/src/stores/usage-store.ts");
      usageStoreModule.useUsageStore.setState({
        resetCounter: async () => {
          throw new Error("DB down");
        },
      });
    });

    await page.getByRole("button", { name: /Reset/ }).click();
    await page.getByRole("button", { name: "Reset All Data" }).click();

    await expectToastSticky(page, /Failed to reset usage: DB down/);
  });
});

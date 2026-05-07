import { expect, test } from "@playwright/test";
import { reloadWithOverrides } from "../helpers/app-helpers";
import { EVALS_OVERRIDES } from "../helpers/evals-helpers.js";
import {
  getTrackedInvokeCount,
  getTrackedInvokes,
  trackInvokes,
} from "../helpers/invoke-tracking.js";

const PERFORMANCE_SCENARIO = {
  id: "case-1",
  name: "Regression",
  prompt: "Forecast next quarter revenue for the west region pipeline.",
  expectations: ["Explains the forecast assumptions."],
};

const AUTHORED_SCENARIO = {
  ...PERFORMANCE_SCENARIO,
  prompt: "Summarize the pipeline risk for the west region.",
  expectations: ["Summarizes the main pipeline blockers."],
};

const DEFINITIVE_SCENARIO = {
  ...AUTHORED_SCENARIO,
  prompt: "Forecast next quarter revenue for the west region pipeline.",
  expectations: ["Explains the forecast assumptions."],
};

const PERFORMANCE_RUN_SUMMARY = {
  id: "run-1",
  scenarioName: "Regression",
  mode: "performance" as const,
  status: "completed",
  summary: { passed: 1, total: 1 },
  createdAt: "2026-05-04T00:00:00Z",
  completedAt: "2026-05-04T00:05:00Z",
  results: [],
  descriptionCandidates: [],
};

const PERFORMANCE_RUN_DETAIL = {
  ...PERFORMANCE_RUN_SUMMARY,
  results: [
    {
      id: "result-1",
      runId: "run-1",
      caseId: "case-1",
      candidateId: "current-skill",
      passed: false,
      score: 0.25,
      output: {},
      reason: "Missed assumptions section",
    },
  ],
};

async function navigateToEvalWorkbench(
  page: Parameters<Parameters<typeof test>[1]>[0]["page"],
  overrides?: Record<string, unknown>,
) {
  await reloadWithOverrides(page, { ...EVALS_OVERRIDES, ...overrides });

  const skillRow = page.getByText("test-skill").first();
  await skillRow.waitFor({ timeout: 10_000 });
  await skillRow.click();

  const workbenchTab = page.getByRole("tab", { name: "Eval Workbench" });
  await workbenchTab.waitFor({ timeout: 10_000 });
  await workbenchTab.click();
  await page.getByRole("heading", { name: "Scenarios" }).waitFor({ timeout: 10_000 });
}

test.describe("Eval Workbench", { tag: "@evals" }, () => {
  test("authors a scenario, defines it, evaluates it, and sends the result to Refine", async ({
    page,
  }) => {
    await navigateToEvalWorkbench(page, {
      list_scenarios: [{ name: AUTHORED_SCENARIO.name }],
      load_scenario: AUTHORED_SCENARIO,
      create_scenario: AUTHORED_SCENARIO,
      define_eval_scenario: DEFINITIVE_SCENARIO,
      list_eval_runs: [],
      run_eval_workbench: PERFORMANCE_RUN_SUMMARY,
      read_eval_run: PERFORMANCE_RUN_DETAIL,
      build_refine_improvement_brief: {
        runId: "run-1",
        brief: "Improve assumptions handling",
      },
    });
    await trackInvokes(page, [
      "create_scenario",
      "define_eval_scenario",
      "run_eval_workbench",
      "build_refine_improvement_brief",
    ]);

    await expect(page.getByRole("heading", { name: "Scenarios" })).toBeVisible();
    await expect(page.getByText("Regression")).toBeVisible();
    await page.getByRole("button", { name: "New scenario" }).click();
    await expect(await getTrackedInvokeCount(page, "create_scenario")).toBe(1);
    await expect(page.getByLabel("User prompt")).toHaveValue(AUTHORED_SCENARIO.prompt);

    await page.getByRole("button", { name: /^suggest$/i }).click();
    await expect(await getTrackedInvokeCount(page, "define_eval_scenario")).toBe(1);
    await expect(page.getByLabel("User prompt")).toHaveValue(DEFINITIVE_SCENARIO.prompt);

    await page.getByRole("button", { name: "Evaluate" }).click();

    await expect(page.getByText("Missed assumptions section")).toBeVisible();
    await expect(await getTrackedInvokeCount(page, "run_eval_workbench")).toBe(1);
    const runCalls = await getTrackedInvokes(page, "run_eval_workbench");
    expect(runCalls[0]?.args).toMatchObject({
      request: {
        candidateIds: ["current-skill"],
      },
    });

    await page.getByRole("button", { name: "Send to Refine" }).click();

    await expect(await getTrackedInvokeCount(page, "build_refine_improvement_brief")).toBe(1);
    const refineCalls = await getTrackedInvokes(
      page,
      "build_refine_improvement_brief",
    );
    expect(refineCalls[0]?.args).toMatchObject({
      runId: "run-1",
    });
    await expect(page.getByTestId("refine-chat-input")).toBeVisible();
    await expect(page.getByTestId("refine-chat-input")).toContainText(
      "Improve assumptions handling",
    );
  });

  test("evaluates the package and sends the failure brief to Refine", async ({
    page,
  }) => {
    await navigateToEvalWorkbench(page, {
      list_scenarios: [{ name: PERFORMANCE_SCENARIO.name }],
      load_scenario: PERFORMANCE_SCENARIO,
      list_eval_runs: [PERFORMANCE_RUN_SUMMARY],
      read_eval_run: PERFORMANCE_RUN_DETAIL,
      run_eval_workbench: PERFORMANCE_RUN_SUMMARY,
      build_refine_improvement_brief: {
        runId: "run-1",
        brief: "Improve assumptions handling",
      },
    });
    await trackInvokes(page, [
      "run_eval_workbench",
      "build_refine_improvement_brief",
    ]);
    await page.getByRole("button", { name: "Regression" }).click();

    await page.getByRole("button", { name: "Evaluate" }).click();

    await expect(page.getByText("Missed assumptions section")).toBeVisible();
    await expect(await getTrackedInvokeCount(page, "run_eval_workbench")).toBe(1);
    const runCalls = await getTrackedInvokes(page, "run_eval_workbench");
    expect(runCalls[0]?.args).toMatchObject({
      request: {
        candidateIds: ["current-skill"],
      },
    });

    await page.getByRole("button", { name: "Send to Refine" }).click();

    await expect(await getTrackedInvokeCount(page, "build_refine_improvement_brief")).toBe(1);
    const refineCalls = await getTrackedInvokes(
      page,
      "build_refine_improvement_brief",
    );
    expect(refineCalls[0]?.args).toMatchObject({
      runId: "run-1",
    });
  });
});

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
  assertions: ["Explains the forecast assumptions."],
};

const AUTHORED_SCENARIO = {
  ...PERFORMANCE_SCENARIO,
  prompt: "Summarize the pipeline risk for the west region.",
  expectations: ["Summarizes the main pipeline blockers."],
};

const DEFINITIVE_SCENARIO = {
  ...AUTHORED_SCENARIO,
  prompt: "Forecast next quarter revenue for the west region pipeline.",
  assertions: ["Explains the forecast assumptions."],
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
  test("authors a scenario and defines it with the scenario suggestion flow", async ({
    page,
  }) => {
    await navigateToEvalWorkbench(page, {
      list_scenarios: [{ name: AUTHORED_SCENARIO.name }],
      load_scenario: AUTHORED_SCENARIO,
      create_scenario: AUTHORED_SCENARIO,
      define_eval_scenario: DEFINITIVE_SCENARIO,
    });
    await trackInvokes(page, ["create_scenario", "define_eval_scenario"]);

    await expect(page.getByRole("heading", { name: "Scenarios" })).toBeVisible();
    await expect(page.getByText("Regression")).toBeVisible();
    await page.getByRole("button", { name: "New scenario" }).click();
    await expect(await getTrackedInvokeCount(page, "create_scenario")).toBe(1);
    await expect(page.getByLabel("User prompt")).toHaveValue(AUTHORED_SCENARIO.prompt);
    await expect(page.locator("textarea").nth(1)).toHaveValue(
      "Explains the forecast assumptions.",
    );

    await page.getByRole("button", { name: /^suggest$/i }).click();
    await expect(await getTrackedInvokeCount(page, "define_eval_scenario")).toBe(1);
    await expect(page.getByLabel("User prompt")).toHaveValue(DEFINITIVE_SCENARIO.prompt);
    await expect(page.locator("textarea").nth(1)).toHaveValue(
      "Explains the forecast assumptions.",
    );
    await expect(page.getByRole("button", { name: "Evaluate" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send to Refine" })).toHaveCount(0);
  });

  test("loads and deletes an existing scenario from the scenario-only workbench", async ({
    page,
  }) => {
    await navigateToEvalWorkbench(page, {
      list_scenarios: [{ name: PERFORMANCE_SCENARIO.name }],
      load_scenario: PERFORMANCE_SCENARIO,
      delete_scenario: undefined,
    });
    await trackInvokes(page, ["delete_scenario"]);
    await page.getByRole("button", { name: "Regression" }).click();

    await expect(page.getByLabel("User prompt")).toHaveValue(PERFORMANCE_SCENARIO.prompt);
    await expect(page.locator("textarea").nth(1)).toHaveValue(
      "Explains the forecast assumptions.",
    );
    await page.getByRole("button", { name: /delete scenario/i }).click();
    await expect(await getTrackedInvokeCount(page, "delete_scenario")).toBe(1);
    const deleteCalls = await getTrackedInvokes(page, "delete_scenario");
    expect(deleteCalls[0]?.args).toMatchObject({
      scenarioName: "Regression",
    });
  });
});

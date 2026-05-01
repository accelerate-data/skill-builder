import { expect, test } from "@playwright/test";
import {
  DESCRIPTION_OPTIMIZATION_RESULT,
  GENERATED_DESCRIPTION_EVAL_QUERIES,
} from "../fixtures/description-optimization";
import {
  emitGeneratedDescriptionQueries,
  navigateToDescriptionTab,
} from "../helpers/description-helpers";
import { getTrackedInvokeCount, getTrackedInvokes, trackInvokes } from "../helpers/invoke-tracking.js";

test.describe("Optimize Description", { tag: "@description" }, () => {
  test("happy path generates queries, runs optimization, views results, and applies the best description", async ({ page }) => {
    await navigateToDescriptionTab(page);
    await trackInvokes(page, [
      "start_generate_desc_evals",
      "run_optimization_loop",
      "apply_description",
    ]);

    await page.getByRole("button", { name: "Generate" }).click();
    await page.getByLabel("Number of queries").fill("10");
    await page.getByRole("button", { name: "Generate" }).last().click();

    await expect(page.getByRole("heading", { name: "Generating Eval Queries" })).toBeVisible();
    await emitGeneratedDescriptionQueries(page);

    await expect(page.getByText("Use the skill to audit dbt model freshness")).toBeVisible();
    await expect(page.getByText("Summarize this marketing email")).toBeVisible();
    await expect(await getTrackedInvokeCount(page, "start_generate_desc_evals")).toBe(1);
    const generateCalls = await getTrackedInvokes(page, "start_generate_desc_evals");
    expect(generateCalls[0]?.args).toMatchObject({
      skillName: "test-skill",
      pluginSlug: "skills",
      numEvalQueries: 10,
    });

    await page.getByRole("button", { name: "Optimize" }).click();

    await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
    await expect(page.getByText("2 iterations complete")).toBeVisible();
    await expect(page.getByText("Score Progression")).toBeVisible();
    await expect(page.getByText("1.00").first()).toBeVisible();
    await expect(page.getByText("After (Best)")).toBeVisible();
    await expect(page.getByText("analytics engineering help with dbt models")).toBeVisible();
    await expect(await getTrackedInvokeCount(page, "run_optimization_loop")).toBe(1);
    const optimizationCalls = await getTrackedInvokes(page, "run_optimization_loop");
    const optimizationEvalQueries = optimizationCalls[0]?.args.evalQueries as Array<{
      id: string;
      query: string;
      should_trigger: boolean;
    }>;
    expect(optimizationEvalQueries).toHaveLength(GENERATED_DESCRIPTION_EVAL_QUERIES.length);
    expect(optimizationEvalQueries.map(({ query, should_trigger }) => ({ query, should_trigger }))).toEqual(
      GENERATED_DESCRIPTION_EVAL_QUERIES,
    );
    expect(optimizationEvalQueries.every(({ id }) => id.length > 0)).toBe(true);

    await page.getByRole("button", { name: "Apply best description" }).click();

    await expect(page.getByText("Description applied successfully.")).toBeVisible();
    await expect(await getTrackedInvokeCount(page, "apply_description")).toBe(1);
    const applyCalls = await getTrackedInvokes(page, "apply_description");
    expect(applyCalls[0]?.args.description).toBe(DESCRIPTION_OPTIMIZATION_RESULT.best_description);
  });
});

import { expect, test, type Page } from "@playwright/test";
import {
  emitGeneratedDescriptionQueries,
  navigateToDescriptionTab,
} from "../helpers/description-helpers";

async function trackInvokes(page: Page, commands: string[]) {
  await page.evaluate((cmds) => {
    const w = window as unknown as Record<string, unknown>;
    w.__TAURI_TRACK_INVOKES__ = cmds;
    w.__TAURI_TRACKED_INVOKES__ = [];
  }, commands);
}

async function trackedInvokeCount(page: Page, cmd: string) {
  return page.evaluate((command) => {
    const calls = ((window as unknown as Record<string, unknown>).__TAURI_TRACKED_INVOKES__ ?? []) as Array<{
      cmd: string;
    }>;
    return calls.filter((call) => call.cmd === command).length;
  }, cmd);
}

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
    await expect(await trackedInvokeCount(page, "start_generate_desc_evals")).toBe(1);

    await page.getByRole("button", { name: "Optimize" }).click();

    await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
    await expect(page.getByText("2 iterations complete")).toBeVisible();
    await expect(page.getByText("Score Progression")).toBeVisible();
    await expect(page.getByText("1.00").first()).toBeVisible();
    await expect(page.getByText("After (Best)")).toBeVisible();
    await expect(page.getByText("analytics engineering help with dbt models")).toBeVisible();
    await expect(await trackedInvokeCount(page, "run_optimization_loop")).toBe(1);

    await page.getByRole("button", { name: "Apply best description" }).click();

    await expect(page.getByText("Description applied successfully.")).toBeVisible();
    await expect(await trackedInvokeCount(page, "apply_description")).toBe(1);
  });
});

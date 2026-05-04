import { expect, test } from "@playwright/test";
import {
  navigateToDescriptionTab,
  TRIGGER_CANDIDATES,
} from "../helpers/description-helpers";
import {
  getTrackedInvokeCount,
  getTrackedInvokes,
  trackInvokes,
} from "../helpers/invoke-tracking.js";

test.describe("Description Workbench", { tag: "@description" }, () => {
  test("generates candidates, runs a comparison, and applies the recommended description", async ({
    page,
  }) => {
    await navigateToDescriptionTab(page, {
      list_eval_runs: [
        {
          id: "run-trigger-1",
          promptSetId: "prompt-set-trigger",
          mode: "trigger",
          status: "completed",
          summary: { passed: 5, total: 8 },
          createdAt: "2026-05-04T00:00:00Z",
          completedAt: "2026-05-04T00:05:00Z",
          results: [],
          descriptionCandidates: [],
        },
      ],
      read_eval_run: {
        id: "run-trigger-1",
        promptSetId: "prompt-set-trigger",
        mode: "trigger",
        status: "completed",
        summary: { passed: 5, total: 8 },
        createdAt: "2026-05-04T00:00:00Z",
        completedAt: "2026-05-04T00:05:00Z",
        results: [
          {
            id: "result-baseline-positive",
            runId: "run-trigger-1",
            caseId: "case-1",
            candidateId: "current-skill",
            passed: false,
            score: 0,
            output: {},
            reason: "Misses invoice reconciliation.",
          },
          {
            id: "result-baseline-negative",
            runId: "run-trigger-1",
            caseId: "case-2",
            candidateId: "current-skill",
            passed: true,
            score: 1,
            output: {},
            reason: "Avoids unrelated billing cleanup.",
          },
          {
            id: "result-candidate-1-positive",
            runId: "run-trigger-1",
            caseId: "case-1",
            candidateId: "candidate-1",
            passed: true,
            score: 1,
            output: {},
            reason: "Keeps invoice reconciliation within routing scope.",
          },
          {
            id: "result-candidate-1-negative",
            runId: "run-trigger-1",
            caseId: "case-2",
            candidateId: "candidate-1",
            passed: false,
            score: 0,
            output: {},
            reason: "Still fires for unrelated billing cleanup.",
          },
          {
            id: "result-candidate-2-positive",
            runId: "run-trigger-1",
            caseId: "case-1",
            candidateId: "candidate-2",
            passed: true,
            score: 1,
            output: {},
            reason: "Keeps invoice reconciliation within routing scope.",
          },
          {
            id: "result-candidate-2-negative",
            runId: "run-trigger-1",
            caseId: "case-2",
            candidateId: "candidate-2",
            passed: true,
            score: 1,
            output: {},
            reason: "Avoids unrelated billing cleanup.",
          },
        ],
        descriptionCandidates: TRIGGER_CANDIDATES,
      },
      run_eval_workbench: {
        id: "run-trigger-1",
        promptSetId: "prompt-set-trigger",
        mode: "trigger",
        status: "completed",
        summary: { passed: 5, total: 8 },
        createdAt: "2026-05-04T00:00:00Z",
        completedAt: "2026-05-04T00:05:00Z",
        results: [],
        descriptionCandidates: [],
      },
      apply_description_candidate: {
        description: TRIGGER_CANDIDATES[1].description,
      },
      list_eval_prompt_sets: [
        {
          id: "prompt-set-trigger",
          pluginSlug: "skills",
          skillName: "test-skill",
          mode: "trigger",
          name: "Routing checks",
          createdAt: "2026-05-04T00:00:00Z",
          updatedAt: "2026-05-04T00:00:00Z",
          cases: [
            {
              id: "case-1",
              prompt: "Reconcile open customer invoices",
              expected: null,
              shouldTrigger: true,
              assertions: [],
              sortOrder: 0,
            },
            {
              id: "case-2",
              prompt: "Clean up old billing notes",
              expected: null,
              shouldTrigger: false,
              assertions: [],
              sortOrder: 1,
            },
          ],
        },
      ],
    });
    await trackInvokes(page, [
      "suggest_description_candidates",
      "run_eval_workbench",
      "apply_description_candidate",
    ]);

    await expect(page.getByRole("heading", { name: "Eval Workbench" })).toBeVisible();
    await expect(page.getByText("Current description")).toBeVisible();

    await page.getByRole("button", { name: "Generate candidates" }).click();

    await expect(
      page.getByText(TRIGGER_CANDIDATES[0].description),
    ).toBeVisible();
    await expect(await getTrackedInvokeCount(page, "suggest_description_candidates")).toBe(1);
    const candidateCalls = await getTrackedInvokes(
      page,
      "suggest_description_candidates",
    );
    expect(candidateCalls[0]?.args).toMatchObject({
      request: {
        promptSetId: "prompt-set-trigger",
        baselineDescription: "Use when doing dbt work.",
        candidateCount: 3,
      },
    });

    await page.getByRole("button", { name: "Run comparison" }).click();

    await expect(page.getByTestId("candidate-card-current-skill")).toBeVisible();
    const candidateTwoCard = page.getByTestId("candidate-card-candidate-2");
    await expect(candidateTwoCard.getByText("Recommended")).toBeVisible();
    await expect(await getTrackedInvokeCount(page, "run_eval_workbench")).toBe(1);
    const runCalls = await getTrackedInvokes(page, "run_eval_workbench");
    expect(runCalls[0]?.args).toMatchObject({
      request: {
        promptSetId: "prompt-set-trigger",
        candidateIds: ["current-skill", ...TRIGGER_CANDIDATES.map(({ id }) => id)],
      },
    });

    await page.getByRole("button", { name: "Apply Candidate 2" }).click();

    await expect(page.getByText("Applied description")).toBeVisible();
    const appliedDescription = page
      .getByText("Applied description")
      .locator("xpath=following-sibling::p[1]");
    await expect(
      appliedDescription,
    ).toBeVisible();
    await expect(appliedDescription).toHaveText(TRIGGER_CANDIDATES[1].description);
    await expect(await getTrackedInvokeCount(page, "apply_description_candidate")).toBe(1);
    const applyCalls = await getTrackedInvokes(page, "apply_description_candidate");
    expect(applyCalls[0]?.args).toMatchObject({
      pluginSlug: "skills",
      skillName: "test-skill",
      candidateId: "candidate-2",
    });
  });
});

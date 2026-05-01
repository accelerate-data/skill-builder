import { test, expect } from "@playwright/test";
import { getTrackedInvokes, trackInvokes } from "../helpers/invoke-tracking.js";
import { navigateToRefineWithSkill } from "../helpers/refine-helpers";

test.describe(
  "Benchmark snapshot cleanup OpenHands refine gap",
  { tag: "@refine" },
  () => {
    test("unsupported refine sends do not start a benchmark cleanup lifecycle", async ({
      page,
    }) => {
      await navigateToRefineWithSkill(page, {
        send_refine_message:
          "__throw__:OpenHands refine streaming is not yet supported. Use workflow mode until the OpenHands AskUserQuestion tool is implemented.",
        clean_benchmark_snapshot: undefined,
      });
      await trackInvokes(page, ["clean_benchmark_snapshot"]);

      await page.getByTestId("refine-chat-input").fill("benchmark this skill");
      await page.getByTestId("refine-send-button").click();

      await expect(
        page.getByText("OpenHands refine streaming is not yet supported"),
      ).toBeVisible();
      expect(
        await getTrackedInvokes(page, "clean_benchmark_snapshot"),
      ).toHaveLength(0);
    });
  },
);

import { test, expect } from "@playwright/test";
import { navigateToRefineWithSkill } from "../helpers/refine-helpers";

test.describe("Refine Page OpenHands gap", { tag: "@refine" }, () => {
  test("refine sends return the explicit unsupported OpenHands streaming gap", async ({
    page,
  }) => {
    await navigateToRefineWithSkill(page, {
      send_refine_message:
        "__throw__:OpenHands refine streaming is not yet supported. Use workflow mode until the OpenHands AskUserQuestion tool is implemented.",
    });

    const input = page.getByTestId("refine-chat-input");
    await input.fill("add a quick-start section");
    await page.getByTestId("refine-send-button").click();

    await expect(
      page.getByText(
        "OpenHands refine streaming is not yet supported. Use workflow mode until the OpenHands AskUserQuestion tool is implemented.",
      ),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("refine-chat-input")).toBeEnabled();
  });
});

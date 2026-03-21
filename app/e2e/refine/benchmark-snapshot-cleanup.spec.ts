/**
 * E2E tests for VU-680: benchmark snapshot cleanup.
 *
 * Verifies that the frontend calls `clean_benchmark_snapshot` when a
 * refine agent fails or is cancelled, and does NOT call it on success
 * (the Rust backend handles cleanup via finalize_refine_run).
 *
 * Uses the __TAURI_TRACK_INVOKES__ / __TAURI_TRACKED_INVOKES__ mechanism
 * built into the E2E mock to record which Tauri commands were called.
 */
import { test, expect, type Page } from "@playwright/test";
import { simulateAgentRun, simulateAgentError } from "../helpers/agent-simulator";
import { navigateToRefineWithSkill } from "../helpers/refine-helpers";

async function getAgentId(page: Page): Promise<string> {
  const thinking = page.getByTestId("refine-agent-thinking");
  await thinking.waitFor({ timeout: 5_000 });
  const agentId = await thinking.getAttribute("data-agent-id");
  if (!agentId) throw new Error("Could not read agent ID from thinking indicator");
  return agentId;
}

/** Enable invoke tracking for the given commands via the E2E mock. */
async function trackInvokes(page: Page, commands: string[]): Promise<void> {
  await page.evaluate((cmds) => {
    const w = window as unknown as Record<string, unknown>;
    w.__TAURI_TRACK_INVOKES__ = cmds;
    w.__TAURI_TRACKED_INVOKES__ = [];
  }, commands);
}

/** Retrieve tracked invokes from the browser context. */
async function getTrackedInvokes(
  page: Page,
  cmd: string,
): Promise<Array<{ cmd: string; args: unknown }>> {
  const all = await page.evaluate(() => {
    return ((window as unknown as Record<string, unknown>).__TAURI_TRACKED_INVOKES__ ?? []) as Array<{ cmd: string; args: unknown }>;
  });
  return all.filter((i) => i.cmd === cmd);
}

test.describe("Benchmark snapshot cleanup", { tag: "@refine" }, () => {
  test("agent error triggers clean_benchmark_snapshot", async ({ page }) => {
    await navigateToRefineWithSkill(page, {
      clean_benchmark_snapshot: undefined,
    });

    await trackInvokes(page, ["clean_benchmark_snapshot"]);

    // Send a message and get agent ID
    const input = page.getByTestId("refine-chat-input");
    await input.fill("benchmark this skill");
    await page.getByTestId("refine-send-button").click();
    const agentId = await getAgentId(page);

    // Agent fails
    await simulateAgentError(page, agentId);

    // Wait for error toast confirming the error path ran
    await expect(
      page.getByText("Agent failed — check the chat for details").first(),
    ).toBeVisible();

    // clean_benchmark_snapshot should have been called
    const calls = await getTrackedInvokes(page, "clean_benchmark_snapshot");
    expect(calls).toHaveLength(1);
  });

  test("successful agent run does not call clean_benchmark_snapshot", async ({ page }) => {
    await navigateToRefineWithSkill(page, {
      clean_benchmark_snapshot: undefined,
    });

    await trackInvokes(page, ["clean_benchmark_snapshot"]);

    const input = page.getByTestId("refine-chat-input");
    await input.fill("add error handling section");
    await page.getByTestId("refine-send-button").click();
    const agentId = await getAgentId(page);

    // Swap mocks for successful completion
    await page.evaluate(() => {
      const overrides = (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ as Record<string, unknown>;
      overrides.get_skill_content_for_refine = [
        { path: "SKILL.md", content: "# Test Skill\n\n## Error Handling\n\nHandle errors gracefully." },
        { path: "references/glossary.md", content: "# Glossary\n\n- **Term**: Definition" },
      ];
      overrides.finalize_refine_run = {
        files: [
          { path: "SKILL.md", content: "# Test Skill\n\n## Error Handling\n\nHandle errors gracefully." },
          { path: "references/glossary.md", content: "# Glossary\n\n- **Term**: Definition" },
        ],
        diff: { stat: "1 file changed", files: [] },
        commit_sha: null,
      };
    });

    // Agent succeeds
    await simulateAgentRun(page, {
      agentId,
      messages: ["Adding error handling section..."],
      result: "Refinement complete.",
    });

    // Wait for completion
    await expect(page.getByTestId("refine-agent-thinking")).not.toBeVisible();
    await page.waitForTimeout(500);

    // clean_benchmark_snapshot should NOT have been called
    const calls = await getTrackedInvokes(page, "clean_benchmark_snapshot");
    expect(calls).toHaveLength(0);
  });
});

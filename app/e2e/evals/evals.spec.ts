/**
 * E2E tests for the Evals tab.
 *
 * Level 1 (tag @evals): browser-only tests with fully mocked Tauri + simulated
 * agent events. Verify UI flow: eval list, run progress, benchmark card,
 * Refine navigation.
 *
 * Level 2 (tag @evals-integration): real sidecar via createSidecarBridge.
 * Verifies the sidecar correctly parses workspace_path/skill_name from the
 * prompt, writes grading files to a real temp dir, and emits eval events
 * through the real MessageProcessor.
 */
import { test, expect, type Page } from "@playwright/test";
import * as path from "node:path";
import { simulateAgentRun } from "../helpers/agent-simulator.js";
import { navigateToEvalsTab, EVALS_OVERRIDES } from "../helpers/evals-helpers.js";
import { createSidecarBridge, type SidecarBridge } from "../helpers/sidecar-bridge.js";
import { waitForAppReady } from "../helpers/app-helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for the progress banner and return the agent ID. */
async function getEvalRunAgentId(page: Page): Promise<string> {
  const banner = page.getByTestId("evals-run-thinking");
  await banner.waitFor({ timeout: 8_000 });
  // data-agent-id is set after startAgent resolves — wait for it to be non-empty.
  await expect(banner).not.toHaveAttribute("data-agent-id", "", { timeout: 5_000 });
  const agentId = await banner.getAttribute("data-agent-id");
  if (!agentId) throw new Error("Could not read agent ID from evals-run-thinking banner");
  return agentId;
}

/** Enable invoke tracking for the given command names. */
async function trackInvokes(page: Page, commands: string[]): Promise<void> {
  await page.evaluate((cmds) => {
    const w = window as unknown as Record<string, unknown>;
    w.__TAURI_TRACK_INVOKES__ = cmds;
    w.__TAURI_TRACKED_INVOKES__ = [];
  }, commands);
}

/** Return all tracked invocations for a given command. */
async function getTrackedInvokes(
  page: Page,
  cmd: string,
): Promise<Array<{ cmd: string; args: Record<string, unknown> }>> {
  const all = await page.evaluate(() => {
    return ((window as unknown as Record<string, unknown>).__TAURI_TRACKED_INVOKES__ ?? []) as Array<{
      cmd: string;
      args: Record<string, unknown>;
    }>;
  });
  return all.filter((entry) => entry.cmd === cmd);
}

// ---------------------------------------------------------------------------
// Level 1: Browser-only (mocked Tauri + simulated agent events)
// ---------------------------------------------------------------------------

test.describe("Evals tab — browser mock", { tag: "@evals" }, () => {
  test("loads eval list on Evals tab", async ({ page }) => {
    await navigateToEvalsTab(page);

    await expect(page.getByText("Customer onboarding flow")).toBeVisible();
    await expect(page.getByText("Error handling scenario")).toBeVisible();
  });

  test("run selected evals shows progress banner and benchmark card", async ({ page }) => {
    await navigateToEvalsTab(page);

    await trackInvokes(page, ["create_next_iteration_dir", "materialize_eval_benchmark"]);

    // Select all evals using the "select all" checkbox
    const selectAll = page.getByLabel("Select all evals to run");
    await selectAll.waitFor({ timeout: 5_000 });
    await selectAll.click();

    // Click "Run selected (2)"
    const runBtn = page.getByRole("button", { name: /Run selected \(2\)/ });
    await expect(runBtn).toBeEnabled();
    await runBtn.click();

    // Progress banner should appear
    const agentId = await getEvalRunAgentId(page);

    // Simulate the agent lifecycle (eval_graded events + exit)
    await simulateAgentRun(page, {
      agentId,
      messages: [
        JSON.stringify({
          type: "eval_graded",
          evalId: 1,
          evalName: "Customer onboarding flow",
          runIndex: 0,
          evalIndex: 0,
          totalEvals: 2,
          totalRuns: 1,
          grading: { passed: 1, failed: 0, total: 1, pass_rate: 1.0 },
        }),
        JSON.stringify({
          type: "eval_graded",
          evalId: 2,
          evalName: "Error handling scenario",
          runIndex: 0,
          evalIndex: 1,
          totalEvals: 2,
          totalRuns: 1,
          grading: { passed: 0, failed: 1, total: 1, pass_rate: 0.0 },
        }),
      ],
      result: "Evaluation complete.",
    });

    // Progress banner should disappear
    await expect(page.getByTestId("evals-run-thinking")).not.toBeVisible({ timeout: 8_000 });

    // Both Rust commands must have been invoked
    const iterCalls = await getTrackedInvokes(page, "create_next_iteration_dir");
    expect(iterCalls.length).toBeGreaterThanOrEqual(1);
    const benchCalls = await getTrackedInvokes(page, "materialize_eval_benchmark");
    expect(benchCalls.length).toBeGreaterThanOrEqual(1);

    // Benchmark card: avg pass rate 50%, 1 passed, 1 failed (from mocked materialize response)
    await expect(page.getByText("50%")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("avg pass rate")).toBeVisible();
  });

  test("benchmark card Refine button navigates to Refine tab", async ({ page }) => {
    await navigateToEvalsTab(page);

    // Select all and run
    await page.getByLabel("Select all evals to run").click();
    await page.getByRole("button", { name: /Run selected \(2\)/ }).click();

    const agentId = await getEvalRunAgentId(page);
    await simulateAgentRun(page, { agentId, result: "Evaluation complete." });

    // Wait for benchmark card
    await expect(page.getByText("avg pass rate")).toBeVisible({ timeout: 8_000 });

    // Click "Refine skill" (use first() — benchmark card may render two variants)
    await page.getByRole("button", { name: "Refine skill" }).first().click();

    // Should switch to Refine tab
    const refineTab = page.getByRole("tab", { name: "Refine" });
    await expect(refineTab).toHaveAttribute("data-state", "active", { timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Level 2: Real sidecar (real Node.js sidecar + mocked Tauri)
// ---------------------------------------------------------------------------

test.describe("Evals tab — sidecar integration", { tag: "@evals-integration" }, () => {
  let bridge: SidecarBridge;

  test.beforeEach(async () => {
    bridge = await createSidecarBridge();
  });

  test.afterEach(() => {
    bridge.cleanup();
  });

  test("real sidecar evaluate-skill writes grading files to disk", async ({ page }) => {
    const skillName = "test-skill";
    const iterDir = path.join(bridge.workspaceDir, skillName, "evals", "iterations", "iteration-1");

    // Override workspace_path to the real temp dir so mock-agent writes there.
    // Also override create_next_iteration_dir to return the real path.
    await navigateToEvalsTab(page, {
      ...EVALS_OVERRIDES,
      get_settings: {
        anthropic_api_key: "sk-ant-test",
        workspace_path: bridge.workspaceDir,
        skills_path: bridge.workspaceDir,
      },
      create_next_iteration_dir: [1, iterDir],
    });

    // Select all and run
    await page.getByLabel("Select all evals to run").click();
    await page.getByRole("button", { name: /Run selected \(2\)/ }).click();

    // Wait for the agent to be registered in the store
    const agentId = await getEvalRunAgentId(page);

    // Run the real sidecar — it will write grading files into iterDir
    await bridge.runAgent(page, "skill-creator:grader", agentId, {
      skillName,
      workspacePath: bridge.workspaceDir,
      iterDir,
    });

    // Progress banner should be gone after agent-exit
    await expect(page.getByTestId("evals-run-thinking")).not.toBeVisible({ timeout: 8_000 });

    // Post-run: verify the mock sidecar wrote at least one grading file into the iteration dir.
    // mock-template uses eval IDs 3 and 4. Each eval dir has variant subdirs (e.g. with_skill/)
    // containing the grading.json, so we need to look two levels deep.
    const run0Dir = path.join(bridge.workspaceDir, skillName, "evals", "iterations", "iteration-1", "run-0");
    const { existsSync, readdirSync } = await import("node:fs");
    expect(existsSync(run0Dir), `run-0 dir should exist at ${run0Dir}`).toBe(true);

    const evalDirs = readdirSync(run0Dir);
    expect(evalDirs.length).toBeGreaterThan(0);

    // Each eval dir may contain variant subdirs (with_skill, without_skill, current, previous)
    // each of which holds grading.json — check two levels deep.
    const hasGrading = evalDirs.some((evalDir) => {
      const evalPath = path.join(run0Dir, evalDir);
      // Direct grading.json (simple mode)
      if (existsSync(path.join(evalPath, "grading.json"))) return true;
      // Variant subdir grading.json (comparison mode: with_skill/, without_skill/, etc.)
      try {
        return readdirSync(evalPath).some((variant) =>
          existsSync(path.join(evalPath, variant, "grading.json")),
        );
      } catch {
        return false;
      }
    });
    expect(hasGrading, "At least one grading.json should be written by the sidecar").toBe(true);
  });
});

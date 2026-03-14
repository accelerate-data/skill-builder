/**
 * E2E tests for the test → refine navigation scenario.
 *
 * Covers the flow where a user:
 * 1. Runs a skill test to completion (with eval recommendations)
 * 2. Clicks "Refine skill" from the recommendations panel
 * 3. Lands on the refine page with the recommendation pre-filled in the chat input
 * 4. A fresh refine session is started (not a stale one from a prior navigation)
 */
import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";
import { simulateAgentRun } from "../helpers/agent-simulator";
import {
  E2E_SKILLS_PATH,
  E2E_WORKSPACE_PATH,
  joinE2ePath,
} from "../helpers/test-paths";

/**
 * Frozen timestamp used to make agent IDs deterministic.
 * We override Date.now() in the page to this value so:
 *   withId  = "my-skill-test-with-1000000000000"
 *   withoutId = "__test_baseline__-test-without-1000000000000"
 *   evalId  = "__test_baseline__-test-eval-1000000000000"
 */
const FIXED_TS = 1_000_000_000_000;
const SKILL_NAME = "my-skill";
const WITH_ID = `${SKILL_NAME}-test-with-${FIXED_TS}`;
const WITHOUT_ID = `__test_baseline__-test-without-${FIXED_TS}`;

/**
 * Eval text with a "## Recommendations" section so handleRefine builds a
 * pre-filled message using the recommendations branch.
 */
const EVAL_RECOMMENDATIONS_TEXT = "Add a step-by-step breakdown for complex data tasks.";
const EVAL_AGENT_OUTPUT = `↑ Good use of skill context
↓ Missing step-by-step breakdown

## Recommendations

${EVAL_RECOMMENDATIONS_TEXT}`;

/** Expected substring in the pre-filled refine chat message. */
const EXPECTED_PREFILL_SUBSTRING = EVAL_RECOMMENDATIONS_TEXT;

async function waitForEvalAgentId(page: import("@playwright/test").Page): Promise<string> {
  await expect
    .poll(async () => page.evaluate(async () => {
      const { useAgentStore } = await import("/src/stores/agent-store.ts");
      const ids = Object.keys(useAgentStore.getState().runs);
      return ids.find((id) => id.includes("-test-eval-")) ?? null;
    }), { timeout: 5_000 })
    .not.toBeNull();

  const evalId = await page.evaluate(async () => {
    const { useAgentStore } = await import("/src/stores/agent-store.ts");
    const ids = Object.keys(useAgentStore.getState().runs);
    return ids.find((id) => id.includes("-test-eval-")) ?? null;
  });
  expect(evalId).toBeTruthy();
  return evalId!;
}

const BASE_OVERRIDES = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: E2E_WORKSPACE_PATH,
    skills_path: E2E_SKILLS_PATH,
  },
  list_models: [],
  get_workspace_path: E2E_WORKSPACE_PATH,
  has_running_agents: false,
  list_refinable_skills: [
    {
      name: SKILL_NAME,
      display_name: "My Skill",
      current_step: null,
      status: "completed",
      last_modified: null,
      purpose: "domain",
    },
  ],
  prepare_skill_test: {
    test_id: "test-e2e-001",
    baseline_cwd: joinE2ePath("test-baseline"),
    with_skill_cwd: joinE2ePath("test-with"),
    transcript_log_dir: `${E2E_WORKSPACE_PATH}/my-skill/logs`,
  },
  start_agent: "agent-id-mock",
  cleanup_skill_test: undefined,
  cleanup_skill_sidecar: undefined,
  // Refine page commands
  start_refine_session: {
    session_id: "e2e-refine-session-001",
    skill_name: SKILL_NAME,
    created_at: "2025-01-01T00:00:00.000Z",
  },
  get_skill_content_for_refine: [
    { path: "SKILL.md", content: "# My Skill\n\nSkill content." },
  ],
  acquire_lock: undefined,
  release_lock: undefined,
  close_refine_session: undefined,
  get_disabled_steps: [],
};

test.describe("Test → Refine navigation", { tag: "@skill-tester" }, () => {
  test("pre-fills recommendation from completed eval in refine chat input", async ({ page }) => {
    // Freeze Date.now() so agent IDs are predictable
    await page.addInitScript((opts) => {
      const fixedTs = opts.fixedTs;
      Date.now = () => fixedTs;
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = opts.overrides;
    }, { fixedTs: FIXED_TS, overrides: BASE_OVERRIDES });

    await page.goto("/test");
    await waitForAppReady(page);

    // --- Select skill ---
    await page.getByRole("button", { name: /select a skill/i }).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: /select a skill/i }).click();
    await page.getByRole("option", { name: /my-skill/i }).click();
    await expect(page.getByRole("button", { name: /my-skill/i })).toBeVisible();

    // --- Enter prompt and run test ---
    await page.getByPlaceholder("Describe a task to test the skill against...").fill("build a customer model");
    await page.getByRole("button", { name: /run test/i }).click();
    await expect(page.getByRole("button", { name: /running/i })).toBeVisible({ timeout: 5_000 });

    // --- Simulate plan agents completing ---
    await simulateAgentRun(page, {
      agentId: WITH_ID,
      messages: ["Planning with skill: domain glossary loaded."],
    });
    await simulateAgentRun(page, {
      agentId: WITHOUT_ID,
      messages: ["Planning without skill: generic approach."],
    });

    // Wait for the evaluating phase to begin (both plan agents done → eval starts)
    await expect(page.getByText("evaluating...")).toBeVisible({ timeout: 5_000 });

    const evalAgentId = await waitForEvalAgentId(page);

    // --- Simulate eval agent completing with recommendations ---
    await simulateAgentRun(page, {
      agentId: evalAgentId,
      messages: [EVAL_AGENT_OUTPUT],
    });

    // Wait for "done" phase — the "Refine skill" button appears when
    // phase="done" AND evalRecommendations is non-empty
    await expect(page.getByRole("button", { name: /refine skill/i })).toBeVisible({ timeout: 5_000 });

    // --- Navigate to refine page ---
    await page.getByRole("button", { name: /refine skill/i }).click();

    // Verify URL changed to the refine page with correct skill param
    await expect(page).toHaveURL(new RegExp(`/refine.*skill=${SKILL_NAME}`), { timeout: 5_000 });

    // Wait for the refine page to load the skill (skill name appears in picker)
    await expect(page.getByText("My Skill").first()).toBeVisible({ timeout: 10_000 });

    // Verify the chat input is pre-filled with the recommendation from the eval
    const chatInput = page.getByPlaceholder(/describe what to change/i);
    await expect(chatInput).toBeVisible({ timeout: 10_000 });
    await expect(chatInput).toHaveValue(new RegExp(EXPECTED_PREFILL_SUBSTRING));
  });

  test("refine page starts a fresh session after arriving from test page", async ({ page }) => {
    // Track start_refine_session call count by incrementing a counter on the window
    await page.addInitScript((opts) => {
      const fixedTs = opts.fixedTs;
      Date.now = () => fixedTs;

      // Wrap start_refine_session so we can count invocations
      const overrides = { ...opts.overrides };
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
      (window as unknown as Record<string, unknown>).__TEST_REFINE_SESSION_CALLS__ = 0;

      // Intercept via a Proxy on the overrides map
      const original = overrides.start_refine_session;
      Object.defineProperty(overrides, "start_refine_session", {
        get() {
          (window as unknown as Record<string, number>).__TEST_REFINE_SESSION_CALLS__ += 1;
          return original;
        },
        enumerable: true,
        configurable: true,
      });
    }, { fixedTs: FIXED_TS, overrides: BASE_OVERRIDES });

    await page.goto("/test");
    await waitForAppReady(page);

    // Select skill, enter prompt, run test
    await page.getByRole("button", { name: /select a skill/i }).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: /select a skill/i }).click();
    await page.getByRole("option", { name: /my-skill/i }).click();
    await page.getByPlaceholder("Describe a task to test the skill against...").fill("build a customer model");
    await page.getByRole("button", { name: /run test/i }).click();
    await expect(page.getByRole("button", { name: /running/i })).toBeVisible({ timeout: 5_000 });

    // Simulate plan agents completing
    await simulateAgentRun(page, { agentId: WITH_ID });
    await simulateAgentRun(page, { agentId: WITHOUT_ID });

    // Wait for evaluating phase
    await expect(page.getByText("evaluating...")).toBeVisible({ timeout: 5_000 });

    const evalAgentId = await waitForEvalAgentId(page);

    // Simulate eval agent completing with recommendations
    await simulateAgentRun(page, {
      agentId: evalAgentId,
      messages: [EVAL_AGENT_OUTPUT],
    });

    // Wait for "Refine skill" button
    await expect(page.getByRole("button", { name: /refine skill/i })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /refine skill/i }).click();

    // Wait for refine page to load and select skill
    await expect(page).toHaveURL(new RegExp(`/refine.*skill=${SKILL_NAME}`), { timeout: 5_000 });
    await expect(page.getByText("My Skill").first()).toBeVisible({ timeout: 10_000 });

    // Verify start_refine_session was called at least once (fresh session started)
    const callCount = await page.evaluate(
      () => (window as unknown as Record<string, number>).__TEST_REFINE_SESSION_CALLS__ ?? 0,
    );
    expect(callCount).toBeGreaterThanOrEqual(1);
  });
});

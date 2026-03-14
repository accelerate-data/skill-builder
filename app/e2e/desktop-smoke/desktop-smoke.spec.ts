// Requires MOCK_AGENTS=true sidecar — agent tests run via: npx playwright test --grep @desktop-smoke
/**
 * Desktop smoke tests for the manual happy-path with MOCK_AGENTS=true mode.
 *
 * Tests 1-2 cover basic UI flows (boot, create-skill) using the Tauri browser
 * mock (TAURI_E2E=true). Tests 3-4 spawn the real Node.js sidecar with
 * MOCK_AGENTS=true via createSidecarBridge so agent event routing flows
 * through the actual sidecar implementation rather than the browser simulator.
 *
 * Tag: @desktop-smoke — runs in the nightly/post-merge project.
 */
import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";
import { navigateToWorkflowUpdateMode, WORKFLOW_OVERRIDES } from "../helpers/workflow-helpers";
import { navigateToRefineWithSkill, REFINE_OVERRIDES } from "../helpers/refine-helpers";
import { createSidecarBridge } from "../helpers/sidecar-bridge.js";
import { E2E_SKILLS_PATH, E2E_WORKSPACE_PATH } from "../helpers/test-paths";

const BASE_OVERRIDES = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: E2E_WORKSPACE_PATH,
    skills_path: E2E_SKILLS_PATH,
  },
  check_workspace_path: true,
  list_skills: [],
};

test.describe("Desktop Smoke", { tag: "@desktop-smoke" }, () => {
  test("app boots and shows dashboard", async ({ page }) => {
    await page.addInitScript((o) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
    }, BASE_OVERRIDES);
    await page.goto("/");
    await waitForAppReady(page);

    // Dashboard link must be visible in the sidebar nav
    await expect(page.getByRole("link", { name: /dashboard/i })).toBeVisible();
    // No crash — page should not show an error boundary
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
  });

  test("dashboard loads and can create a skill", async ({ page }) => {
    await page.addInitScript((o) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = o;
    }, {
      ...BASE_OVERRIDES,
      create_skill: { name: "smoke-skill", purpose: "domain" },
    });
    await page.goto("/");
    await waitForAppReady(page);

    // New Skill button must be visible
    const newSkillButton = page.getByRole("button", { name: /new skill/i }).first();
    await expect(newSkillButton).toBeVisible();

    // Open the create skill dialog
    await newSkillButton.click();
    await expect(page.getByRole("heading", { name: /create new skill/i })).toBeVisible({ timeout: 5_000 });

    // Fill in the required fields on step 1
    await page.getByRole("textbox", { name: "Skill Name" }).fill("smoke-skill");
    await page.getByRole("combobox", { name: /what are you trying to capture/i }).click();
    await page.getByRole("option", { name: /business process knowledge/i }).click();
    await page.getByRole("textbox", { name: "Description" }).fill("Smoke test skill.");

    // Advance to step 2 (confirmation)
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled({ timeout: 3_000 });
    await page.getByRole("button", { name: "Next" }).click();

    // Confirmation step must show a Create button
    await expect(page.getByRole("button", { name: "Create" })).toBeVisible({ timeout: 5_000 });
  });

  test("workflow happy path with real MOCK_AGENTS sidecar", async ({ page }) => {
    const agentId = "desktop-smoke-wf-001";
    const bridge = await createSidecarBridge();
    try {
      // Navigate into update mode, overriding run_workflow_step to return our bridge agent ID
      await navigateToWorkflowUpdateMode(page, { run_workflow_step: agentId });

      // Verify the workflow page loaded
      await expect(page.getByText("Step 1: Research")).toBeVisible({ timeout: 10_000 });

      // Agent auto-starts in update mode — wait for the initializing indicator
      await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });

      // Run the real sidecar with MOCK_AGENTS=true — events flow through actual sidecar
      await bridge.runAgent(page, "research-orchestrator", agentId, { skillName: "test-skill" });

      // Wait for the running state to clear — deterministic signal that the
      // completion effect chain has fully settled.
      await expect(page.getByTestId("agent-initializing-indicator")).not.toBeVisible({ timeout: 5_000 });

      // Step 1 sidebar entry must remain accessible
      const step1Button = page.locator("button").filter({ hasText: "1. Research" });
      await expect(step1Button).toBeVisible();
    } finally {
      bridge.cleanup();
    }
  });

  test("refine smoke path with real MOCK_AGENTS sidecar", async ({ page }) => {
    const agentId = "desktop-smoke-refine-001";
    const bridge = await createSidecarBridge();
    try {
      // Navigate to refine with test-skill pre-selected; override send_refine_message
      // to return our bridge agent ID so event routing uses the real sidecar path.
      await navigateToRefineWithSkill(page, { send_refine_message: agentId });

      // Skill should be pre-selected via the URL param
      await expect(page.getByRole("button", { name: /test-skill/i })).toBeVisible({ timeout: 5_000 });

      // Chat input must be visible and accepting text
      const input = page.getByTestId("refine-chat-input");
      await expect(input).toBeVisible({ timeout: 5_000 });
      await input.fill("Update the skill with new context");

      // Send the message
      await input.press("Enter");

      // User message should appear in the chat transcript
      await expect(page.getByText("Update the skill with new context").last()).toBeVisible({ timeout: 5_000 });

      // Thinking indicator should appear while agent processes
      const thinking = page.getByTestId("refine-agent-thinking");
      await thinking.waitFor({ timeout: 5_000 });

      // Run the real sidecar with MOCK_AGENTS=true for the refine agent
      await bridge.runAgent(page, "refine-skill", agentId, { skillName: "test-skill", runSource: "refine" });

      // Wait for the thinking indicator to disappear — deterministic signal that
      // the refine completion effect chain has fully settled.
      await expect(thinking).not.toBeVisible({ timeout: 5_000 });
    } finally {
      bridge.cleanup();
    }
  });
});

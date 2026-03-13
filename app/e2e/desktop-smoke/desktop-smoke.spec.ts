// Requires MOCK_AGENTS=true — run via: npx playwright test --grep @desktop-smoke
/**
 * Desktop smoke tests for the manual happy-path with MOCK_AGENTS=true mode.
 *
 * These tests cover end-to-end user flows at a coarse grain:
 * boot → dashboard → create → workflow → refine. They are meant to
 * catch startup regressions and cross-feature breakage rather than
 * exercising detailed component behavior (use workflow-integration
 * for that).
 *
 * Tag: @desktop-smoke — runs in the nightly/post-merge project.
 */
import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../helpers/app-helpers";
import {
  navigateToWorkflowUpdateMode,
  WORKFLOW_OVERRIDES,
} from "../helpers/workflow-helpers";
import {
  navigateToRefineWithSkill,
  REFINE_OVERRIDES,
} from "../helpers/refine-helpers";
import {
  simulateAgentRun,
} from "../helpers/agent-simulator";

const BASE_OVERRIDES = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    workspace_path: "/tmp/test-workspace",
    skills_path: "/tmp/test-skills",
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

  test("workflow happy path with MOCK_AGENTS", async ({ page }) => {
    // Navigate into update mode for test-skill (WORKFLOW_OVERRIDES sets up the skill)
    await navigateToWorkflowUpdateMode(page);

    // Verify the workflow page loaded
    await expect(page.getByText("Step 1: Research")).toBeVisible({ timeout: 10_000 });

    // Agent auto-starts in update mode — wait for the initializing indicator
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });

    // Simulate a complete mock agent run
    await simulateAgentRun(page, {
      agentId: "agent-001",
      messages: ["Running research step..."],
      result: "Research complete.",
      delays: 50,
    });

    // Allow completion effect chain to settle
    await page.waitForTimeout(500);

    // Running state must be cleared
    await expect(page.getByTestId("agent-initializing-indicator")).not.toBeVisible();

    // Step 1 sidebar entry must remain accessible
    const step1Button = page.locator("button").filter({ hasText: "1. Research" });
    await expect(step1Button).toBeVisible();
  });

  test("refine smoke path with MOCK_AGENTS", async ({ page }) => {
    // Navigate to refine with test-skill pre-selected
    await navigateToRefineWithSkill(page);

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

    // Read the dynamically generated agent ID
    const agentId = await thinking.getAttribute("data-agent-id");
    expect(agentId).toBeTruthy();

    // Simulate mock agent responding
    await simulateAgentRun(page, {
      agentId: agentId!,
      messages: ["Updating skill content..."],
      result: "Skill updated.",
      delays: 50,
    });

    // Agent output must appear in the chat
    await expect(page.getByText("Updating skill content...").last()).toBeVisible({ timeout: 5_000 });
  });
});

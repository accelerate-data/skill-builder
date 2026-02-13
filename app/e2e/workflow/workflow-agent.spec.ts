/**
 * E2E tests for agent lifecycle within the workflow page.
 *
 * These tests use the agent simulator to dispatch Tauri events through
 * `window.__TAURI_EVENT_HANDLERS__`, exercising the same code paths
 * the real sidecar would trigger.
 */
import { test, expect } from "@playwright/test";
import {
  emitTauriEvent,
  simulateAgentRun,
  simulateAgentInitError,
} from "../helpers/agent-simulator";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface AgentFixture {
  agentId: string;
  messages: string[];
  result: string;
}

const researchFixture: AgentFixture = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/agent-responses/research-step.json"), "utf-8"),
);

// Common mock overrides that configure a workspace + skill so the workflow
// page can render and the Start button is enabled.
const WORKFLOW_OVERRIDES = {
  get_settings: {
    anthropic_api_key: "sk-ant-test",
    github_token: null,
    github_repo: null,
    workspace_path: "/tmp/test-workspace",
    auto_commit: false,
    auto_push: false,
  },
  check_workspace_path: true,
  list_skills: [
    {
      name: "test-skill",
      domain: "Testing",
      current_step: null,
      status: null,
      last_modified: null,
    },
  ],
  get_workflow_state: { run: null, steps: [] },
  save_workflow_state: undefined,
  capture_step_artifacts: [],
  reset_workflow_step: undefined,
  cleanup_skill_sidecar: undefined,
  run_workflow_step: "agent-001",
  read_file: "",
  get_artifact_content: null,
};

/**
 * Navigate to the workflow page for test-skill.
 * Uses `addInitScript` so mock overrides survive page navigation.
 * Waits for the splash screen to dismiss (5s startup check timer)
 * and the workflow page to hydrate.
 */
async function navigateToWorkflow(page: import("@playwright/test").Page) {
  // addInitScript runs before every page load, ensuring overrides
  // are available when the app's JavaScript first executes.
  await page.addInitScript((overrides) => {
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = overrides;
  }, WORKFLOW_OVERRIDES);
  await page.goto("/skill/test-skill");
  // Wait for splash screen to complete its 5s startup check timer,
  // then for the workflow sidebar to render (proves <Outlet /> is mounted).
  await page.getByText("Workflow Steps").waitFor({ timeout: 10_000 });
  // Brief extra wait for React state to settle
  await page.waitForTimeout(300);
}

test.describe("Workflow Agent Lifecycle", { tag: "@workflow-agent" }, () => {
  test("init spinner shows then clears when agent messages arrive", async ({ page }) => {
    await navigateToWorkflow(page);

    // Verify we're on the workflow page with Step 1 visible
    await expect(page.getByText("Step 1: Research Concepts")).toBeVisible();

    // Click Start Step
    const startButton = page.getByRole("button", { name: "Start Step" });
    await expect(startButton).toBeVisible();
    await startButton.click();

    // The initializing indicator should appear
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible();
    await expect(page.getByTestId("init-progress-message")).toBeVisible();

    // Simulate init progress events
    await emitTauriEvent(page, "agent-init-progress", {
      agent_id: "agent-001",
      subtype: "init_start",
      timestamp: Date.now(),
    });
    await page.waitForTimeout(50);

    // Progress message should update
    await expect(page.getByTestId("init-progress-message")).toContainText(
      "Loading SDK modules",
    );

    await emitTauriEvent(page, "agent-init-progress", {
      agent_id: "agent-001",
      subtype: "sdk_ready",
      timestamp: Date.now(),
    });
    await page.waitForTimeout(50);

    await expect(page.getByTestId("init-progress-message")).toContainText(
      "Connecting to API",
    );

    // Now send the first agent message — this should clear the initializing indicator
    await emitTauriEvent(page, "agent-message", {
      agent_id: "agent-001",
      message: {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Starting research..." }],
        },
      },
    });
    await page.waitForTimeout(100);

    // The initializing indicator should be gone
    await expect(page.getByTestId("agent-initializing-indicator")).not.toBeVisible();

    // The agent output panel should now be showing
    await expect(page.getByText("Starting research...")).toBeVisible();
  });

  test("assistant messages render in the output panel", async ({ page }) => {
    await navigateToWorkflow(page);

    // Start the step
    await page.getByRole("button", { name: "Start Step" }).click();
    await page.waitForTimeout(100);

    // Emit messages manually (without completing the run) so the agent
    // output panel stays visible and doesn't get replaced by the
    // completion screen.
    for (const text of researchFixture.messages) {
      await emitTauriEvent(page, "agent-message", {
        agent_id: "agent-001",
        message: {
          type: "assistant",
          message: {
            content: [{ type: "text", text }],
          },
        },
      });
      await page.waitForTimeout(50);
    }

    // Wait for messages to render
    await page.waitForTimeout(200);

    // Verify assistant messages rendered — check for distinctive text from each message.
    // These are rendered as markdown, so headings become visible text.
    await expect(page.getByText("Researching Domain Concepts")).toBeVisible();
    await expect(page.getByText("Key Findings")).toBeVisible();
    await expect(page.getByText("Generating Clarification Questions")).toBeVisible();
  });

  test("runtime error dialog appears on agent-init-error", async ({ page }) => {
    await navigateToWorkflow(page);

    // Start the step to enter initializing state
    await page.getByRole("button", { name: "Start Step" }).click();
    await page.waitForTimeout(100);

    // Simulate an init error (e.g. Node.js not found)
    await simulateAgentInitError(page, {
      errorType: "node_missing",
      message: "Node.js is not installed or not found in PATH.",
      fixHint: "Install Node.js 18-24 from https://nodejs.org",
    });
    await page.waitForTimeout(200);

    // The runtime error dialog should appear with the correct title
    await expect(
      page.getByRole("heading", { name: "Node.js Not Installed" }),
    ).toBeVisible();

    // Error message should be visible
    await expect(
      page.getByText("Node.js is not installed or not found in PATH."),
    ).toBeVisible();

    // Fix hint should be visible
    await expect(
      page.getByText("Install Node.js 18-24 from https://nodejs.org"),
    ).toBeVisible();

    // The initializing indicator should be gone (cleared by the error handler)
    await expect(page.getByTestId("agent-initializing-indicator")).not.toBeVisible();

    // Dismiss the dialog
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(
      page.getByRole("heading", { name: "Node.js Not Installed" }),
    ).not.toBeVisible();
  });

  test("step completes and advances after agent-exit", async ({ page }) => {
    await navigateToWorkflow(page);

    // Verify Step 1 header is visible
    await expect(page.getByText("Step 1: Research Concepts")).toBeVisible();

    // Start the step
    await page.getByRole("button", { name: "Start Step" }).click();
    await page.waitForTimeout(100);

    // Simulate a full agent run (init -> messages -> result -> exit)
    await simulateAgentRun(page, {
      agentId: "agent-001",
      messages: ["Analyzing domain..."],
      result: "Analysis complete.",
      delays: 50,
    });

    // Wait for the completion effect chain:
    // captureStepArtifacts -> mark step complete -> advanceToNextStep
    // After advancing, Step 2 (Concepts Review) becomes the current step.
    await page.waitForTimeout(500);

    // The workflow should have advanced to Step 2 (Concepts Review).
    // Step header should now show the next step.
    await expect(page.getByText("Step 2: Concepts Review")).toBeVisible();

    // Step 1 in the sidebar should show as completed (green checkmark icon
    // is rendered by WorkflowSidebar for completed status).
    // The sidebar button for step 1 should be clickable (completed steps are).
    const step1Button = page.locator("button").filter({ hasText: "1. Research Concepts" });
    await expect(step1Button).toBeVisible();
    // Completed steps are NOT disabled in the sidebar
    await expect(step1Button).toBeEnabled();
  });
});

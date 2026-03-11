/**
 * E2E tests for agent lifecycle within the workflow page.
 *
 * These tests use the agent simulator to dispatch Tauri events through
 * `window.__TAURI_EVENT_HANDLERS__`, exercising the same code paths
 * the real sidecar would trigger.
 *
 * All events use the DisplayItem pipeline (no legacy assistant messages).
 */
import { test, expect } from "@playwright/test";
import {
  emitTauriEvent,
  simulateAgentRun,
  simulateAgentInitError,
} from "../helpers/agent-simulator";
import { navigateToWorkflowUpdateMode } from "../helpers/workflow-helpers";
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

/** Alias — all agent lifecycle tests need update mode. */
const navigateToWorkflow = navigateToWorkflowUpdateMode;

test.describe("Workflow Agent Lifecycle", { tag: "@workflow-agent" }, () => {
  test("init spinner shows then clears when agent messages arrive", async ({ page }) => {
    await navigateToWorkflow(page);

    // Verify we're on the workflow page with Step 1 visible
    await expect(page.getByText("Step 1: Research")).toBeVisible();

    // Agent auto-starts in update mode — the initializing indicator should appear
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });
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

    // Now send the first display item — this should clear the initializing indicator
    await emitTauriEvent(page, "agent-message", {
      agent_id: "agent-001",
      message: {
        type: "display_item",
        item: {
          id: "di-output-0",
          type: "output",
          timestamp: Date.now(),
          outputText: "Starting research...",
        },
      },
    });
    await page.waitForTimeout(100);

    // The initializing indicator should be gone
    await expect(page.getByTestId("agent-initializing-indicator")).not.toBeVisible();

    // The agent output panel should now be showing
    await expect(page.getByText("Starting research...")).toBeVisible();
  });

  test("display items render in the output panel", async ({ page }) => {
    await navigateToWorkflow(page);

    // Agent auto-starts — wait for init indicator
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });

    // Emit display items manually (without completing the run) so the agent
    // output panel stays visible and doesn't get replaced by the
    // completion screen.
    for (let i = 0; i < researchFixture.messages.length; i++) {
      await emitTauriEvent(page, "agent-message", {
        agent_id: "agent-001",
        message: {
          type: "display_item",
          item: {
            id: `di-output-${i}`,
            type: "output",
            timestamp: Date.now(),
            outputText: researchFixture.messages[i],
          },
        },
      });
      await page.waitForTimeout(50);
    }

    // Wait for items to render
    await page.waitForTimeout(200);

    // Verify display items rendered — check for distinctive text from each message.
    // These are rendered as markdown, so headings become visible text.
    await expect(page.getByText("Researching Domain Concepts")).toBeVisible();
    await expect(page.getByText("Key Findings")).toBeVisible();
    await expect(page.getByText("Generating Clarification Questions")).toBeVisible();
  });

  test("runtime error dialog appears on agent-init-error", async ({ page }) => {
    await navigateToWorkflow(page);

    // Agent auto-starts — wait for init indicator
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });

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

  test("step completion transitions out of running state after agent-exit", async ({ page }) => {
    await navigateToWorkflow(page);

    // Verify Step 1 header is visible
    await expect(page.getByText("Step 1: Research")).toBeVisible();

    // Agent auto-starts — wait for init indicator before simulating events
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });

    // Simulate a full agent run (init -> display items -> result -> exit)
    await simulateAgentRun(page, {
      agentId: "agent-001",
      messages: ["Analyzing domain..."],
      result: "Analysis complete.",
      delays: 50,
    });

    // Wait for the completion effect chain:
    // verifyStepOutput -> mark step complete -> show completion screen
    await page.waitForTimeout(500);

    // Step should no longer be in the initializing/running state.
    await expect(page.getByTestId("agent-initializing-indicator")).not.toBeVisible();

    // Step 1 in the sidebar remains enabled after completion.
    const step1Button = page.locator("button").filter({ hasText: "1. Research" });
    await expect(step1Button).toBeVisible();
    await expect(step1Button).toBeEnabled();
  });
});

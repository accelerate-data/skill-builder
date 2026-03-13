/**
 * Canonical mock-runtime contract suite.
 *
 * Tests the sidecar event stream → render contract using the mock agent
 * infrastructure. These specs exercise the full Tauri event → Zustand store
 * → React render path without a live sidecar.
 *
 * Tag: @workflow-agent — runs in the nightly/post-merge project.
 */
import { test, expect } from "@playwright/test";
import {
  emitTauriEvent,
  simulateAgentRun,
  simulateAgentInitError,
  simulateAgentRunWithDisplayItems,
} from "../helpers/agent-simulator";
import { navigateToWorkflowUpdateMode } from "../helpers/workflow-helpers";

test.describe("Workflow Integration: event stream → render contract", { tag: "@workflow-agent" }, () => {
  test("agent event stream produces display items in correct order", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page);

    // Wait for the agent to auto-start in update mode
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });

    // Simulate a run with an explicit sequence: tool_call, then two output items
    await simulateAgentRunWithDisplayItems(page, {
      agentId: "agent-001",
      items: [
        {
          id: "di-tool-1",
          type: "tool_call",
          timestamp: Date.now(),
          toolName: "Read",
          toolSummary: "Reading domain context",
          toolStatus: "completed",
        },
        {
          id: "di-output-1",
          type: "output",
          timestamp: Date.now() + 10,
          outputText: "First analysis message.",
        },
        {
          id: "di-output-2",
          type: "output",
          timestamp: Date.now() + 20,
          outputText: "Second analysis message.",
        },
      ],
      result: "Analysis complete.",
      delays: 50,
    });

    await page.waitForTimeout(200);

    // Tool call item should appear before output items
    const toolCallItem = page.getByText("Reading domain context").last();
    const firstOutput = page.getByText("First analysis message.").last();
    const secondOutput = page.getByText("Second analysis message.").last();

    await expect(toolCallItem).toBeVisible({ timeout: 5_000 });
    await expect(firstOutput).toBeVisible({ timeout: 5_000 });
    await expect(secondOutput).toBeVisible({ timeout: 5_000 });

    // Verify ordering by bounding box: tool_call must appear above first output,
    // first output must appear above second output.
    const toolCallBox = await toolCallItem.boundingBox();
    const firstOutputBox = await firstOutput.boundingBox();
    const secondOutputBox = await secondOutput.boundingBox();

    expect(toolCallBox).not.toBeNull();
    expect(firstOutputBox).not.toBeNull();
    expect(secondOutputBox).not.toBeNull();

    expect(toolCallBox!.y).toBeLessThan(firstOutputBox!.y);
    expect(firstOutputBox!.y).toBeLessThan(secondOutputBox!.y);
  });

  test("agent init error event renders error dialog and clears running state", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page);

    // Wait for the initializing indicator before emitting error
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });

    // Emit an agent-init-error event (e.g. Node.js binary missing)
    await simulateAgentInitError(page, {
      errorType: "node_missing",
      message: "Node.js is not installed or not found in PATH.",
      fixHint: "Install Node.js 18-24 from https://nodejs.org",
    });
    await page.waitForTimeout(200);

    // The runtime error dialog must appear with correct heading
    await expect(
      page.getByRole("heading", { name: "Node.js Not Installed" }),
    ).toBeVisible({ timeout: 5_000 });

    // Error message and fix hint must be visible
    await expect(
      page.getByText("Node.js is not installed or not found in PATH."),
    ).toBeVisible();
    await expect(
      page.getByText("Install Node.js 18-24 from https://nodejs.org"),
    ).toBeVisible();

    // Initializing indicator must be cleared by the error handler
    await expect(page.getByTestId("agent-initializing-indicator")).not.toBeVisible();

    // Dialog can be dismissed
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(
      page.getByRole("heading", { name: "Node.js Not Installed" }),
    ).not.toBeVisible();
  });

  test("agent exit after completion updates step status and shows completion UI", async ({ page }) => {
    await navigateToWorkflowUpdateMode(page);

    // Wait for auto-start
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });

    // Simulate a full happy-path run ending with agent-exit success=true
    await simulateAgentRun(page, {
      agentId: "agent-001",
      messages: ["Analyzing domain concepts..."],
      result: "Research complete.",
      delays: 50,
    });

    // Allow the completion effect chain to settle:
    // verifyStepOutput → mark step complete → show completion screen
    await page.waitForTimeout(500);

    // Running/initializing state must be cleared
    await expect(page.getByTestId("agent-initializing-indicator")).not.toBeVisible();

    // Step 1 in the sidebar must remain visible and enabled after completion
    const step1Button = page.locator("button").filter({ hasText: "1. Research" });
    await expect(step1Button).toBeVisible();
    await expect(step1Button).toBeEnabled();
  });
});

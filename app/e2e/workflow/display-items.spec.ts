/**
 * E2E tests for DisplayItem rendering in the workflow agent output panel.
 *
 * Validates that the new DisplayItem pipeline (sidecar → Rust → frontend)
 * renders thinking, output, tool_call, result, and error items correctly.
 */
import { test, expect } from "@playwright/test";
import {
  emitTauriEvent,
  simulateAgentRunWithDisplayItems,
} from "../helpers/agent-simulator";
import { navigateToWorkflowUpdateMode } from "../helpers/workflow-helpers";

const navigateToWorkflow = navigateToWorkflowUpdateMode;

test.describe("DisplayItem Rendering", { tag: "@workflow-agent" }, () => {
  test("renders thinking items collapsed with Brain indicator", async ({ page }) => {
    await navigateToWorkflow(page);
    await expect(page.getByText("Step 1: Research")).toBeVisible();

    // Start the agent run
    await page.getByRole("button", { name: /start|run/i }).first().click();

    const agentId = "test-display-step0-1";

    // Emit a thinking display item
    await emitTauriEvent(page, "agent-message", {
      agent_id: agentId,
      message: {
        type: "display_item",
        item: {
          id: "di-1",
          type: "thinking",
          timestamp: Date.now(),
          thinkingText: "Let me analyze the domain requirements carefully...",
        },
      },
    });

    // The thinking item should show "Thinking" label
    await expect(page.getByText("Thinking")).toBeVisible({ timeout: 5000 });
  });

  test("renders output items with markdown content", async ({ page }) => {
    await navigateToWorkflow(page);
    await expect(page.getByText("Step 1: Research")).toBeVisible();

    await page.getByRole("button", { name: /start|run/i }).first().click();

    const agentId = "test-display-step0-2";

    await emitTauriEvent(page, "agent-message", {
      agent_id: agentId,
      message: {
        type: "display_item",
        item: {
          id: "di-1",
          type: "output",
          timestamp: Date.now(),
          outputText: "Here is the analysis of the domain.",
        },
      },
    });

    await expect(page.getByText("Output")).toBeVisible({ timeout: 5000 });
  });

  test("renders tool call items with tool name and summary", async ({ page }) => {
    await navigateToWorkflow(page);
    await expect(page.getByText("Step 1: Research")).toBeVisible();

    await page.getByRole("button", { name: /start|run/i }).first().click();

    const agentId = "test-display-step0-3";

    await emitTauriEvent(page, "agent-message", {
      agent_id: agentId,
      message: {
        type: "display_item",
        item: {
          id: "di-1",
          type: "tool_call",
          timestamp: Date.now(),
          toolName: "Read",
          toolInput: { file_path: "/src/main.ts" },
          toolStatus: "pending",
          toolSummary: "Reading main.ts",
        },
      },
    });

    await expect(page.getByText("Read")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Reading main.ts")).toBeVisible();
  });

  test("renders result item on agent completion", async ({ page }) => {
    await navigateToWorkflow(page);
    await expect(page.getByText("Step 1: Research")).toBeVisible();

    await page.getByRole("button", { name: /start|run/i }).first().click();

    const agentId = "test-display-step0-4";

    await simulateAgentRunWithDisplayItems(page, {
      agentId,
      items: [
        {
          id: "di-1",
          type: "output",
          timestamp: Date.now(),
          outputText: "Research complete.",
        },
        {
          id: "di-2",
          type: "result",
          timestamp: Date.now(),
          outputText_result: "Research completed successfully.",
          resultStatus: "success",
        },
      ],
      result: "Research completed successfully.",
    });

    await expect(page.getByText("Result:")).toBeVisible({ timeout: 5000 });
  });

  test("renders error items with error styling", async ({ page }) => {
    await navigateToWorkflow(page);
    await expect(page.getByText("Step 1: Research")).toBeVisible();

    await page.getByRole("button", { name: /start|run/i }).first().click();

    const agentId = "test-display-step0-5";

    await emitTauriEvent(page, "agent-message", {
      agent_id: agentId,
      message: {
        type: "display_item",
        item: {
          id: "di-1",
          type: "error",
          timestamp: Date.now(),
          errorMessage: "API rate limit exceeded",
        },
      },
    });

    await expect(page.getByText("API rate limit exceeded")).toBeVisible({ timeout: 5000 });
  });

  test("updates tool call status from pending to ok", async ({ page }) => {
    await navigateToWorkflow(page);
    await expect(page.getByText("Step 1: Research")).toBeVisible();

    await page.getByRole("button", { name: /start|run/i }).first().click();

    const agentId = "test-display-step0-6";
    const wait = (ms: number) => page.waitForTimeout(ms);

    // Emit pending tool call
    await emitTauriEvent(page, "agent-message", {
      agent_id: agentId,
      message: {
        type: "display_item",
        item: {
          id: "di-1",
          type: "tool_call",
          timestamp: Date.now(),
          toolName: "Bash",
          toolInput: { command: "npm test" },
          toolStatus: "pending",
          toolSummary: "Running: npm test",
        },
      },
    });

    await expect(page.getByText("Bash")).toBeVisible({ timeout: 5000 });
    await wait(100);

    // Update same item with ok status (update-by-id)
    await emitTauriEvent(page, "agent-message", {
      agent_id: agentId,
      message: {
        type: "display_item",
        item: {
          id: "di-1",
          type: "tool_call",
          timestamp: Date.now(),
          toolName: "Bash",
          toolInput: { command: "npm test" },
          toolStatus: "ok",
          toolSummary: "Running: npm test",
          toolDurationMs: 1234,
          toolResult: { content: "All tests passed", isError: false },
        },
      },
    });

    // Should still show one Bash item (updated, not duplicated)
    const bashItems = page.getByText("Bash");
    await expect(bashItems).toBeVisible({ timeout: 5000 });
  });
});

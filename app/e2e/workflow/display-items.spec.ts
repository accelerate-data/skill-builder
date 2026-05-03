/**
 * E2E tests for DisplayItem rendering in the workflow agent output panel.
 *
 * Validates that the DisplayItem pipeline (sidecar → Rust → frontend)
 * renders thinking, output, tool_call, result, and error items correctly.
 *
 * VU-658 changed the rendering model:
 * - Output items render as bare markdown (no "Output" header)
 * - Tool calls are grouped into a "Tool Activity" summary row
 */
import { test, expect } from "@playwright/test";
import { emitTauriEvent } from "../helpers/agent-simulator";
import { navigateToWorkflowUpdateMode } from "../helpers/workflow-helpers";

const navigateToWorkflow = navigateToWorkflowUpdateMode;

let agentId: string;

test.describe("DisplayItem Rendering", { tag: "@workflow" }, () => {
  test.beforeEach(async ({ page }) => {
    await navigateToWorkflow(page);
    await expect(page.getByText("Step 1: Research")).toBeVisible({ timeout: 10_000 });
    agentId = "agent-001";
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 5_000 });
  });

  test("renders thinking items collapsed with Brain indicator", async ({ page }) => {
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

    // Thinking items are grouped into Tool Activity — look for the group summary
    await expect(page.getByTestId("tool-activity-group")).toBeVisible({ timeout: 5000 });
  });

  test("renders output items as bare markdown content", async ({ page }) => {
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

    // Output items render as bare markdown (no "Output" label since VU-658)
    await expect(page.getByText("Here is the analysis of the domain.")).toBeVisible({ timeout: 5000 });
  });

  test("renders tool call items in a Tool Activity group", async ({ page }) => {
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

    // Tool calls are grouped into a "Tool Activity" summary row
    const group = page.getByTestId("tool-activity-group");
    await expect(group).toBeVisible({ timeout: 5000 });
    await expect(group.getByText("Tool Activity")).toBeVisible();
    await expect(group.getByText(/1 Read/)).toBeVisible();
  });

  test("renders result item on agent completion", async ({ page }) => {
    await emitTauriEvent(page, "agent-message", {
      agent_id: agentId,
      message: {
        type: "display_item",
        item: {
          id: "di-2",
          type: "result",
          timestamp: Date.now(),
          outputText_result: "Research completed successfully.",
          resultStatus: "success",
        },
      },
    });

    await expect(page.getByText("Research completed successfully.").last()).toBeVisible({ timeout: 5000 });
  });

  test("renders OpenHands conversation events and terminal state", async ({ page }) => {
    await emitTauriEvent(page, "agent-message", {
      agent_id: agentId,
      message: {
        type: "conversation_event",
        runtime: "openhands",
        conversation_id: "conv-1",
        event_class: "MessageEvent",
        timestamp: Date.now(),
        event: {
          source: "assistant",
          message: "Scope looks focused.",
        },
      },
    });

    await expect(page.getByTestId("conversation-event-list")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Scope looks focused.")).toBeVisible();

    await emitTauriEvent(page, "agent-message", {
      agent_id: agentId,
      message: {
        type: "conversation_state",
        runtime: "openhands",
        conversation_id: "conv-1",
        status: "completed",
        timestamp: Date.now(),
      },
    });

    await expect(page.getByRole("button", { name: /Research Complete/ })).toBeVisible({
      timeout: 5000,
    });
  });

  test("renders error items with error styling", async ({ page }) => {
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

    // Tool Activity group should show with pending status
    const group = page.getByTestId("tool-activity-group");
    await expect(group).toBeVisible({ timeout: 5000 });
    await expect(group.getByText(/1 Bash/)).toBeVisible();

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

    // Group should still show one Bash item (updated, not duplicated)
    await expect(group.getByText(/1 Bash/)).toBeVisible({ timeout: 5000 });
  });
});

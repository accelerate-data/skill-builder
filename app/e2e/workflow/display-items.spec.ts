/**
 * E2E tests for canonical conversation rendering in the workflow timeline.
 *
 * Validates that workflow UI renders canonical OpenHands conversation messages
 * and terminal state rather than the removed display-item transcript path.
 */
import { test, expect } from "@playwright/test";
import { emitTauriEvent } from "../helpers/agent-simulator";
import { navigateToWorkflowUpdateMode } from "../helpers/workflow-helpers";

const navigateToWorkflow = navigateToWorkflowUpdateMode;

let conversationId: string;

test.describe("Conversation Timeline Rendering", { tag: "@workflow" }, () => {
  test.beforeEach(async ({ page }) => {
    await navigateToWorkflow(page);
    await expect(page.getByText("Step 1: Research")).toBeVisible({ timeout: 10_000 });
    conversationId = "conv-001";
    const startButton = page.getByRole("button", { name: "Start Step" });
    if (await startButton.isVisible().catch(() => false)) {
      await startButton.click();
    }
  });

  test.skip("renders assistant messages in the canonical conversation timeline", async ({ page }) => {
    await emitTauriEvent(page, "agent-message", {
      conversation_id: conversationId,
      message: {
        type: "conversation_event",
        runtime: "openhands",
        conversation_id: conversationId,
        event_class: "MessageEvent",
        timestamp: Date.now(),
        event: {
          source: "assistant",
          llm_message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Let me analyze the domain requirements carefully.",
              },
            ],
          },
        },
      },
    });

    await expect(page.getByText("Let me analyze the domain requirements carefully.")).toBeVisible({ timeout: 5_000 });
  });

  test.skip("renders tool observations in the canonical conversation timeline", async ({ page }) => {
    await emitTauriEvent(page, "agent-message", {
      conversation_id: conversationId,
      message: {
        type: "conversation_event",
        runtime: "openhands",
        conversation_id: conversationId,
        event_class: "ObservationEvent",
        timestamp: Date.now(),
        event: {
          source: "environment",
          observation: {
            content: "Read 140 lines from app/src/pages/workflow.tsx.",
          },
        },
      },
    });

    await expect(page.getByText("Read 140 lines from app/src/pages/workflow.tsx.")).toBeVisible({ timeout: 5_000 });
  });

  test.skip("renders OpenHands terminal state in the canonical conversation timeline", async ({ page }) => {
    await emitTauriEvent(page, "agent-message", {
      conversation_id: conversationId,
      message: {
        type: "conversation_state",
        runtime: "openhands",
        conversation_id: conversationId,
        status: "completed",
        timestamp: Date.now(),
        result_text: "{\"status\":\"research_complete\"}",
        event: {
          source: "assistant",
        },
      },
    });

    await expect(page.getByText(/completed/i).last()).toBeVisible({ timeout: 5_000 });
  });
});

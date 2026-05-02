import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore, flushDisplayItems } from "@/stores/agent-store";
import type { DisplayItem } from "@/lib/display-types";
import {
  normalizeConversationEventMessage,
  type OpenHandsConversationEvent,
} from "@/lib/openhands-conversation-events";
import {
  openHandsActionEventRecord,
  openHandsAgentErrorEventRecord,
  openHandsCondensationStartEventRecord,
  openHandsCondensationSummaryEventRecord,
  openHandsConversationErrorEventRecord,
  openHandsConversationStateUpdateEventRecord,
  openHandsMessageEventRecord,
  openHandsObservationEventRecord,
  openHandsParallelActionEventRecords,
  openHandsPauseEventRecord,
  openHandsRawPayloadEventRecord,
  openHandsSystemPromptEventRecord,
  openHandsUnknownEventRecord,
  openHandsUserRejectObservationRecord,
} from "../fixtures/openhands-conversation-events";

// Polyfill scrollIntoView for jsdom
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// Mock react-markdown to avoid ESM issues in tests
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

// Mock remark-gfm
vi.mock("remark-gfm", () => ({
  default: () => {},
}));


import { AgentOutputPanel } from "@/components/agent-output-panel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDisplayItem(overrides: Partial<DisplayItem> & { type: DisplayItem["type"] }): DisplayItem {
  return {
    id: `di-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    ...overrides,
  } as DisplayItem;
}

function addDisplayItems(agentId: string, items: DisplayItem[]) {
  for (const item of items) {
    useAgentStore.getState().addDisplayItem(agentId, item);
  }
  flushDisplayItems();
}

function normalizeFixture(
  record: Record<string, unknown>,
): OpenHandsConversationEvent {
  const event = normalizeConversationEventMessage(record);
  if (!event) throw new Error("fixture did not normalize");
  return event;
}

function addConversationFixtures(
  agentId: string,
  records: Record<string, unknown>[],
) {
  const store = useAgentStore.getState();
  for (const record of records) {
    store.addConversationEvent(agentId, normalizeFixture(record));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentOutputPanel", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
  });

  it("shows empty state when no run exists", () => {
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText("No agent output yet")).toBeInTheDocument();
  });

  it("renders AgentRunFooter when run exists", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByTestId("agent-run-footer")).toBeInTheDocument();
  });

  it("shows running status in footer for running agent", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    addDisplayItems("test-agent", [
      makeDisplayItem({ type: "output", outputText: "Starting..." }),
    ]);
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText("running\u2026")).toBeInTheDocument();
  });

  it("shows model badge with friendly name", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText("Sonnet")).toBeInTheDocument();
  });

  it("shows completed status in footer for completed agent", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().completeRun("test-agent", true);
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText("completed")).toBeInTheDocument();
  });

  it("shows error status in footer for failed agent", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().completeRun("test-agent", false);
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("renders thinking display item inside tool activity group", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    addDisplayItems("test-agent", [
      makeDisplayItem({
        type: "thinking",
        thinkingText: "Analyzing the domain requirements...",
      }),
    ]);
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByTestId("tool-activity-group")).toBeInTheDocument();
    expect(screen.getByText("Tool Activity")).toBeInTheDocument();
  });

  it("renders output display item with text", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    addDisplayItems("test-agent", [
      makeDisplayItem({
        type: "output",
        outputText: "Here is the analysis of the domain.",
      }),
    ]);
    render(<AgentOutputPanel agentId="test-agent" />);
    // Text appears in both summary and expanded body
    expect(screen.getAllByText("Here is the analysis of the domain.").length).toBeGreaterThanOrEqual(1);
  });

  it("renders OpenHands conversation events instead of display items when present", () => {
    useAgentStore.getState().startRun("openhands-agent", "sonnet");
    addDisplayItems("openhands-agent", [
      makeDisplayItem({
        type: "output",
        outputText: "Legacy display item should be hidden for OpenHands.",
      }),
    ]);
    useAgentStore.getState().addConversationEvent("openhands-agent", {
      type: "conversation_event",
      runtime: "openhands",
      conversationId: "conv-1",
      eventClass: "MessageEvent",
      timestamp: Date.now(),
      event: {
        source: "assistant",
        message: "OpenHands rendered message.",
      },
    });

    render(<AgentOutputPanel agentId="openhands-agent" />);

    expect(screen.getByTestId("conversation-event-list")).toBeInTheDocument();
    expect(screen.getByText("OpenHands rendered message.")).toBeInTheDocument();
    expect(
      screen.queryByText("Legacy display item should be hidden for OpenHands."),
    ).not.toBeInTheDocument();
  });

  it("renders OpenHands action, observation, error, and unknown event content", () => {
    useAgentStore.getState().startRun("openhands-agent", "sonnet");
    const store = useAgentStore.getState();
    store.addConversationEvent("openhands-agent", {
      type: "conversation_event",
      runtime: "openhands",
      conversationId: "conv-1",
      eventClass: "ActionEvent",
      timestamp: Date.now(),
      event: {
        thought: "Need to inspect files.",
        tool_name: "terminal",
        command: "npm test",
      },
    });
    store.addConversationEvent("openhands-agent", {
      type: "conversation_event",
      runtime: "openhands",
      conversationId: "conv-1",
      eventClass: "ObservationEvent",
      timestamp: Date.now(),
      event: {
        content: "All tests passed.",
      },
    });
    store.addConversationEvent("openhands-agent", {
      type: "conversation_event",
      runtime: "openhands",
      conversationId: "conv-1",
      eventClass: "AgentErrorEvent",
      timestamp: Date.now(),
      event: {
        tool_name: "file_editor",
        error: "Patch failed.",
      },
    });
    store.addConversationEvent("openhands-agent", {
      type: "conversation_event",
      runtime: "openhands",
      conversationId: "conv-1",
      eventClass: "ConversationErrorEvent",
      timestamp: Date.now(),
      event: {
        message: "Conversation stopped.",
      },
    });
    store.addConversationEvent("openhands-agent", {
      type: "conversation_event",
      runtime: "openhands",
      conversationId: "conv-1",
      eventClass: "CustomEvent",
      timestamp: Date.now(),
      event: {
        note: "Unexpected payload.",
      },
    });

    render(<AgentOutputPanel agentId="openhands-agent" />);

    expect(screen.getByText("Need to inspect files.")).toBeInTheDocument();
    expect(screen.getByText("terminal")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.getByText("All tests passed.")).toBeInTheDocument();
    expect(screen.getByText("Patch failed.")).toBeInTheDocument();
    expect(screen.getByText("Conversation stopped.")).toBeInTheDocument();
    expect(screen.getByText("CustomEvent")).toBeInTheDocument();
    expect(screen.getByText(/Unexpected payload/)).toBeInTheDocument();
  });

  it("renders realistic OpenHands SDK event shapes readably", () => {
    useAgentStore.getState().startRun("openhands-agent", "sonnet");
    addConversationFixtures("openhands-agent", [
      openHandsMessageEventRecord,
      openHandsActionEventRecord,
      openHandsObservationEventRecord,
      openHandsUserRejectObservationRecord,
      openHandsAgentErrorEventRecord,
      openHandsConversationErrorEventRecord,
      openHandsSystemPromptEventRecord,
      openHandsCondensationStartEventRecord,
      openHandsCondensationSummaryEventRecord,
      openHandsConversationStateUpdateEventRecord,
      openHandsPauseEventRecord,
      openHandsUnknownEventRecord,
      openHandsRawPayloadEventRecord,
    ]);

    render(<AgentOutputPanel agentId="openhands-agent" />);

    expect(
      screen.getByText("I will inspect the current workflow files."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Need the helper source before editing/)).toBeInTheDocument();
    expect(screen.getByText(/Use a focused read before patching/)).toBeInTheDocument();
    expect(screen.getAllByText("read_file").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("call-single")).toBeInTheDocument();
    expect(screen.getByText("resp-single")).toBeInTheDocument();
    expect(
      screen.getByText(/app\/src\/lib\/openhands-conversation-events\.ts/),
    ).toBeInTheDocument();
    expect(screen.getByText("Read 140 lines from the helper.")).toBeInTheDocument();
    expect(
      screen.getByText("User rejected the proposed file edit."),
    ).toBeInTheDocument();
    expect(screen.getByText("Tool execution failed.")).toBeInTheDocument();
    expect(
      screen.getByText("Conversation stopped after runtime error."),
    ).toBeInTheDocument();
    expect(screen.getByText("System prompt prepared.")).toBeInTheDocument();
    expect(screen.getByText("CondensationStartEvent")).toBeInTheDocument();
    expect(screen.getByText("Conversation context condensed.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The conversation was condensed after reading helper files.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('State updated: {"phase":"running","iteration":2}'),
    ).toBeInTheDocument();
    expect(screen.getByText("Paused: Waiting for user input.")).toBeInTheDocument();
    expect(screen.getByText("CustomSdkEvent")).toBeInTheDocument();
    expect(screen.getByText(/Preserve unknown payloads/)).toBeInTheDocument();
    expect(screen.getByText("RawFallbackEvent")).toBeInTheDocument();
    expect(screen.getByText(/SDK event string fallback/)).toBeInTheDocument();
  });

  it("groups parallel OpenHands action events by llm_response_id for display", () => {
    useAgentStore.getState().startRun("openhands-agent", "sonnet");
    addConversationFixtures("openhands-agent", [
      ...openHandsParallelActionEventRecords,
      openHandsActionEventRecord,
    ]);

    render(<AgentOutputPanel agentId="openhands-agent" />);

    expect(screen.getByText("Parallel Actions (2)")).toBeInTheDocument();
    expect(screen.getByText("Fetch the source and tests in parallel.")).toBeInTheDocument();
    expect(screen.getByText("resp-parallel")).toBeInTheDocument();
    expect(screen.getByText("call-list")).toBeInTheDocument();
    expect(screen.getByText("call-read-tests")).toBeInTheDocument();
    expect(screen.getByText("list_files")).toBeInTheDocument();
    expect(screen.getAllByText("read_file").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Action")).toBeInTheDocument();
    expect(screen.getByText("resp-single")).toBeInTheDocument();
  });

  it("renders tool_call display item inside tool activity group", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    addDisplayItems("test-agent", [
      makeDisplayItem({
        type: "tool_call",
        toolName: "Read",
        toolInput: { file_path: "/foo/bar/test.md" },
        toolStatus: "pending",
        toolSummary: "Reading test.md",
      }),
    ]);
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByTestId("tool-activity-group")).toBeInTheDocument();
    expect(screen.getByText("1 tool (1 Read)")).toBeInTheDocument();
  });

  it("renders result display item", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    addDisplayItems("test-agent", [
      makeDisplayItem({
        type: "result",
        outputText_result: "Agent finished successfully",
        resultStatus: "success",
      }),
    ]);
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText(/Agent finished successfully/)).toBeInTheDocument();
  });

  it("renders error display item", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    addDisplayItems("test-agent", [
      makeDisplayItem({
        type: "error",
        errorMessage: "Something went wrong",
      }),
    ]);
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("updates display item in-place by id (update-by-id)", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    const itemId = "di-tool-1";
    addDisplayItems("test-agent", [
      makeDisplayItem({
        id: itemId,
        type: "tool_call",
        toolName: "Bash",
        toolInput: { command: "npm test" },
        toolStatus: "pending",
        toolSummary: "Running: npm test",
      }),
    ]);
    // Update same id with ok status
    addDisplayItems("test-agent", [
      makeDisplayItem({
        id: itemId,
        type: "tool_call",
        toolName: "Bash",
        toolInput: { command: "npm test" },
        toolStatus: "ok",
        toolSummary: "Running: npm test",
        toolDurationMs: 1234,
      }),
    ]);
    render(<AgentOutputPanel agentId="test-agent" />);
    // Should only have one tool activity group (one underlying item, not two)
    const groups = screen.getAllByTestId("tool-activity-group");
    expect(groups).toHaveLength(1);
    expect(screen.getByText("1 tool (1 Bash)")).toBeInTheDocument();
  });

  it("shows token usage and cost in footer when run is completed", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    // Simulate token usage and cost being set (normally via sidecar persistence)
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        "test-agent": {
          ...state.runs["test-agent"],
          tokenUsage: { input: 1000, output: 500 },
          totalCost: 0.05,
        },
      },
    }));
    useAgentStore.getState().completeRun("test-agent", true);
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText(/2K/)).toBeInTheDocument();
    expect(screen.getByText("$0.0500")).toBeInTheDocument();
  });

  it("renders multiple display items in order", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    addDisplayItems("test-agent", [
      makeDisplayItem({
        id: "di-1",
        type: "thinking",
        thinkingText: "Let me think...",
      }),
      makeDisplayItem({
        id: "di-2",
        type: "output",
        outputText: "Here is the plan.",
      }),
      makeDisplayItem({
        id: "di-3",
        type: "tool_call",
        toolName: "Read",
        toolInput: { file_path: "/a.ts" },
        toolStatus: "ok",
        toolSummary: "Reading a.ts",
      }),
    ]);
    render(<AgentOutputPanel agentId="test-agent" />);
    // thinking (di-1) forms first tool-activity group, tool_call (di-3) forms second
    const groups = screen.getAllByTestId("tool-activity-group");
    expect(groups).toHaveLength(2);
    // Output text renders as bare markdown
    expect(screen.getAllByText("Here is the plan.").length).toBeGreaterThanOrEqual(1);
    // Second group shows tool count
    expect(screen.getByText("1 tool (1 Read)")).toBeInTheDocument();
  });

  it("windows large agent output lists while keeping the newest output visible", () => {
    useAgentStore.getState().startRun("large-agent", "sonnet");
    const items = Array.from({ length: 120 }, (_, index) =>
      makeDisplayItem({
        id: `large-output-${index}`,
        type: "output" as const,
        outputText: `large output ${index}`,
      }),
    );

    addDisplayItems("large-agent", items);
    render(<AgentOutputPanel agentId="large-agent" />);

    expect(screen.getByTestId("display-item-window-indicator")).toHaveTextContent(
      "20 older items hidden",
    );
    expect(screen.queryByText("large output 0")).not.toBeInTheDocument();
    expect(screen.getAllByText("large output 119").length).toBeGreaterThanOrEqual(1);
  });
});

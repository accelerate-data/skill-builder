import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore, flushDisplayItems } from "@/stores/agent-store";
import type { DisplayItem } from "@/lib/display-types";

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

function makeDisplayItem(
  overrides: Partial<DisplayItem> & { type: DisplayItem["type"] },
): DisplayItem {
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
    expect(
      screen.getAllByText("Here is the analysis of the domain.").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("always renders displayItems via DisplayItemList, never ConversationEventList", () => {
    // After Task 12.5 the panel reads only displayItems. The agent-store
    // projection (Task 12.3) translates conversation events into displayItems
    // before rendering, so ConversationEventList is no longer a panel concern.
    // Detailed conversation-event rendering coverage lives in
    // openhands-event-projection.test.ts.
    useAgentStore.getState().startRun("openhands-agent", "sonnet");
    addDisplayItems("openhands-agent", [
      makeDisplayItem({
        type: "output",
        outputText: "Projected OpenHands message.",
      }),
    ]);
    // Even when the store also has raw conversation events, the panel should
    // not render via ConversationEventList — only displayItems are rendered.
    useAgentStore.getState().addConversationEvent("openhands-agent", {
      type: "conversation_event",
      runtime: "openhands",
      conversationId: "conv-1",
      eventClass: "MessageEvent",
      timestamp: Date.now(),
      event: {
        source: "user",
        message: "Task message.",
      },
    });

    render(<AgentOutputPanel agentId="openhands-agent" />);

    // Old dual-branch behaviour would render ConversationEventList; the new
    // single-branch panel never does.
    expect(screen.queryByTestId("conversation-event-list")).toBeNull();
    // The directly added displayItem is visible.
    expect(
      screen.getAllByText("Projected OpenHands message.").length,
    ).toBeGreaterThanOrEqual(1);
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
    expect(
      screen.getAllByText("Here is the plan.").length,
    ).toBeGreaterThanOrEqual(1);
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

    expect(
      screen.getByTestId("display-item-window-indicator"),
    ).toHaveTextContent("20 older items hidden");
    expect(screen.queryByText("large output 0")).not.toBeInTheDocument();
    expect(
      screen.getAllByText("large output 119").length,
    ).toBeGreaterThanOrEqual(1);
  });
});

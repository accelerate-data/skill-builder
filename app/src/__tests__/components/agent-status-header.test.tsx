import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import type { DisplayItem } from "@/lib/display-types";
import {
  AgentStatusHeader,
  getDisplayStatus,
  formatElapsed,
} from "@/components/agent-status-header";

function makeDisplayItem(overrides: Partial<DisplayItem> & { type: DisplayItem["type"] }): DisplayItem {
  return {
    id: `di-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    ...overrides,
  } as DisplayItem;
}

describe("AgentStatusHeader", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
    useWorkflowStore.getState().reset();
  });

  it("returns null when no run exists", () => {
    const { container } = render(<AgentStatusHeader agentId="test-agent" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders status and model badges for a running agent", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    render(<AgentStatusHeader agentId="test-agent" />);

    // No displayItems yet, so it should show "Initializing..." instead of "Running"
    expect(screen.getByText("Initializing\u2026")).toBeInTheDocument();
    expect(screen.getByText("Sonnet")).toBeInTheDocument();
  });

  it("shows Initializing badge with spinner when run has no displayItems", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    render(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("Initializing\u2026")).toBeInTheDocument();
    // Should NOT show "Running" when no items have arrived
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });

  it("transitions from Initializing to Running when first displayItem arrives", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    const { rerender } = render(<AgentStatusHeader agentId="test-agent" />);

    // Initially shows Initializing
    expect(screen.getByText("Initializing\u2026")).toBeInTheDocument();

    // Add a display item (simulating first agent output)
    useAgentStore.getState().addDisplayItem("test-agent", makeDisplayItem({
      type: "output",
      outputText: "Hello",
    }));

    rerender(<AgentStatusHeader agentId="test-agent" />);

    // Now should show Running
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.queryByText("Initializing\u2026")).not.toBeInTheDocument();
  });

  it("transitions from Running to Completed when run completes", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addDisplayItem("test-agent", makeDisplayItem({
      type: "output",
      outputText: "Working...",
    }));
    const { rerender } = render(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("Running")).toBeInTheDocument();

    useAgentStore.getState().completeRun("test-agent", true);
    rerender(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });

  it("transitions from Running to Error when run fails", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addDisplayItem("test-agent", makeDisplayItem({
      type: "output",
      outputText: "Working...",
    }));
    const { rerender } = render(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("Running")).toBeInTheDocument();

    useAgentStore.getState().completeRun("test-agent", false);
    rerender(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("shows elapsed time during initialization phase", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    render(<AgentStatusHeader agentId="test-agent" />);

    // Should show a time badge even during initialization (0s is acceptable)
    const timeBadge = screen.getByText(/\d+s/);
    expect(timeBadge).toBeInTheDocument();
  });

  it("shows Thinking badge when thinkingEnabled is true", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().updateMetadata("test-agent", {
      config: { thinkingEnabled: true },
    });
    render(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });

  it("does NOT show Thinking badge when thinkingEnabled is false", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().updateMetadata("test-agent", {
      config: { thinkingEnabled: false },
    });
    render(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
  });

  it("shows cost badge when totalCost is available", () => {
    useAgentStore.getState().startRun("test-agent", "opus");
    // Simulate token usage and cost (now set via sidecar persistence)
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        "test-agent": {
          ...state.runs["test-agent"],
          tokenUsage: { input: 1500, output: 500 },
          totalCost: 0.042,
        },
      },
    }));
    render(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("$0.0420")).toBeInTheDocument();
    expect(screen.getByText("2,000 tokens")).toBeInTheDocument();
  });

  it("shows Initializing when workflow store isInitializing is true even with displayItems", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    // Add a display item so displayItems is non-empty
    useAgentStore.getState().addDisplayItem("test-agent", makeDisplayItem({
      type: "output",
      outputText: "config info",
    }));

    // Simulate workflow store having isInitializing set by Stream 1
    useWorkflowStore.setState({
      isInitializing: true,
      initStartTime: Date.now() - 5000,
    } as unknown as Record<string, unknown>);

    render(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("Initializing\u2026")).toBeInTheDocument();
  });

  it("shows Running when workflow store isInitializing is false and displayItems exist", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addDisplayItem("test-agent", makeDisplayItem({
      type: "output",
      outputText: "Working",
    }));

    useWorkflowStore.setState({
      isInitializing: false,
    } as unknown as Record<string, unknown>);

    render(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("Running")).toBeInTheDocument();
  });
});

describe("getDisplayStatus", () => {
  it("returns 'initializing' when running with zero items", () => {
    expect(getDisplayStatus("running", 0)).toBe("initializing");
  });

  it("returns 'initializing' when workflowIsInitializing is true", () => {
    expect(getDisplayStatus("running", 5, true)).toBe("initializing");
  });

  it("returns 'running' when running with items and not initializing", () => {
    expect(getDisplayStatus("running", 1)).toBe("running");
    expect(getDisplayStatus("running", 1, false)).toBe("running");
  });

  it("returns 'completed' regardless of items or initializing flag", () => {
    expect(getDisplayStatus("completed", 0)).toBe("completed");
    expect(getDisplayStatus("completed", 0, true)).toBe("completed");
    expect(getDisplayStatus("completed", 5, false)).toBe("completed");
  });

  it("returns 'error' regardless of items or initializing flag", () => {
    expect(getDisplayStatus("error", 0)).toBe("error");
    expect(getDisplayStatus("error", 0, true)).toBe("error");
    expect(getDisplayStatus("error", 5, false)).toBe("error");
  });

  it("returns 'running' when workflowIsInitializing is undefined and items exist", () => {
    expect(getDisplayStatus("running", 3, undefined)).toBe("running");
  });
});

describe("formatElapsed", () => {
  it("formats seconds only", () => {
    expect(formatElapsed(5000)).toBe("5s");
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(59000)).toBe("59s");
  });

  it("formats minutes and seconds", () => {
    expect(formatElapsed(60000)).toBe("1m 0s");
    expect(formatElapsed(90000)).toBe("1m 30s");
    expect(formatElapsed(125000)).toBe("2m 5s");
  });
});

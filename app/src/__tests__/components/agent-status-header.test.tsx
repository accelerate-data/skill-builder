import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  AgentStatusHeader,
  getDisplayStatus,
  formatElapsed,
} from "@/components/agent-status-header";

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

    // No messages yet, so it should show "Initializing..." instead of "Running"
    expect(screen.getByText("Initializing\u2026")).toBeInTheDocument();
    expect(screen.getByText("Sonnet")).toBeInTheDocument();
  });

  it("shows Initializing badge with spinner when run has no messages", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    render(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("Initializing\u2026")).toBeInTheDocument();
    // Should NOT show "Running" when no messages have arrived
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });

  it("transitions from Initializing to Running when first message arrives", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    const { rerender } = render(<AgentStatusHeader agentId="test-agent" />);

    // Initially shows Initializing
    expect(screen.getByText("Initializing\u2026")).toBeInTheDocument();

    // Add a message (simulating first agent output)
    useAgentStore.getState().addMessage("test-agent", {
      type: "assistant",
      content: "Hello",
      raw: { type: "assistant", message: {} },
      timestamp: Date.now(),
    });

    rerender(<AgentStatusHeader agentId="test-agent" />);

    // Now should show Running
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.queryByText("Initializing\u2026")).not.toBeInTheDocument();
  });

  it("transitions from Running to Completed when run completes", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", {
      type: "assistant",
      content: "Working...",
      raw: { type: "assistant", message: {} },
      timestamp: Date.now(),
    });
    const { rerender } = render(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("Running")).toBeInTheDocument();

    useAgentStore.getState().completeRun("test-agent", true);
    rerender(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });

  it("transitions from Running to Error when run fails", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", {
      type: "assistant",
      content: "Working...",
      raw: { type: "assistant", message: {} },
      timestamp: Date.now(),
    });
    const { rerender } = render(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("Running")).toBeInTheDocument();

    useAgentStore.getState().completeRun("test-agent", false);
    rerender(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("shows elapsed time during initialization phase", () => {
    // Start run with a known past startTime
    useAgentStore.getState().startRun("test-agent", "sonnet");
    render(<AgentStatusHeader agentId="test-agent" />);

    // Should show a time badge even during initialization (0s is acceptable)
    const timeBadge = screen.getByText(/\d+s/);
    expect(timeBadge).toBeInTheDocument();
  });

  it("shows Thinking badge when config has maxThinkingTokens", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", {
      type: "config",
      raw: { type: "config", config: { maxThinkingTokens: 32000 } },
      timestamp: Date.now(),
    });
    render(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });

  it("does NOT show Thinking badge when config has no maxThinkingTokens", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", {
      type: "config",
      raw: { type: "config", config: {} },
      timestamp: Date.now(),
    });
    render(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
  });

  it("shows cost badge when totalCost is available", () => {
    useAgentStore.getState().startRun("test-agent", "opus");
    useAgentStore.getState().addMessage("test-agent", {
      type: "result",
      content: "Done",
      raw: {
        usage: { input_tokens: 1500, output_tokens: 500 },
        total_cost_usd: 0.042,
      },
      timestamp: Date.now(),
    });
    render(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("$0.0420")).toBeInTheDocument();
    expect(screen.getByText("2,000 tokens")).toBeInTheDocument();
  });

  it("shows Initializing when workflow store isInitializing is true even with messages", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    // Add a non-assistant message (e.g. config) - messages array is non-empty
    useAgentStore.getState().addMessage("test-agent", {
      type: "config",
      raw: { type: "config", config: {} },
      timestamp: Date.now(),
    });

    // Simulate workflow store having isInitializing set by Stream 1
    useWorkflowStore.setState({
      isInitializing: true,
      initStartTime: Date.now() - 5000,
    } as unknown as Record<string, unknown>);

    render(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("Initializing\u2026")).toBeInTheDocument();
  });

  it("shows Running when workflow store isInitializing is false and messages exist", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", {
      type: "assistant",
      content: "Working",
      raw: { type: "assistant", message: {} },
      timestamp: Date.now(),
    });

    useWorkflowStore.setState({
      isInitializing: false,
    } as unknown as Record<string, unknown>);

    render(<AgentStatusHeader agentId="test-agent" />);

    expect(screen.getByText("Running")).toBeInTheDocument();
  });
});

describe("getDisplayStatus", () => {
  it("returns 'initializing' when running with zero messages", () => {
    expect(getDisplayStatus("running", 0)).toBe("initializing");
  });

  it("returns 'initializing' when workflowIsInitializing is true", () => {
    expect(getDisplayStatus("running", 5, true)).toBe("initializing");
  });

  it("returns 'running' when running with messages and not initializing", () => {
    expect(getDisplayStatus("running", 1)).toBe("running");
    expect(getDisplayStatus("running", 1, false)).toBe("running");
  });

  it("returns 'completed' regardless of messages or initializing flag", () => {
    expect(getDisplayStatus("completed", 0)).toBe("completed");
    expect(getDisplayStatus("completed", 0, true)).toBe("completed");
    expect(getDisplayStatus("completed", 5, false)).toBe("completed");
  });

  it("returns 'error' regardless of messages or initializing flag", () => {
    expect(getDisplayStatus("error", 0)).toBe("error");
    expect(getDisplayStatus("error", 0, true)).toBe("error");
    expect(getDisplayStatus("error", 5, false)).toBe("error");
  });

  it("returns 'running' when workflowIsInitializing is undefined and messages exist", () => {
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

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { AgentInitializingIndicator } from "@/components/agent-initializing-indicator";

describe("AgentInitializingIndicator", () => {
  beforeEach(() => {
    useWorkflowStore.getState().reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders spinner and default spawning text", () => {
    useWorkflowStore.getState().setInitializing();
    render(<AgentInitializingIndicator />);

    expect(screen.getByTestId("agent-initializing-indicator")).toBeInTheDocument();
    expect(screen.getByText("Spawning agent process...")).toBeInTheDocument();
  });

  it("shows fallback text when initProgressMessage is null", () => {
    useWorkflowStore.setState({
      isInitializing: true,
      initStartTime: Date.now(),
      initProgressMessage: null,
    });
    render(<AgentInitializingIndicator />);

    expect(screen.getByText("Initializing agent...")).toBeInTheDocument();
  });

  it("shows elapsed time when initStartTime is set", () => {
    // Set a start time 5 seconds ago
    vi.setSystemTime(new Date("2025-01-01T00:00:05.000Z"));
    useWorkflowStore.setState({
      isInitializing: true,
      initStartTime: new Date("2025-01-01T00:00:00.000Z").getTime(),
    });

    render(<AgentInitializingIndicator />);

    expect(screen.getByTestId("elapsed-time")).toBeInTheDocument();
    expect(screen.getByTestId("elapsed-time").textContent).toBe("5s");
  });

  it("updates elapsed time every second", () => {
    const startTime = Date.now();
    useWorkflowStore.setState({
      isInitializing: true,
      initStartTime: startTime,
    });

    render(<AgentInitializingIndicator />);

    // Advance 3 seconds
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    const elapsedEl = screen.getByTestId("elapsed-time");
    expect(elapsedEl).toBeInTheDocument();
    expect(elapsedEl.textContent).toBe("3s");
  });

  it("formats minutes and seconds for longer durations", () => {
    // Set a start time 65 seconds ago
    vi.setSystemTime(new Date("2025-01-01T00:01:05.000Z"));
    useWorkflowStore.setState({
      isInitializing: true,
      initStartTime: new Date("2025-01-01T00:00:00.000Z").getTime(),
    });

    render(<AgentInitializingIndicator />);

    expect(screen.getByTestId("elapsed-time").textContent).toBe("1m 5s");
  });

  it("does not show elapsed time when initStartTime is null", () => {
    useWorkflowStore.setState({
      isInitializing: true,
      initStartTime: null,
    });

    render(<AgentInitializingIndicator />);

    expect(screen.queryByTestId("elapsed-time")).not.toBeInTheDocument();
  });

  it("has the loading spinner", () => {
    useWorkflowStore.getState().setInitializing();
    const { container } = render(<AgentInitializingIndicator />);

    // Loader2 renders as SVG with animate-spin class
    const svg = container.querySelector("svg.animate-spin");
    expect(svg).toBeInTheDocument();
  });

  it("shows 'Loading SDK modules...' progress message", () => {
    useWorkflowStore.setState({
      isInitializing: true,
      initStartTime: Date.now(),
      initProgressMessage: "Loading SDK modules...",
    });
    render(<AgentInitializingIndicator />);

    expect(screen.getByTestId("init-progress-message").textContent).toBe(
      "Loading SDK modules...",
    );
  });

  it("shows 'Connecting to API...' progress message", () => {
    useWorkflowStore.setState({
      isInitializing: true,
      initStartTime: Date.now(),
      initProgressMessage: "Connecting to API...",
    });
    render(<AgentInitializingIndicator />);

    expect(screen.getByTestId("init-progress-message").textContent).toBe(
      "Connecting to API...",
    );
  });

  it("updates message reactively when store changes", () => {
    useWorkflowStore.getState().setInitializing();
    render(<AgentInitializingIndicator />);

    expect(screen.getByTestId("init-progress-message").textContent).toBe(
      "Spawning agent process...",
    );

    // Simulate init_start event updating the store
    act(() => {
      useWorkflowStore.getState().setInitProgressMessage("Loading SDK modules...");
    });

    expect(screen.getByTestId("init-progress-message").textContent).toBe(
      "Loading SDK modules...",
    );

    // Simulate sdk_ready event
    act(() => {
      useWorkflowStore.getState().setInitProgressMessage("Connecting to API...");
    });

    expect(screen.getByTestId("init-progress-message").textContent).toBe(
      "Connecting to API...",
    );
  });
});

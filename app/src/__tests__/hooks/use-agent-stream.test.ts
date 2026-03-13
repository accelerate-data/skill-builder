import { describe, it, expect, vi, beforeEach } from "vitest";
import { initAgentStream, _resetForTesting } from "@/hooks/use-agent-stream";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { mockListen } from "@/test/mocks/tauri";

type ListenCallback = (event: { payload: unknown }) => void;

describe("initAgentStream", () => {
  let listeners: Record<string, ListenCallback>;

  beforeEach(async () => {
    useAgentStore.getState().clearRuns();
    useWorkflowStore.getState().reset();
    await _resetForTesting();
    listeners = {};

    mockListen.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockListen as any).mockImplementation((event: string, callback: ListenCallback) => {
      listeners[event] = callback;
      return Promise.resolve(vi.fn());
    });
  });

  it("subscribes to display and discrete agent event channels", () => {
    initAgentStream();

    expect(mockListen).toHaveBeenCalledWith("agent-init-progress", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("agent-init-error", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("agent-run-config", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("agent-run-init", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("agent-turn-usage", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("agent-compaction", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("agent-context-window", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("agent-session-exhausted", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("agent-message", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("agent-exit", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("agent-shutdown", expect.any(Function));
  });

  it("adds display_item message to agent store", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    initAgentStream();

    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "display_item",
          item: {
            id: "di-1",
            type: "output",
            timestamp: Date.now(),
            outputText: "Hello world",
          },
        },
      },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.displayItems).toHaveLength(1);
    expect(run.displayItems[0].outputText).toBe("Hello world");
  });

  it("updates run init via agent-run-init event", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    initAgentStream();

    listeners["agent-run-init"]({
      payload: {
        agent_id: "agent-1",
        type: "run_init",
        sessionId: "sess-123",
        model: "claude-sonnet-4-5-20250929",
        timestamp: Date.now(),
      },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.model).toBe("claude-sonnet-4-5-20250929");
    expect(run.sessionId).toBe("sess-123");
  });

  it("applies the full typed agent event lifecycle to a run", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    initAgentStream();

    listeners["agent-run-config"]({
      payload: {
        agent_id: "agent-1",
        type: "run_config",
        thinkingEnabled: true,
        agentName: "researcher",
        timestamp: Date.now(),
      },
    });

    listeners["agent-run-init"]({
      payload: {
        agent_id: "agent-1",
        type: "run_init",
        sessionId: "sess-123",
        model: "claude-sonnet-4-5-20250929",
        timestamp: Date.now(),
      },
    });

    listeners["agent-turn-usage"]({
      payload: {
        agent_id: "agent-1",
        type: "turn_usage",
        turn: 1,
        inputTokens: 1200,
        outputTokens: 130,
        timestamp: Date.now(),
      },
    });

    listeners["agent-compaction"]({
      payload: {
        agent_id: "agent-1",
        type: "compaction",
        turn: 2,
        preTokens: 8000,
        timestamp: 123456,
      },
    });

    listeners["agent-context-window"]({
      payload: {
        agent_id: "agent-1",
        type: "context_window",
        contextWindow: 200000,
        timestamp: Date.now(),
      },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.thinkingEnabled).toBe(true);
    expect(run.agentName).toBe("researcher");
    expect(run.model).toBe("claude-sonnet-4-5-20250929");
    expect(run.sessionId).toBe("sess-123");
    expect(run.contextHistory).toEqual([
      {
        turn: 1,
        inputTokens: 1200,
        outputTokens: 130,
      },
    ]);
    expect(run.compactionEvents).toEqual([
      {
        turn: 2,
        preTokens: 8000,
        timestamp: 123456,
      },
    ]);
    expect(run.contextWindow).toBe(200000);
  });

  it("replays queued typed agent events when they arrive before run registration", () => {
    initAgentStream();

    listeners["agent-run-config"]({
      payload: {
        agent_id: "late-agent",
        type: "run_config",
        thinkingEnabled: true,
        agentName: "late-runner",
        timestamp: Date.now(),
      },
    });
    listeners["agent-run-init"]({
      payload: {
        agent_id: "late-agent",
        type: "run_init",
        sessionId: "sess-late",
        model: "claude-opus-4-1",
        timestamp: Date.now(),
      },
    });
    listeners["agent-turn-usage"]({
      payload: {
        agent_id: "late-agent",
        type: "turn_usage",
        turn: 4,
        inputTokens: 2400,
        outputTokens: 210,
        timestamp: Date.now(),
      },
    });
    listeners["agent-compaction"]({
      payload: {
        agent_id: "late-agent",
        type: "compaction",
        turn: 5,
        preTokens: 10000,
        timestamp: 999,
      },
    });
    listeners["agent-context-window"]({
      payload: {
        agent_id: "late-agent",
        type: "context_window",
        contextWindow: 200000,
        timestamp: Date.now(),
      },
    });

    useAgentStore.getState().startRun("late-agent", "sonnet");

    const run = useAgentStore.getState().runs["late-agent"];
    expect(run.thinkingEnabled).toBe(true);
    expect(run.agentName).toBe("late-runner");
    expect(run.model).toBe("claude-opus-4-1");
    expect(run.sessionId).toBe("sess-late");
    expect(run.contextHistory).toEqual([
      {
        turn: 4,
        inputTokens: 2400,
        outputTokens: 210,
      },
    ]);
    expect(run.compactionEvents).toEqual([
      {
        turn: 5,
        preTokens: 10000,
        timestamp: 999,
      },
    ]);
    expect(run.contextWindow).toBe(200000);
  });

  it("completes run on agent-exit with success=true", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    initAgentStream();

    listeners["agent-exit"]({
      payload: { agent_id: "agent-1", success: true },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("completed");
    expect(run.endTime).toBeDefined();
  });

  it("sets error status on agent-exit with success=false", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    initAgentStream();

    listeners["agent-exit"]({
      payload: { agent_id: "agent-1", success: false },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("error");
  });

  it("only registers listeners once for multiple init calls", () => {
    initAgentStream();
    initAgentStream();

    expect(mockListen).toHaveBeenCalledTimes(12);
  });

  it("auto-creates run for display_item messages arriving before startRun", () => {
    initAgentStream();

    listeners["agent-message"]({
      payload: {
        agent_id: "unknown-agent",
        message: {
          type: "display_item",
          item: {
            id: "di-early",
            type: "output",
            timestamp: Date.now(),
            outputText: "Early message",
          },
        },
      },
    });

    const run = useAgentStore.getState().runs["unknown-agent"];
    expect(run).toBeDefined();
    expect(run.displayItems).toHaveLength(1);
    expect(run.displayItems[0].outputText).toBe("Early message");
  });

  it("startRun preserves displayItems from auto-created run", () => {
    initAgentStream();

    // Display item arrives before startRun
    listeners["agent-message"]({
      payload: {
        agent_id: "early-agent",
        message: {
          type: "display_item",
          item: {
            id: "di-early",
            type: "output",
            timestamp: Date.now(),
            outputText: "I started early",
          },
        },
      },
    });

    // Now startRun is called (e.g. by workflow page)
    useAgentStore.getState().startRun("early-agent", "sonnet");

    const run = useAgentStore.getState().runs["early-agent"];
    expect(run.model).toBe("sonnet");
    expect(run.displayItems).toHaveLength(1);
    expect(run.displayItems[0].outputText).toBe("I started early");
  });

  it("clears initializing state on first agent message", () => {
    useWorkflowStore.getState().setInitializing();
    expect(useWorkflowStore.getState().isInitializing).toBe(true);

    useAgentStore.getState().startRun("agent-1", "sonnet");
    initAgentStream();

    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "display_item",
          item: {
            id: "di-1",
            type: "output",
            timestamp: Date.now(),
            outputText: "First message",
          },
        },
      },
    });

    // After first message, initializing should be cleared
    expect(useWorkflowStore.getState().isInitializing).toBe(false);
    expect(useWorkflowStore.getState().initStartTime).toBeNull();
  });

  it("does not error when clearing initializing on subsequent messages", () => {
    useWorkflowStore.getState().setInitializing();
    useAgentStore.getState().startRun("agent-1", "sonnet");
    initAgentStream();

    // First message clears initializing
    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "display_item",
          item: { id: "di-1", type: "output", timestamp: Date.now(), outputText: "First" },
        },
      },
    });

    expect(useWorkflowStore.getState().isInitializing).toBe(false);

    // Second message — should not error, already cleared
    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "display_item",
          item: { id: "di-2", type: "output", timestamp: Date.now(), outputText: "Second" },
        },
      },
    });

    expect(useWorkflowStore.getState().isInitializing).toBe(false);
    expect(useAgentStore.getState().runs["agent-1"].displayItems).toHaveLength(2);
  });

  it("does not clear initializing when it was not set", () => {
    // isInitializing starts as false
    expect(useWorkflowStore.getState().isInitializing).toBe(false);

    useAgentStore.getState().startRun("agent-1", "sonnet");
    initAgentStream();

    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "display_item",
          item: { id: "di-1", type: "output", timestamp: Date.now(), outputText: "Hello" },
        },
      },
    });

    // Should still be false (no-op)
    expect(useWorkflowStore.getState().isInitializing).toBe(false);
    expect(useWorkflowStore.getState().initStartTime).toBeNull();
  });

  it("updates progress message on init_start event", () => {
    useWorkflowStore.getState().setInitializing();
    initAgentStream();

    listeners["agent-init-progress"]({
      payload: {
        agent_id: "agent-1",
        type: "init_progress",
        stage: "init_start",
        timestamp: Date.now(),
      },
    });

    expect(useWorkflowStore.getState().initProgressMessage).toBe(
      "Loading SDK modules...",
    );
  });

  it("updates progress message on sdk_ready event", () => {
    useWorkflowStore.getState().setInitializing();
    initAgentStream();

    listeners["agent-init-progress"]({
      payload: {
        agent_id: "agent-1",
        type: "init_progress",
        stage: "sdk_ready",
        timestamp: Date.now(),
      },
    });

    expect(useWorkflowStore.getState().initProgressMessage).toBe(
      "Connecting to API...",
    );
  });

  it("does not update progress message when not initializing", () => {
    // isInitializing is false by default
    initAgentStream();

    listeners["agent-init-progress"]({
      payload: {
        agent_id: "agent-1",
        type: "init_progress",
        stage: "init_start",
        timestamp: Date.now(),
      },
    });

    expect(useWorkflowStore.getState().initProgressMessage).toBeNull();
  });

  it("ignores unknown system event subtypes", () => {
    useWorkflowStore.getState().setInitializing();
    const initialMessage = useWorkflowStore.getState().initProgressMessage;
    initAgentStream();

    listeners["agent-init-progress"]({
      payload: {
        agent_id: "agent-1",
        type: "init_progress",
        stage: "unknown_subtype",
        timestamp: Date.now(),
      },
    });

    // Message should not have changed
    expect(useWorkflowStore.getState().initProgressMessage).toBe(initialMessage);
  });

  it("clears progress message when initializing is cleared", () => {
    useWorkflowStore.getState().setInitializing();
    initAgentStream();

    // Simulate init_start
    listeners["agent-init-progress"]({
      payload: {
        agent_id: "agent-1",
        type: "init_progress",
        stage: "init_start",
        timestamp: Date.now(),
      },
    });
    expect(useWorkflowStore.getState().initProgressMessage).toBe(
      "Loading SDK modules...",
    );

    // First agent message clears initializing
    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "display_item",
          item: { id: "di-1", type: "output", timestamp: Date.now(), outputText: "Hello" },
        },
      },
    });

    expect(useWorkflowStore.getState().isInitializing).toBe(false);
    expect(useWorkflowStore.getState().initProgressMessage).toBeNull();
  });

  it("progresses through all init stages in order", () => {
    useWorkflowStore.getState().setInitializing();
    initAgentStream();

    // Initial state: "Spawning agent process..."
    expect(useWorkflowStore.getState().initProgressMessage).toBe(
      "Spawning agent process...",
    );

    // Stage 1: init_start
    listeners["agent-init-progress"]({
      payload: {
        agent_id: "agent-1",
        type: "init_progress",
        stage: "init_start",
        timestamp: Date.now(),
      },
    });
    expect(useWorkflowStore.getState().initProgressMessage).toBe(
      "Loading SDK modules...",
    );

    // Stage 2: sdk_ready
    listeners["agent-init-progress"]({
      payload: {
        agent_id: "agent-1",
        type: "init_progress",
        stage: "sdk_ready",
        timestamp: Date.now(),
      },
    });
    expect(useWorkflowStore.getState().initProgressMessage).toBe(
      "Connecting to API...",
    );

    // Stage 3: first message clears initializing
    useAgentStore.getState().startRun("agent-1", "sonnet");
    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "display_item",
          item: { id: "di-1", type: "output", timestamp: Date.now(), outputText: "Processing..." },
        },
      },
    });
    expect(useWorkflowStore.getState().isInitializing).toBe(false);
    expect(useWorkflowStore.getState().initProgressMessage).toBeNull();
  });

  it("imports toast from @/lib/toast, not directly from sonner", async () => {
    // Read the source file and verify the import uses the app wrapper
    const source = await import.meta.glob("/src/hooks/use-agent-stream.ts", { as: "raw", eager: true });
    const content = Object.values(source)[0] as string;
    expect(content).toContain('from "@/lib/toast"');
    expect(content).not.toMatch(/from ["']sonner["']/);
  });

  it("calls shutdownRun on agent-shutdown event", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    initAgentStream();

    listeners["agent-shutdown"]({
      payload: { agent_id: "agent-1" },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("shutdown");
    expect(run.endTime).toBeDefined();
  });

  it("agent-shutdown is a no-op for non-running agents", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    useAgentStore.getState().completeRun("agent-1", true);
    initAgentStream();

    listeners["agent-shutdown"]({
      payload: { agent_id: "agent-1" },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("completed"); // unchanged
  });

  it("_resetForTesting calls each unlisten function", async () => {
    const unlisten = vi.fn().mockResolvedValue(undefined);
    mockListen.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockListen as any).mockResolvedValue(unlisten);

    initAgentStream();
    // Allow the listen() promises to resolve
    await Promise.resolve();

    await _resetForTesting();
    expect(unlisten).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { initAgentStream, _resetForTesting } from "@/hooks/use-agent-stream";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { mockListen } from "@/test/mocks/tauri";

type ListenCallback = (event: { payload: unknown }) => void;

describe("initAgentStream", () => {
  let listeners: Record<string, ListenCallback>;

  beforeEach(() => {
    useAgentStore.getState().clearRuns();
    useWorkflowStore.getState().reset();
    _resetForTesting();
    listeners = {};

    mockListen.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockListen as any).mockImplementation((event: string, callback: ListenCallback) => {
      listeners[event] = callback;
      return Promise.resolve(vi.fn());
    });
  });

  it("subscribes to agent-message, agent-exit, and agent-init-progress events", () => {
    initAgentStream();

    expect(mockListen).toHaveBeenCalledWith("agent-init-progress", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("agent-message", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("agent-exit", expect.any(Function));
  });

  it("adds assistant message content to agent store", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    initAgentStream();

    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Hello " },
              { type: "text", text: "world" },
            ],
          },
        },
      },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.messages).toHaveLength(1);
    expect(run.messages[0].type).toBe("assistant");
    expect(run.messages[0].content).toBe("Hello world");
  });

  it("adds result message content to agent store", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    initAgentStream();

    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "result",
          result: "Task completed successfully",
        },
      },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.messages).toHaveLength(1);
    expect(run.messages[0].type).toBe("result");
    expect(run.messages[0].content).toBe("Task completed successfully");
  });

  it("adds error message content to agent store", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    initAgentStream();

    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "error",
          error: "Rate limited",
        },
      },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.messages[0].type).toBe("error");
    expect(run.messages[0].content).toBe("Rate limited");
  });

  it("handles error message with no error string", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    initAgentStream();

    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "error",
        },
      },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.messages[0].content).toBe("Unknown error");
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

    // listen should only be called 4 times (agent-init-progress, agent-message, agent-exit, agent-init-error)
    expect(mockListen).toHaveBeenCalledTimes(4);
  });

  it("auto-creates run for messages arriving before startRun", () => {
    initAgentStream();

    // Send a message for an agent that hasn't been registered via startRun
    listeners["agent-message"]({
      payload: {
        agent_id: "unknown-agent",
        message: {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Early message" }],
          },
        },
      },
    });

    const run = useAgentStore.getState().runs["unknown-agent"];
    expect(run).toBeDefined();
    expect(run.messages).toHaveLength(1);
    expect(run.messages[0].content).toBe("Early message");
  });

  it("startRun preserves messages from auto-created run", () => {
    initAgentStream();

    // Message arrives before startRun
    listeners["agent-message"]({
      payload: {
        agent_id: "early-agent",
        message: {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "I started early" }],
          },
        },
      },
    });

    // Now startRun is called (e.g. by workflow page)
    useAgentStore.getState().startRun("early-agent", "sonnet");

    const run = useAgentStore.getState().runs["early-agent"];
    expect(run.model).toBe("sonnet");
    expect(run.messages).toHaveLength(1);
    expect(run.messages[0].content).toBe("I started early");
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
          type: "assistant",
          message: {
            content: [{ type: "text", text: "First message" }],
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
          type: "assistant",
          message: {
            content: [{ type: "text", text: "First" }],
          },
        },
      },
    });

    expect(useWorkflowStore.getState().isInitializing).toBe(false);

    // Second message — should not error, already cleared
    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Second" }],
          },
        },
      },
    });

    expect(useWorkflowStore.getState().isInitializing).toBe(false);
    expect(useAgentStore.getState().runs["agent-1"].messages).toHaveLength(2);
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
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Hello" }],
          },
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
        subtype: "init_start",
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
        subtype: "sdk_ready",
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
        subtype: "init_start",
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
        subtype: "unknown_subtype",
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
        subtype: "init_start",
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
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Hello" }],
          },
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
        subtype: "init_start",
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
        subtype: "sdk_ready",
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
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Processing..." }],
          },
        },
      },
    });
    expect(useWorkflowStore.getState().isInitializing).toBe(false);
    expect(useWorkflowStore.getState().initProgressMessage).toBeNull();
  });
});

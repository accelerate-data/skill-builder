import { describe, it, expect, vi, beforeEach } from "vitest";
import { initAgentStream, _resetForTesting } from "@/hooks/use-agent-stream";
import { useAgentStore } from "@/stores/agent-store";
import { mockListen } from "@/test/mocks/tauri";

type ListenCallback = (event: { payload: unknown }) => void;

describe("initAgentStream", () => {
  let listeners: Record<string, ListenCallback>;

  beforeEach(() => {
    useAgentStore.getState().clearRuns();
    _resetForTesting();
    listeners = {};

    mockListen.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockListen as any).mockImplementation((event: string, callback: ListenCallback) => {
      listeners[event] = callback;
      return Promise.resolve(vi.fn());
    });
  });

  it("subscribes to agent-message and agent-exit events", () => {
    initAgentStream();

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

  it("routes cancelled=true exit to cancelRun", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    initAgentStream();

    listeners["agent-exit"]({
      payload: { agent_id: "agent-1", success: false, cancelled: true },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("cancelled");
    expect(run.endTime).toBeDefined();
  });

  it("only registers listeners once for multiple init calls", () => {
    initAgentStream();
    initAgentStream();

    // listen should only be called twice (once for agent-message, once for agent-exit)
    expect(mockListen).toHaveBeenCalledTimes(2);
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
});

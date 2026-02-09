import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentStream, _resetForTesting } from "@/hooks/use-agent-stream";
import { useAgentStore } from "@/stores/agent-store";
import { mockListen } from "@/test/mocks/tauri";

type ListenCallback = (event: { payload: unknown }) => void;

describe("useAgentStream", () => {
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
    renderHook(() => useAgentStream());

    expect(mockListen).toHaveBeenCalledWith("agent-message", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("agent-exit", expect.any(Function));
  });

  it("adds assistant message content to agent store", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    renderHook(() => useAgentStream());

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
    renderHook(() => useAgentStream());

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
    renderHook(() => useAgentStream());

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
    renderHook(() => useAgentStream());

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
    renderHook(() => useAgentStream());

    listeners["agent-exit"]({
      payload: { agent_id: "agent-1", success: true },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("completed");
    expect(run.endTime).toBeDefined();
  });

  it("sets error status on agent-exit with success=false", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    renderHook(() => useAgentStream());

    listeners["agent-exit"]({
      payload: { agent_id: "agent-1", success: false },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("error");
  });

  it("only registers one set of listeners for multiple hook instances", () => {
    renderHook(() => useAgentStream());
    renderHook(() => useAgentStream());

    // listen should only be called twice (once for agent-message, once for agent-exit)
    expect(mockListen).toHaveBeenCalledTimes(2);
  });

  it("cleans up listeners when all hooks unmount", () => {
    const unlistenA = vi.fn();
    const unlistenB = vi.fn();
    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockListen as any).mockImplementation((_event: string, callback: ListenCallback) => {
      listeners[_event] = callback;
      callCount++;
      return Promise.resolve(callCount === 1 ? unlistenA : unlistenB);
    });

    const hook1 = renderHook(() => useAgentStream());
    const hook2 = renderHook(() => useAgentStream());

    // Unmounting one hook should not unsubscribe
    hook1.unmount();
    expect(mockListen).toHaveBeenCalledTimes(2);

    // Unmounting the last hook triggers cleanup
    hook2.unmount();
    expect(mockListen).toHaveBeenCalledTimes(2);
  });
});

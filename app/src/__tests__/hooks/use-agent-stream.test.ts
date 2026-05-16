import { describe, it, expect, vi, beforeEach } from "vitest";
import { initAgentStream, _resetForTesting } from "@/hooks/use-agent-stream";
import { useAgentStore, flushDisplayItems } from "@/stores/agent-store";
import { useRefineStore } from "@/stores/refine-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { mockListen } from "@/test/mocks/tauri";

vi.mock("@/lib/queries/agent-stream-cache", () => ({
  invalidateUsageDataAfterAgentRun: vi.fn().mockResolvedValue(undefined),
  invalidateSkillDataAfterWorkflow: vi.fn().mockResolvedValue(undefined),
}));

type ListenCallback = (event: { payload: unknown }) => void;

describe("initAgentStream", () => {
  let listeners: Record<string, ListenCallback>;

  beforeEach(async () => {
    useAgentStore.getState().clearRuns();
    useRefineStore.setState({
      messages: [],
      activeAgentId: null,
      pendingFollowupMessage: null,
      sessionId: null,
      sessionExhausted: false,
    });
    useWorkflowStore.getState().reset();
    await _resetForTesting();
    listeners = {};

    mockListen.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockListen as any).mockImplementation(
      (event: string, callback: ListenCallback) => {
        listeners[event] = callback;
        return Promise.resolve(vi.fn());
      },
    );
  });

  it("subscribes to display and discrete agent event channels", async () => {
    await initAgentStream();

    expect(mockListen).toHaveBeenCalledWith(
      "agent-init-progress",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith(
      "agent-init-error",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith(
      "agent-run-config",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith(
      "agent-run-init",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith(
      "agent-turn-usage",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith(
      "agent-compaction",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith(
      "agent-context-window",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith(
      "agent-session-exhausted",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith(
      "agent-message",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith("agent-exit", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith(
      "agent-shutdown",
      expect.any(Function),
    );
  });

  it("retries initialization after an early listen failure", async () => {
    let attempts = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockListen as any).mockImplementation(
      (event: string, callback: ListenCallback) => {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(new Error("bridge not ready"));
        }
        listeners[event] = callback;
        return Promise.resolve(vi.fn());
      },
    );

    await expect(initAgentStream()).rejects.toThrow("bridge not ready");
    await expect(initAgentStream()).resolves.toBeUndefined();

    expect(listeners["agent-message"]).toBeTypeOf("function");
    expect(mockListen).toHaveBeenCalledWith("agent-message", expect.any(Function));
  });

  it("adds display_item message to agent store", async () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    await initAgentStream();

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
    flushDisplayItems();

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.displayItems).toHaveLength(1);
    expect(run.displayItems[0].outputText).toBe("Hello world");
  });

  it("adds OpenHands conversation_event messages and projects them to display items", async () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    await initAgentStream();

    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "conversation_event",
          runtime: "openhands",
          conversation_id: "conv-1",
          event_class: "MessageEvent",
          timestamp: 1234,
          event: {
            source: "assistant",
            message: "Scope looks focused.",
          },
        },
      },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    // Projection turns an agent MessageEvent into an output DisplayItem.
    expect(run.displayItems).toHaveLength(1);
    expect(run.displayItems[0]).toMatchObject({
      type: "output",
      outputText: "Scope looks focused.",
    });
    expect(run.conversationEvents).toHaveLength(1);
    expect(run.conversationEvents[0]).toMatchObject({
      type: "conversation_event",
      runtime: "openhands",
      conversationId: "conv-1",
      eventClass: "MessageEvent",
      timestamp: 1234,
      event: {
        source: "assistant",
        message: "Scope looks focused.",
      },
    });
  });

  it("projects persisted OpenHands assistant MessageEvent payloads from llm_message content", async () => {
    await initAgentStream();

    listeners["agent-message"]({
      payload: {
        agent_id: "refine-live-agent",
        message: {
          type: "conversation_event",
          runtime: "openhands",
          conversation_id: "conv-refine-live",
          event_class: "MessageEvent",
          timestamp: 1729,
          event: {
            kind: "MessageEvent",
            source: "agent",
            llm_message: {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "Based on the conversation history, here are the key decisions.",
                },
              ],
              thinking_blocks: [],
            },
          },
        },
      },
    });

    useAgentStore
      .getState()
      .registerRun("refine-live-agent", "sonnet", "my-skill", "refine");

    const run = useAgentStore.getState().runs["refine-live-agent"];
    expect(run.conversationEvents).toHaveLength(1);
    expect(run.displayItems).toHaveLength(1);
    expect(run.displayItems[0]).toMatchObject({
      type: "output",
      outputText:
        "Based on the conversation history, here are the key decisions.",
    });
  });

  it("updates OpenHands run status from terminal conversation_state messages", async () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    await initAgentStream();

    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "conversation_state",
          runtime: "openhands",
          conversation_id: "conv-1",
          status: "running",
          timestamp: 1234,
        },
      },
    });

    expect(useAgentStore.getState().runs["agent-1"].status).toBe("running");

    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "conversation_state",
          runtime: "openhands",
          conversation_id: "conv-1",
          status: "completed",
          timestamp: 1235,
        },
      },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("completed");
    expect(run.endTime).toBeDefined();
    expect(run.conversationState).toMatchObject({
      type: "conversation_state",
      runtime: "openhands",
      conversationId: "conv-1",
      status: "completed",
      timestamp: 1235,
    });
  });

  it("advances refine turn state on agent-turn-complete", async () => {
    useAgentStore.getState().registerRun("agent-1", "sonnet", "my-skill", "refine");
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        "agent-1": {
          ...state.runs["agent-1"],
          displayItems: [
            { id: "d1", type: "tool_call", timestamp: 1, toolName: "task_sent", toolSummary: "Task sent" },
            { id: "d2", type: "output", timestamp: 2, outputText: "reply" },
            { id: "d3", type: "tool_call", timestamp: 3, toolName: "task_sent", toolSummary: "Task sent" },
            { id: "d4", type: "output", timestamp: 4, outputText: "reply 2" },
          ],
        },
      },
    }));
    useRefineStore.setState({
      activeAgentId: "agent-1",
      isRunning: true,
      turns: [
        {
          turnId: "turn-1",
          conversationId: "conv-1",
          agentId: "agent-1",
          userMessageId: "m1",
          displayItemStartIndex: 0,
          displayItemEndIndex: null,
          status: "running",
          acceptedAt: 1,
        },
        {
          turnId: "turn-2",
          conversationId: "conv-1",
          agentId: "agent-1",
          userMessageId: "m2",
          displayItemStartIndex: 2,
          displayItemEndIndex: null,
          status: "accepted",
          acceptedAt: 2,
        },
      ],
    });

    await initAgentStream();

    listeners["agent-turn-complete"]({
      payload: { agent_id: "agent-1" },
    });

    const refine = useRefineStore.getState();
    expect(refine.turns[0]).toMatchObject({
      status: "completed",
      displayItemEndIndex: 4,
    });
    expect(refine.turns[1]).toMatchObject({
      status: "running",
    });
    expect(refine.isRunning).toBe(true);
  });

  it("auto-creates runs for OpenHands conversation events arriving before startRun", async () => {
    await initAgentStream();

    listeners["agent-message"]({
      payload: {
        agent_id: "early-openhands-agent",
        message: {
          type: "conversation_event",
          runtime: "openhands",
          conversation_id: "conv-early",
          event_class: "ActionEvent",
          event: {
            tool_name: "terminal",
            thought: "Checking repository state.",
          },
        },
      },
    });

    useAgentStore.getState().startRun("early-openhands-agent", "sonnet");

    const run = useAgentStore.getState().runs["early-openhands-agent"];
    expect(run.model).toBe("sonnet");
    expect(run.conversationEvents).toHaveLength(1);
    expect(run.conversationEvents[0].eventClass).toBe("ActionEvent");
  });

  it("adds refine question messages to the refine store", async () => {
    await initAgentStream();

    listeners["agent-message"]({
      payload: {
        agent_id: "agent-7",
        message: {
          type: "refine_question",
          tool_use_id: "toolu_123",
          questions: [
            {
              header: "Next Step",
              question: "Launch validate instead?",
              options: [
                { label: "Launch validate", description: "Run validation." },
                { label: "Clarify refine", description: "Stay in refine." },
              ],
            },
          ],
        },
      },
    });

    const question = useRefineStore.getState().messages[0];
    expect(question).toMatchObject({
      role: "question",
      agentId: "agent-7",
      toolUseId: "toolu_123",
      pending: true,
    });
    expect(question.questions).toHaveLength(1);
  });

  it("drops question messages for active workflow agents", async () => {
    useAgentStore.getState().setActiveAgent("workflow-agent");
    await initAgentStream();

    listeners["agent-message"]({
      payload: {
        agent_id: "workflow-agent",
        message: {
          type: "refine_question",
          tool_use_id: "toolu_workflow",
          questions: [
            {
              header: "Workflow Question",
              question: "This should not be shown",
              options: [{ label: "Continue", description: "Continue." }],
            },
          ],
        },
      },
    });

    // Workflow runs never surface AskUserQuestion-style prompts: the workflow store
    // no longer exposes pendingQuestion (deferred to a future ticket), and the
    // refine store stays untouched when the active agent is a workflow agent.
    expect(useRefineStore.getState().messages).toHaveLength(0);
  });

  it("updates run init via agent-run-init event", async () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    await initAgentStream();

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

  it("applies the full typed agent event lifecycle to a run", async () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    await initAgentStream();

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

  it("replays queued typed agent events when they arrive before run registration", async () => {
    await initAgentStream();

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

  it("completes run on agent-exit with success=true", async () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    await initAgentStream();

    listeners["agent-exit"]({
      payload: { agent_id: "agent-1", success: true },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("completed");
    expect(run.endTime).toBeDefined();
  });

  it("invalidates usage query data after agent exit", async () => {
    const { invalidateUsageDataAfterAgentRun } = await import("@/lib/queries/agent-stream-cache");
    useAgentStore.getState().startRun("agent-1", "sonnet");
    await initAgentStream();

    listeners["agent-exit"]({
      payload: { agent_id: "agent-1", success: true },
    });

    expect(invalidateUsageDataAfterAgentRun).toHaveBeenCalled();
  });

  it("sets error status on agent-exit with success=false", async () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    await initAgentStream();

    listeners["agent-exit"]({
      payload: { agent_id: "agent-1", success: false },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("error");
  });

  it("only registers listeners once for multiple init calls", async () => {
    await initAgentStream();
    await initAgentStream();

    expect(mockListen).toHaveBeenCalledTimes(13);
  });

  it("auto-creates run for display_item messages arriving before startRun", async () => {
    await initAgentStream();

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
    flushDisplayItems();

    const run = useAgentStore.getState().runs["unknown-agent"];
    expect(run).toBeDefined();
    expect(run.displayItems).toHaveLength(1);
    expect(run.displayItems[0].outputText).toBe("Early message");
  });

  it("startRun preserves displayItems from auto-created run", async () => {
    await initAgentStream();

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

    flushDisplayItems();
    // Now startRun is called (e.g. by workflow page)
    useAgentStore.getState().startRun("early-agent", "sonnet");

    const run = useAgentStore.getState().runs["early-agent"];
    expect(run.model).toBe("sonnet");
    expect(run.displayItems).toHaveLength(1);
    expect(run.displayItems[0].outputText).toBe("I started early");
  });

  it("clears initializing state on first agent message", async () => {
    useWorkflowStore.getState().setInitializing();
    expect(useWorkflowStore.getState().isInitializing).toBe(true);

    useAgentStore.getState().startRun("agent-1", "sonnet");
    await initAgentStream();

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

  it("does not error when clearing initializing on subsequent messages", async () => {
    useWorkflowStore.getState().setInitializing();
    useAgentStore.getState().startRun("agent-1", "sonnet");
    await initAgentStream();

    // First message clears initializing
    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "display_item",
          item: {
            id: "di-1",
            type: "output",
            timestamp: Date.now(),
            outputText: "First",
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
          type: "display_item",
          item: {
            id: "di-2",
            type: "output",
            timestamp: Date.now(),
            outputText: "Second",
          },
        },
      },
    });

    expect(useWorkflowStore.getState().isInitializing).toBe(false);
    flushDisplayItems();
    expect(useAgentStore.getState().runs["agent-1"].displayItems).toHaveLength(
      2,
    );
  });

  it("does not clear initializing when it was not set", async () => {
    // isInitializing starts as false
    expect(useWorkflowStore.getState().isInitializing).toBe(false);

    useAgentStore.getState().startRun("agent-1", "sonnet");
    await initAgentStream();

    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "display_item",
          item: {
            id: "di-1",
            type: "output",
            timestamp: Date.now(),
            outputText: "Hello",
          },
        },
      },
    });

    // Should still be false (no-op)
    expect(useWorkflowStore.getState().isInitializing).toBe(false);
    expect(useWorkflowStore.getState().initStartTime).toBeNull();
  });

  it("updates progress message on init_start event", async () => {
    useWorkflowStore.getState().setInitializing();
    await initAgentStream();

    listeners["agent-init-progress"]({
      payload: {
        agent_id: "agent-1",
        type: "init_progress",
        stage: "init_start",
        timestamp: Date.now(),
      },
    });

    expect(useWorkflowStore.getState().initProgressMessage).toBe(
      "Loading runtime modules...",
    );
  });

  it("updates progress message on runtime_ready event", async () => {
    useWorkflowStore.getState().setInitializing();
    await initAgentStream();

    listeners["agent-init-progress"]({
      payload: {
        agent_id: "agent-1",
        type: "init_progress",
        stage: "runtime_ready",
        timestamp: Date.now(),
      },
    });

    expect(useWorkflowStore.getState().initProgressMessage).toBe(
      "Connecting to API...",
    );
  });

  it("does not update progress message when not initializing", async () => {
    // isInitializing is false by default
    await initAgentStream();

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

  it("ignores unknown system event subtypes", async () => {
    useWorkflowStore.getState().setInitializing();
    const initialMessage = useWorkflowStore.getState().initProgressMessage;
    await initAgentStream();

    listeners["agent-init-progress"]({
      payload: {
        agent_id: "agent-1",
        type: "init_progress",
        stage: "unknown_subtype",
        timestamp: Date.now(),
      },
    });

    // Message should not have changed
    expect(useWorkflowStore.getState().initProgressMessage).toBe(
      initialMessage,
    );
  });

  it("clears progress message when initializing is cleared", async () => {
    useWorkflowStore.getState().setInitializing();
    await initAgentStream();

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
      "Loading runtime modules...",
    );

    // First agent message clears initializing
    listeners["agent-message"]({
      payload: {
        agent_id: "agent-1",
        message: {
          type: "display_item",
          item: {
            id: "di-1",
            type: "output",
            timestamp: Date.now(),
            outputText: "Hello",
          },
        },
      },
    });

    expect(useWorkflowStore.getState().isInitializing).toBe(false);
    expect(useWorkflowStore.getState().initProgressMessage).toBeNull();
  });

  it("progresses through all init stages in order", async () => {
    useWorkflowStore.getState().setInitializing();
    await initAgentStream();

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
      "Loading runtime modules...",
    );

    // Stage 2: runtime_ready
    listeners["agent-init-progress"]({
      payload: {
        agent_id: "agent-1",
        type: "init_progress",
        stage: "runtime_ready",
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
          item: {
            id: "di-1",
            type: "output",
            timestamp: Date.now(),
            outputText: "Processing...",
          },
        },
      },
    });
    expect(useWorkflowStore.getState().isInitializing).toBe(false);
    expect(useWorkflowStore.getState().initProgressMessage).toBeNull();
  });

  it("agent-init-error sets runtimeError on workflow store with message and fix_hint", async () => {
    useWorkflowStore.getState().setInitializing();
    await initAgentStream();

    listeners["agent-init-error"]({
      payload: {
        error_type: "api_key_invalid",
        message: "The API key provided is not valid.",
        fix_hint: "Check your API key in the settings.",
      },
    });

    const { runtimeError } = useWorkflowStore.getState();
    expect(runtimeError).not.toBeNull();
    expect(runtimeError!.message).toBe("The API key provided is not valid.");
    expect(runtimeError!.fix_hint).toBe("Check your API key in the settings.");
    expect(runtimeError!.error_type).toBe("api_key_invalid");
    // Also confirms initializing was cleared
    expect(useWorkflowStore.getState().isInitializing).toBe(false);
  });

  it("imports toast from @/lib/toast, not directly from sonner", async () => {
    // Read the source file and verify the import uses the app wrapper
    const source = await import.meta.glob("/src/hooks/use-agent-stream.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const content = Object.values(source)[0] as string;
    expect(content).toContain('from "@/lib/toast"');
    expect(content).not.toMatch(/from ["']sonner["']/);
  });

  it("calls shutdownRun on agent-shutdown event", async () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    await initAgentStream();

    listeners["agent-shutdown"]({
      payload: { agent_id: "agent-1" },
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("shutdown");
    expect(run.endTime).toBeDefined();
  });

  it("agent-shutdown is a no-op for non-running agents", async () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    useAgentStore.getState().completeRun("agent-1", true);
    await initAgentStream();

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

    await initAgentStream();
    // Allow the listen() promises to resolve
    await Promise.resolve();

    await _resetForTesting();
    expect(unlisten).toHaveBeenCalled();
  });
});

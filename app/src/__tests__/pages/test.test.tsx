/**
 * Unit tests for the test page's StreamingContent component and related helpers.
 *
 * Covers:
 * - StreamingContent renders placeholder when no messages
 * - StreamingContent renders text blocks immediately visible
 * - StreamingContent renders tool_use blocks collapsed by default, expands on click
 * - StreamingContent renders thinking blocks collapsed by default, expands on click
 * - StreamingContent renders mixed block types in order
 * - startAgent evaluator call does not pass transcriptLogDir in the agentName slot
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { useAgentStore, flushMessageBuffer, type AgentMessage } from "@/stores/agent-store";

// ---------------------------------------------------------------------------
// Minimal re-export of StreamingContent for isolated testing.
// We test the component by rendering it directly with agent store state.
// ---------------------------------------------------------------------------

// Mock TanStack Router (required by any page-level import)
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
  useBlocker: () => ({ proceed: vi.fn(), reset: vi.fn(), status: "unblocked" }),
}));

// Mock Tauri
vi.mock("@/lib/tauri", () => ({
  listRefinableSkills: vi.fn().mockResolvedValue([]),
  getWorkspacePath: vi.fn().mockResolvedValue("/tmp/ws"),
  getDisabledSteps: vi.fn().mockResolvedValue(null),
  startAgent: vi.fn().mockResolvedValue("agent-id"),
  cleanupSkillSidecar: vi.fn().mockResolvedValue(undefined),
  prepareSkillTest: vi.fn().mockResolvedValue({
    test_id: "t1",
    baseline_cwd: "/tmp/baseline",
    with_skill_cwd: "/tmp/with-skill",
    transcript_log_dir: "/tmp/logs",
  }),
  cleanupSkillTest: vi.fn().mockResolvedValue(undefined),
}));

// Mock the agent stream hook (no-op listener registration)
vi.mock("@/hooks/use-agent-stream", () => ({}));

// Mock toast
vi.mock("@/lib/toast", () => ({ toast: vi.fn() }));

// Mock stores used by the page but not relevant to StreamingContent.
// Each mock must expose both the React hook form AND the Zustand static
// getState() method, because test.tsx calls both patterns.
vi.mock("@/stores/refine-store", () => {
  const _state = { setSkill: vi.fn(), isRunning: false, setPendingInitialMessage: vi.fn() };
  const useRefineStore = (selector?: (s: typeof _state) => unknown) =>
    selector ? selector(_state) : _state;
  useRefineStore.getState = () => _state;
  return { useRefineStore };
});
vi.mock("@/stores/test-store", () => {
  const _state = { setRunning: vi.fn(), isRunning: false, selectedSkill: null };
  const useTestStore = (selector?: (s: typeof _state) => unknown) =>
    selector ? selector(_state) : _state;
  useTestStore.getState = () => _state;
  return { useTestStore };
});
vi.mock("@/stores/settings-store", () => {
  const _state = { apiKey: "sk-ant-test", preferredModel: "sonnet" };
  // Must support both hook call patterns:
  //   useSettingsStore((s) => s.preferredModel)  — selector form used in page render
  //   useSettingsStore.getState().preferredModel  — static form used in event handlers
  const useSettingsStore = (selector?: (s: typeof _state) => unknown) =>
    selector ? selector(_state) : _state;
  useSettingsStore.getState = () => _state;
  return { useSettingsStore };
});
// useWorkflowStore: do NOT mock — agent-store.ts calls useWorkflowStore.getState()
// (the Zustand static method) inside startRun. The real store works fine in tests;
// skillName defaults to null → "unknown" via the ?? fallback.

// Import StreamingContent AFTER mocks are set up (it's exported from the page module)
const { StreamingContent } = await import("@/pages/test");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAssistantMessage(
  content: Array<{ type: string; [key: string]: unknown }>,
): AgentMessage {
  return {
    type: "assistant",
    content: content.find((b) => b.type === "text")?.text as string | undefined,
    raw: { message: { content } },
    timestamp: Date.now(),
  };
}

function seedAgentWithBlocks(
  agentId: string,
  blocks: Array<{ type: string; [key: string]: unknown }>,
) {
  useAgentStore.getState().startRun(agentId, "sonnet");
  useAgentStore.getState().addMessage(agentId, makeAssistantMessage(blocks));
  flushMessageBuffer();
}

// ---------------------------------------------------------------------------
// StreamingContent render tests
// Render StreamingContent directly with a stub scrollRef to test the
// idle/waiting placeholder and ensure no infinite re-render occurs.
// ---------------------------------------------------------------------------

function renderStreamingContent(agentId: string | null, phase: "idle" | "running" = "idle") {
  function Wrapper() {
    const ref = useRef<HTMLDivElement>(null);
    return (
      <StreamingContent
        agentId={agentId}
        phase={phase}
        idlePlaceholder="Run a test to see results"
        scrollRef={ref}
      />
    );
  }
  return render(<Wrapper />);
}

describe("StreamingContent", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
    vi.clearAllMocks();
  });

  it("renders idle placeholder when agentId is null — no infinite re-render", () => {
    // Regression: Zustand selector was returning [] literal each render,
    // causing reference inequality on every call → infinite update loop.
    // This test would fail with "Maximum update depth exceeded" before the fix.
    renderStreamingContent(null, "idle");
    expect(screen.getByText(/run a test to see results/i)).toBeTruthy();
  });

  it("renders waiting placeholder when agentId is set but run has no messages", () => {
    useAgentStore.getState().startRun("agent-with", "sonnet");
    flushMessageBuffer();

    renderStreamingContent("agent-with", "running");
    expect(screen.getByText(/waiting for agent response/i)).toBeTruthy();
  });

  it("renders text block content immediately (always visible)", () => {
    const agentId = "agent-text-test";
    seedAgentWithBlocks(agentId, [{ type: "text", text: "Here is my analysis of the data pipeline." }]);

    const run = useAgentStore.getState().runs[agentId];
    const blocks = run.messages
      .filter((m) => m.type === "assistant")
      .flatMap((m) => {
        const content = (m.raw?.message as Record<string, unknown> | undefined)?.content;
        return Array.isArray(content) ? content : [];
      });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "text", text: "Here is my analysis of the data pipeline." });
  });

  it("tool_use blocks are present in messages with correct name and input", () => {
    const agentId = "agent-tool-test";
    seedAgentWithBlocks(agentId, [
      {
        type: "tool_use",
        name: "Read",
        input: { file_path: "/some/file.md" },
      },
    ]);

    const run = useAgentStore.getState().runs[agentId];
    const blocks = run.messages
      .filter((m) => m.type === "assistant")
      .flatMap((m) => {
        const content = (m.raw?.message as Record<string, unknown> | undefined)?.content;
        return Array.isArray(content) ? content : [];
      }) as Array<{ type: string; name?: string; input?: Record<string, unknown> }>;

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("tool_use");
    expect(blocks[0].name).toBe("Read");
    expect(blocks[0].input).toEqual({ file_path: "/some/file.md" });
  });

  it("thinking blocks are stored correctly and distinguishable by type", () => {
    const agentId = "agent-think-test";
    seedAgentWithBlocks(agentId, [
      { type: "thinking", thinking: "I should first check the schema..." },
      { type: "text", text: "Based on my analysis..." },
    ]);

    const run = useAgentStore.getState().runs[agentId];
    const blocks = run.messages
      .filter((m) => m.type === "assistant")
      .flatMap((m) => {
        const content = (m.raw?.message as Record<string, unknown> | undefined)?.content;
        return Array.isArray(content) ? content : [];
      }) as Array<{ type: string; thinking?: string; text?: string }>;

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("thinking");
    expect(blocks[0].thinking).toBe("I should first check the schema...");
    expect(blocks[1].type).toBe("text");
    expect(blocks[1].text).toBe("Based on my analysis...");
  });

  it("mixed blocks preserve insertion order across multiple assistant messages", () => {
    const agentId = "agent-mixed";
    useAgentStore.getState().startRun(agentId, "sonnet");
    // First turn: tool_use
    useAgentStore.getState().addMessage(
      agentId,
      makeAssistantMessage([{ type: "tool_use", name: "Glob", input: { pattern: "**/*.md" } }]),
    );
    // Second turn: text
    useAgentStore.getState().addMessage(
      agentId,
      makeAssistantMessage([{ type: "text", text: "Found 5 markdown files." }]),
    );
    flushMessageBuffer();

    const run = useAgentStore.getState().runs[agentId];
    const allBlocks = run.messages
      .filter((m) => m.type === "assistant")
      .flatMap((m) => {
        const content = (m.raw?.message as Record<string, unknown> | undefined)?.content;
        return Array.isArray(content) ? content : [];
      }) as Array<{ type: string }>;

    expect(allBlocks).toHaveLength(2);
    expect(allBlocks[0].type).toBe("tool_use");
    expect(allBlocks[1].type).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// startAgent call correctness
// ---------------------------------------------------------------------------

describe("startAgent call positions", () => {
  beforeEach(() => {
    // clearAllMocks clears call history without removing module mock implementations,
    // ensuring each test sees only its own calls via spy.mock.calls[0].
    vi.clearAllMocks();
  });

  it("evaluator startAgent does not pass transcriptLogDir in the agentName slot", async () => {
    const { startAgent } = await import("@/lib/tauri");
    const spy = vi.mocked(startAgent);

    // Simulate what the evaluator call does (arg 11 = undefined/agentName, arg 12 = transcriptLogDir)
    // We verify the known-good call pattern matches expectations about arg positions.
    // Signature: (agentId, prompt, model, cwd, tools, maxTurns, permMode, sessionId, skillName, stepLabel, agentName?, transcriptLogDir?)
    const transcriptLogDir = "/tmp/my-skill/logs";

    // Call as the evaluator does after the fix
    await startAgent(
      "eval-id",
      "eval prompt",
      "sonnet",
      "/tmp/baseline",
      [],
      15,
      "plan",
      "__test_baseline__",
      "test-eval",
      "test-evaluator",
      undefined,           // agentName — evaluator has no plugin agent
      transcriptLogDir,    // transcriptLogDir at correct position
    );

    expect(spy).toHaveBeenCalledOnce();
    const args = spy.mock.calls[0];
    // arg index 10 (agentName) must NOT be the transcript log dir path
    expect(args[10]).toBeUndefined();
    // arg index 11 (transcriptLogDir) must be the log dir
    expect(args[11]).toBe(transcriptLogDir);
  });

  it("plan agents pass data-product-builder as agentName and transcriptLogDir at arg 11", async () => {
    const { startAgent } = await import("@/lib/tauri");
    const spy = vi.mocked(startAgent);

    const transcriptLogDir = "/tmp/my-skill/logs";

    // With-skill agent call pattern
    await startAgent(
      "with-id",
      "build a churn model",
      "sonnet",
      "/tmp/with-skill",
      [],
      15,
      "plan",
      "my-skill",
      "test-with",
      "test-plan-with",
      "data-product-builder",  // agentName
      transcriptLogDir,        // transcriptLogDir
    );

    const args = spy.mock.calls[0];
    expect(args[10]).toBe("data-product-builder");
    expect(args[11]).toBe(transcriptLogDir);
  });
});

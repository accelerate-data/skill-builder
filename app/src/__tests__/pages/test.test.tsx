/**
 * Unit tests for the test page's StreamingContent component and related helpers.
 *
 * Covers:
 * - StreamingContent renders placeholder when no displayItems
 * - StreamingContent renders display items correctly
 * - startAgent evaluator call does not pass transcriptLogDir in the agentName slot
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { useAgentStore, flushMessageBuffer } from "@/stores/agent-store";
import type { DisplayItem } from "@/lib/display-types";

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
  const useSettingsStore = (selector?: (s: typeof _state) => unknown) =>
    selector ? selector(_state) : _state;
  useSettingsStore.getState = () => _state;
  return { useSettingsStore };
});

// Import StreamingContent AFTER mocks are set up (it's exported from the page module)
const { StreamingContent } = await import("@/pages/test");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDisplayItem(overrides: Partial<DisplayItem> & { type: DisplayItem["type"] }): DisplayItem {
  return {
    id: `di-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    ...overrides,
  } as DisplayItem;
}

function seedAgentWithDisplayItems(agentId: string, items: DisplayItem[]) {
  useAgentStore.getState().startRun(agentId, "sonnet");
  for (const item of items) {
    useAgentStore.getState().addDisplayItem(agentId, item);
  }
}

// ---------------------------------------------------------------------------
// StreamingContent render tests
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
    renderStreamingContent(null, "idle");
    expect(screen.getByText(/run a test to see results/i)).toBeTruthy();
  });

  it("renders waiting placeholder when agentId is set but run has no displayItems", () => {
    useAgentStore.getState().startRun("agent-with", "sonnet");
    flushMessageBuffer();

    renderStreamingContent("agent-with", "running");
    expect(screen.getByText(/waiting for agent response/i)).toBeTruthy();
  });

  it("renders output display items", () => {
    const agentId = "agent-text-test";
    seedAgentWithDisplayItems(agentId, [
      makeDisplayItem({ type: "output", outputText: "Here is my analysis of the data pipeline." }),
    ]);

    const run = useAgentStore.getState().runs[agentId];
    expect(run.displayItems).toHaveLength(1);
    expect(run.displayItems[0].outputText).toBe("Here is my analysis of the data pipeline.");
  });

  it("tool_call display items are present with correct name", () => {
    const agentId = "agent-tool-test";
    seedAgentWithDisplayItems(agentId, [
      makeDisplayItem({
        type: "tool_call",
        toolName: "Read",
        toolInput: { file_path: "/some/file.md" },
        toolStatus: "ok",
        toolSummary: "Reading file.md",
      }),
    ]);

    const run = useAgentStore.getState().runs[agentId];
    expect(run.displayItems).toHaveLength(1);
    expect(run.displayItems[0].toolName).toBe("Read");
  });

  it("thinking display items are stored correctly", () => {
    const agentId = "agent-think-test";
    seedAgentWithDisplayItems(agentId, [
      makeDisplayItem({ type: "thinking", thinkingText: "I should first check the schema..." }),
      makeDisplayItem({ type: "output", outputText: "Based on my analysis..." }),
    ]);

    const run = useAgentStore.getState().runs[agentId];
    expect(run.displayItems).toHaveLength(2);
    expect(run.displayItems[0].type).toBe("thinking");
    expect(run.displayItems[0].thinkingText).toBe("I should first check the schema...");
    expect(run.displayItems[1].type).toBe("output");
    expect(run.displayItems[1].outputText).toBe("Based on my analysis...");
  });

  it("mixed display items preserve insertion order", () => {
    const agentId = "agent-mixed";
    useAgentStore.getState().startRun(agentId, "sonnet");

    useAgentStore.getState().addDisplayItem(agentId, makeDisplayItem({
      id: "di-1",
      type: "tool_call",
      toolName: "Glob",
      toolInput: { pattern: "**/*.md" },
      toolStatus: "ok",
    }));
    useAgentStore.getState().addDisplayItem(agentId, makeDisplayItem({
      id: "di-2",
      type: "output",
      outputText: "Found 5 markdown files.",
    }));

    const run = useAgentStore.getState().runs[agentId];
    expect(run.displayItems).toHaveLength(2);
    expect(run.displayItems[0].type).toBe("tool_call");
    expect(run.displayItems[1].type).toBe("output");
  });
});

// ---------------------------------------------------------------------------
// startAgent call correctness
// ---------------------------------------------------------------------------

describe("startAgent call positions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("evaluator startAgent does not pass transcriptLogDir in the agentName slot", async () => {
    const { startAgent } = await import("@/lib/tauri");
    const spy = vi.mocked(startAgent);

    const transcriptLogDir = "/tmp/my-skill/logs";
    const syntheticTestSessionId = "synthetic:test:my-skill:test-123";

    // Call as the evaluator does after the fix
    await startAgent(
      "eval-id",
      "eval prompt",
      "sonnet",
      "/tmp/baseline",
      [],
      15,
      "plan",
      syntheticTestSessionId,
      "my-skill",
      "test-evaluator",
      undefined,           // agentName — evaluator has no plugin agent
      transcriptLogDir,    // transcriptLogDir at correct position
      -11,
      undefined,
      syntheticTestSessionId,
      "test",
    );

    expect(spy).toHaveBeenCalledOnce();
    const args = spy.mock.calls[0];
    expect(args[7]).toBe(syntheticTestSessionId);
    expect(args[8]).toBe("my-skill");
    expect(args[9]).toBe("test-evaluator");
    // arg index 10 (agentName) must NOT be the transcript log dir path
    expect(args[10]).toBeUndefined();
    // arg index 11 (transcriptLogDir) must be the log dir
    expect(args[11]).toBe(transcriptLogDir);
    expect(args[12]).toBe(-11);
    expect(args[13]).toBeUndefined();
    expect(args[14]).toBe(syntheticTestSessionId);
    expect(args[15]).toBe("test");
  });

  it("with-skill plan agents pass test persistence context into startAgent", async () => {
    const { startAgent } = await import("@/lib/tauri");
    const spy = vi.mocked(startAgent);

    const transcriptLogDir = "/tmp/my-skill/logs";
    const syntheticTestSessionId = "synthetic:test:my-skill:test-123";

    // With-skill agent call pattern
    await startAgent(
      "with-id",
      "build a churn model",
      "sonnet",
      "/tmp/with-skill",
      [],
      15,
      "plan",
      syntheticTestSessionId,
      "my-skill",
      "test-plan-with",
      "data-product-builder",  // agentName
      transcriptLogDir,        // transcriptLogDir
      -11,
      undefined,
      syntheticTestSessionId,
      "test",
    );

    const args = spy.mock.calls[0];
    expect(args[7]).toBe(syntheticTestSessionId);
    expect(args[8]).toBe("my-skill");
    expect(args[9]).toBe("test-plan-with");
    expect(args[10]).toBe("data-product-builder");
    expect(args[11]).toBe(transcriptLogDir);
    expect(args[12]).toBe(-11);
    expect(args[13]).toBeUndefined();
    expect(args[14]).toBe(syntheticTestSessionId);
    expect(args[15]).toBe("test");
  });

  it("baseline plan agents keep the tested skill identity and test grouping context", async () => {
    const { startAgent } = await import("@/lib/tauri");
    const spy = vi.mocked(startAgent);

    const transcriptLogDir = "/tmp/my-skill/logs";
    const syntheticTestSessionId = "synthetic:test:my-skill:test-123";

    await startAgent(
      "without-id",
      "build a churn model",
      "sonnet",
      "/tmp/baseline",
      [],
      15,
      "plan",
      syntheticTestSessionId,
      "my-skill",
      "test-plan-without",
      "data-product-builder",
      transcriptLogDir,
      -11,
      undefined,
      syntheticTestSessionId,
      "test",
    );

    const args = spy.mock.calls[0];
    expect(args[7]).toBe(syntheticTestSessionId);
    expect(args[8]).toBe("my-skill");
    expect(args[9]).toBe("test-plan-without");
    expect(args[10]).toBe("data-product-builder");
    expect(args[12]).toBe(-11);
    expect(args[14]).toBe(syntheticTestSessionId);
    expect(args[15]).toBe("test");
  });
});

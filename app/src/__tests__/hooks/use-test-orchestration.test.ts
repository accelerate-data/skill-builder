import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useAgentStore, resetAgentStoreInternals } from "@/stores/agent-store";
import { useRefineStore } from "@/stores/refine-store";

const mocks = vi.hoisted(() => ({
  startAgent: vi.fn(),
  cleanupSkillSidecar: vi.fn(),
  prepareSkillTest: vi.fn(),
  cleanupSkillTest: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  startAgent: mocks.startAgent,
  cleanupSkillSidecar: mocks.cleanupSkillSidecar,
  prepareSkillTest: mocks.prepareSkillTest,
  cleanupSkillTest: mocks.cleanupSkillTest,
}));

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(() => "tid"),
  dismiss: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toast: toastMocks,
}));

import {
  useTestOrchestration,
  INITIAL_STATE,
  buildEvalPrompt,
  buildSyntheticTestSessionId,
  extractAssistantText,
} from "@/hooks/use-test-orchestration";

// Reusable test skill fixture matching SkillSummary shape
const TEST_SKILL = {
  name: "test-skill",
  current_step: null,
  status: null,
  last_modified: null,
  tags: [],
  purpose: null,
  skill_source: "skill-builder",
  author_login: null,
  author_avatar: null,
  intake_json: null,
  description: "A test skill",
  version: null,
  model: null,
} as const;

describe("useTestOrchestration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.startAgent.mockReset().mockResolvedValue("ok");
    mocks.cleanupSkillSidecar.mockReset().mockResolvedValue(undefined);
    mocks.prepareSkillTest.mockReset();
    mocks.cleanupSkillTest.mockReset().mockResolvedValue(undefined);
    toastMocks.error.mockReset();
    useWorkflowStore.getState().reset();
    useSettingsStore.getState().reset();
    useAgentStore.getState().clearRuns();
    resetAgentStoreInternals();
    useRefineStore.setState({ isRunning: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Initial state and basic hook behavior
  // ---------------------------------------------------------------------------

  it("exports INITIAL_STATE with idle phase", () => {
    expect(INITIAL_STATE.phase).toBe("idle");
    expect(INITIAL_STATE.selectedSkill).toBeNull();
    expect(INITIAL_STATE.prompt).toBe("");
    expect(INITIAL_STATE.withAgentId).toBeNull();
    expect(INITIAL_STATE.withoutAgentId).toBeNull();
    expect(INITIAL_STATE.evalAgentId).toBeNull();
  });

  it("returns idle phase on mount", () => {
    const { result } = renderHook(() =>
      useTestOrchestration({ workspacePath: "/tmp/test" }),
    );
    expect(result.current.state.phase).toBe("idle");
    expect(result.current.isRunning).toBe(false);
    expect(result.current.elapsed).toBe(0);
  });

  it("setState updates selected skill", () => {
    const { result } = renderHook(() =>
      useTestOrchestration({ workspacePath: "/tmp/test" }),
    );

    act(() => {
      result.current.setState((prev) => ({
        ...prev,
        selectedSkill: { ...TEST_SKILL },
      }));
    });

    expect(result.current.state.selectedSkill?.name).toBe("test-skill");
  });

  it("setState updates prompt text", () => {
    const { result } = renderHook(() =>
      useTestOrchestration({ workspacePath: "/tmp/test" }),
    );

    act(() => {
      result.current.setState((prev) => ({ ...prev, prompt: "Generate a report" }));
    });

    expect(result.current.state.prompt).toBe("Generate a report");
  });

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  it("cleanup calls cleanupSkillTest when testId is provided", () => {
    mocks.cleanupSkillTest.mockResolvedValue(undefined);
    mocks.cleanupSkillSidecar.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useTestOrchestration({ workspacePath: "/tmp/test" }),
    );

    act(() => {
      result.current.cleanup("test-id-123");
    });

    expect(mocks.cleanupSkillTest).toHaveBeenCalledWith("test-id-123");
    expect(mocks.cleanupSkillSidecar).toHaveBeenCalledWith("__test_baseline__");
  });

  it("cleanup skips cleanupSkillTest when testId is null", () => {
    mocks.cleanupSkillSidecar.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useTestOrchestration({ workspacePath: "/tmp/test" }),
    );

    act(() => {
      result.current.cleanup(null);
    });

    expect(mocks.cleanupSkillTest).not.toHaveBeenCalled();
    expect(mocks.cleanupSkillSidecar).toHaveBeenCalledWith("__test_baseline__");
  });

  // ---------------------------------------------------------------------------
  // Pure helper functions
  // ---------------------------------------------------------------------------

  describe("buildEvalPrompt", () => {
    it("includes user prompt, skill name, and both plan texts", () => {
      const result = buildEvalPrompt(
        "Build a dashboard",
        "my-skill",
        "Plan A output",
        "Plan B output",
      );
      expect(result).toContain("Build a dashboard");
      expect(result).toContain("my-skill");
      expect(result).toContain("Plan A output");
      expect(result).toContain("Plan B output");
    });

    it("includes direction symbols and recommendations heading", () => {
      const result = buildEvalPrompt("prompt", "skill", "a", "b");
      expect(result).toContain("\u2191");
      expect(result).toContain("\u2193");
      expect(result).toContain("\u2192");
      expect(result).toContain("## Recommendations");
    });
  });

  describe("buildSyntheticTestSessionId", () => {
    it("produces synthetic:test:<skill>:<testId> format", () => {
      const id = buildSyntheticTestSessionId("my-skill", "abc-123");
      expect(id).toBe("synthetic:test:my-skill:abc-123");
    });
  });

  describe("extractAssistantText", () => {
    it("returns empty string for unknown agent", () => {
      expect(extractAssistantText("nonexistent")).toBe("");
    });

    it("extracts output text from display items", () => {
      const agentId = "extract-test";
      useAgentStore.getState().registerRun(agentId, "sonnet", "test-skill");
      useAgentStore.setState((state) => ({
        runs: {
          ...state.runs,
          [agentId]: {
            ...state.runs[agentId],
            displayItems: [
              { type: "output", outputText: "Hello", id: "1", timestamp: 0 } as any,
              { type: "tool_call", toolSummary: "Read file.txt", id: "2", timestamp: 1 } as any,
              { type: "thinking", outputText: "ignored", id: "3", timestamp: 2 } as any,
            ],
          },
        },
      }));

      const text = extractAssistantText(agentId);
      expect(text).toContain("Hello");
      expect(text).toContain("Read file.txt");
      expect(text).not.toContain("ignored");
    });
  });

  // ---------------------------------------------------------------------------
  // handleRunTest — validation guards
  // ---------------------------------------------------------------------------

  describe("handleRunTest", () => {
    it("shows error toast when no skill is selected", async () => {
      const { result } = renderHook(() =>
        useTestOrchestration({ workspacePath: "/tmp/test" }),
      );

      // Set prompt but no skill
      act(() => {
        result.current.setState((prev) => ({ ...prev, prompt: "Do something" }));
      });

      await act(async () => {
        await result.current.handleRunTest();
      });

      expect(toastMocks.error).toHaveBeenCalledWith(
        expect.stringContaining("Select a skill"),
        expect.anything(),
      );
      expect(mocks.prepareSkillTest).not.toHaveBeenCalled();
    });

    it("shows error toast when prompt is empty", async () => {
      const { result } = renderHook(() =>
        useTestOrchestration({ workspacePath: "/tmp/test" }),
      );

      act(() => {
        result.current.setState((prev) => ({
          ...prev,
          selectedSkill: { ...TEST_SKILL },
          prompt: "   ",
        }));
      });

      await act(async () => {
        await result.current.handleRunTest();
      });

      expect(toastMocks.error).toHaveBeenCalledWith(
        expect.stringContaining("Select a skill"),
        expect.anything(),
      );
      expect(mocks.prepareSkillTest).not.toHaveBeenCalled();
    });

    it("blocks when workflow is running", async () => {
      useWorkflowStore.setState({ isRunning: true });

      const { result } = renderHook(() =>
        useTestOrchestration({ workspacePath: "/tmp/test" }),
      );

      act(() => {
        result.current.setState((prev) => ({
          ...prev,
          selectedSkill: { ...TEST_SKILL },
          prompt: "Do something",
        }));
      });

      await act(async () => {
        await result.current.handleRunTest();
      });

      expect(toastMocks.error).toHaveBeenCalledWith(
        expect.stringContaining("other agents are running"),
        expect.anything(),
      );
      expect(mocks.prepareSkillTest).not.toHaveBeenCalled();
    });

    it("blocks when refine is running", async () => {
      useRefineStore.setState({ isRunning: true });

      const { result } = renderHook(() =>
        useTestOrchestration({ workspacePath: "/tmp/test" }),
      );

      act(() => {
        result.current.setState((prev) => ({
          ...prev,
          selectedSkill: { ...TEST_SKILL },
          prompt: "Do something",
        }));
      });

      await act(async () => {
        await result.current.handleRunTest();
      });

      expect(toastMocks.error).toHaveBeenCalledWith(
        expect.stringContaining("other agents are running"),
        expect.anything(),
      );
    });

    it("transitions to running phase and calls prepareSkillTest + startAgent", async () => {
      mocks.prepareSkillTest.mockResolvedValue({
        test_id: "tid-1",
        with_skill_cwd: "/tmp/with",
        baseline_cwd: "/tmp/baseline",
        transcript_log_dir: "/tmp/logs",
      });
      mocks.startAgent.mockResolvedValue("ok");

      const { result } = renderHook(() =>
        useTestOrchestration({ workspacePath: "/tmp/workspace" }),
      );

      act(() => {
        result.current.setState((prev) => ({
          ...prev,
          selectedSkill: { ...TEST_SKILL },
          prompt: "Build a report",
        }));
      });

      await act(async () => {
        await result.current.handleRunTest();
      });

      expect(mocks.prepareSkillTest).toHaveBeenCalledWith("/tmp/workspace", "test-skill");
      expect(mocks.startAgent).toHaveBeenCalledTimes(2);
      expect(result.current.state.phase).toBe("running");
      expect(result.current.state.testId).toBe("tid-1");
      expect(result.current.state.withAgentId).toContain("test-skill-test-with-");
      expect(result.current.state.withoutAgentId).toContain("__test_baseline__-test-without-");
      expect(result.current.isRunning).toBe(true);
    });

    it("transitions to error phase when prepareSkillTest rejects", async () => {
      mocks.prepareSkillTest.mockRejectedValue(new Error("disk full"));
      mocks.cleanupSkillSidecar.mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useTestOrchestration({ workspacePath: "/tmp/test" }),
      );

      act(() => {
        result.current.setState((prev) => ({
          ...prev,
          selectedSkill: { ...TEST_SKILL },
          prompt: "Build something",
        }));
      });

      await act(async () => {
        await result.current.handleRunTest();
      });

      expect(result.current.state.phase).toBe("error");
      expect(result.current.state.errorMessage).toContain("disk full");
    });

    it("transitions to error when workspacePath is null", async () => {
      mocks.cleanupSkillSidecar.mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useTestOrchestration({ workspacePath: null }),
      );

      act(() => {
        result.current.setState((prev) => ({
          ...prev,
          selectedSkill: { ...TEST_SKILL },
          prompt: "Build something",
        }));
      });

      await act(async () => {
        await result.current.handleRunTest();
      });

      expect(result.current.state.phase).toBe("error");
      expect(result.current.state.errorMessage).toContain("Workspace path not configured");
    });

    it("no-ops when already in running phase", async () => {
      const { result } = renderHook(() =>
        useTestOrchestration({ workspacePath: "/tmp/test" }),
      );

      act(() => {
        result.current.setState((prev) => ({
          ...prev,
          selectedSkill: { ...TEST_SKILL },
          prompt: "Do something",
          phase: "running",
        }));
      });

      await act(async () => {
        await result.current.handleRunTest();
      });

      expect(mocks.prepareSkillTest).not.toHaveBeenCalled();
    });
  });
});

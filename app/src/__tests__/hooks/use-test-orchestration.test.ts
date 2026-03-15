import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useAgentStore, resetAgentStoreInternals } from "@/stores/agent-store";

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

vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => "tid"), dismiss: vi.fn() },
}));

import { useTestOrchestration, INITIAL_STATE } from "@/hooks/use-test-orchestration";

describe("useTestOrchestration", () => {
  beforeEach(() => {
    mocks.startAgent.mockReset();
    mocks.cleanupSkillSidecar.mockReset();
    mocks.prepareSkillTest.mockReset();
    mocks.cleanupSkillTest.mockReset();
    useWorkflowStore.getState().reset();
    useSettingsStore.getState().reset();
    useAgentStore.getState().clearRuns();
    resetAgentStoreInternals();
  });

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
        selectedSkill: {
          name: "test-skill",
          skill_source: "skill-builder",
          domain: null,
          skill_type: null,
          created_at: "2025-01-01",
          updated_at: "2025-01-01",
          deleted_at: null,
          description: "A test skill",
          version: null,
          model: null,
          argument_hint: null,
          user_invocable: null,
          disable_model_invocation: null,
        },
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
    // cleanupSkillSidecar is always called regardless of testId
    expect(mocks.cleanupSkillSidecar).toHaveBeenCalledWith("__test_baseline__");
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useWorkflowStore } from "@/stores/workflow-store";

// Mock the tauri module so createWorkflowSession doesn't call native code
vi.mock("@/lib/tauri", () => ({
  createWorkflowSession: vi.fn(() => Promise.resolve()),
}));

describe("useWorkflowStore", () => {
  beforeEach(() => {
    useWorkflowStore.getState().reset();
  });

  it("has correct initial state with 4 steps, all pending, currentStep=0", () => {
    const state = useWorkflowStore.getState();
    expect(state.skillName).toBeNull();
    expect(state.purpose).toBeNull();
    expect(state.currentStep).toBe(0);
    expect(state.isRunning).toBe(false);
    expect(state.steps).toHaveLength(4);
    state.steps.forEach((step) => {
      expect(step.status).toBe("pending");
    });
    // Verify step IDs are 0-3
    expect(state.steps.map((s) => s.id)).toEqual([0, 1, 2, 3]);
  });

  it("initWorkflow sets skillName, purpose, and resets steps", () => {
    // First change some state
    useWorkflowStore.getState().setCurrentStep(3);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setRunning(true);

    // Now init a new workflow
    useWorkflowStore.getState().initWorkflow("my-skill", "domain");

    const state = useWorkflowStore.getState();
    expect(state.skillName).toBe("my-skill");
    expect(state.purpose).toBe("domain");
    expect(state.currentStep).toBe(0);
    expect(state.isRunning).toBe(false);
    // All steps should be reset to pending
    state.steps.forEach((step) => {
      expect(step.status).toBe("pending");
    });
  });

  it("updateStepStatus changes a specific step's status", () => {
    useWorkflowStore.getState().updateStepStatus(2, "in_progress");
    const state = useWorkflowStore.getState();
    expect(state.steps[2].status).toBe("in_progress");
    // Other steps remain pending
    expect(state.steps[0].status).toBe("pending");
    expect(state.steps[1].status).toBe("pending");
    expect(state.steps[3].status).toBe("pending");
  });

  it("updateStepStatus can set different statuses", () => {
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "in_progress");
    useWorkflowStore.getState().updateStepStatus(2, "error");

    const state = useWorkflowStore.getState();
    expect(state.steps[0].status).toBe("completed");
    expect(state.steps[1].status).toBe("in_progress");
    expect(state.steps[2].status).toBe("error");
  });

  it("setCurrentStep changes currentStep", () => {
    useWorkflowStore.getState().setCurrentStep(2);
    expect(useWorkflowStore.getState().currentStep).toBe(2);
  });

  it("setRunning changes isRunning", () => {
    useWorkflowStore.getState().setRunning(true);
    expect(useWorkflowStore.getState().isRunning).toBe(true);
    useWorkflowStore.getState().setRunning(false);
    expect(useWorkflowStore.getState().isRunning).toBe(false);
  });

  it("isRunning is false when reviewMode is active (initial state)", () => {
    const state = useWorkflowStore.getState();
    // reviewMode defaults to true; isRunning must be false — no agent runs in review mode
    expect(state.reviewMode).toBe(true);
    expect(state.isRunning).toBe(false);
  });

  it("isRunning remains false after setReviewMode(true) is called", () => {
    // Simulate: user was in update mode with a running agent, then toggled back to review
    useWorkflowStore.getState().setRunning(true);
    expect(useWorkflowStore.getState().isRunning).toBe(true);

    // Toggling to review mode does not automatically stop the agent —
    // but once setRunning(false) is called, review mode must not restart it
    useWorkflowStore.getState().setRunning(false);
    useWorkflowStore.getState().setReviewMode(true);

    expect(useWorkflowStore.getState().isRunning).toBe(false);
    expect(useWorkflowStore.getState().reviewMode).toBe(true);
  });

  it("setRunning creates workflowSessionId once and reuses across steps", () => {
    // First step starts → generates session ID
    useWorkflowStore.getState().setRunning(true);
    const sessionId = useWorkflowStore.getState().workflowSessionId;
    expect(sessionId).toBeTruthy();

    // Step ends
    useWorkflowStore.getState().setRunning(false);
    expect(useWorkflowStore.getState().workflowSessionId).toBe(sessionId);

    // Second step starts → same session ID
    useWorkflowStore.getState().setRunning(true);
    expect(useWorkflowStore.getState().workflowSessionId).toBe(sessionId);

    // Third step starts → still same session ID
    useWorkflowStore.getState().setRunning(false);
    useWorkflowStore.getState().setRunning(true);
    expect(useWorkflowStore.getState().workflowSessionId).toBe(sessionId);
  });

  it("initWorkflow resets workflowSessionId so next run creates a new one", () => {
    useWorkflowStore.getState().setRunning(true);
    const firstSessionId = useWorkflowStore.getState().workflowSessionId;
    useWorkflowStore.getState().setRunning(false);

    // Re-init (user navigates back to dashboard and opens a skill)
    useWorkflowStore.getState().initWorkflow("new-skill", "new-domain");
    expect(useWorkflowStore.getState().workflowSessionId).toBeNull();

    // New workflow start → new session ID
    useWorkflowStore.getState().setRunning(true);
    const secondSessionId = useWorkflowStore.getState().workflowSessionId;
    expect(secondSessionId).toBeTruthy();
    expect(secondSessionId).not.toBe(firstSessionId);
  });

  it("reset clears everything back to initial state", () => {
    useWorkflowStore.getState().initWorkflow("test-skill", "hr analytics");
    useWorkflowStore.getState().setCurrentStep(3);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().setRunning(true);

    useWorkflowStore.getState().reset();

    const state = useWorkflowStore.getState();
    expect(state.skillName).toBeNull();
    expect(state.purpose).toBeNull();
    expect(state.currentStep).toBe(0);
    expect(state.isRunning).toBe(false);
    expect(state.steps).toHaveLength(4);
    state.steps.forEach((step) => {
      expect(step.status).toBe("pending");
    });
  });

  it("resetToStep resets target step and all subsequent steps to pending", () => {
    const store = useWorkflowStore.getState();
    // Complete steps 0 through 2
    for (let i = 0; i <= 2; i++) {
      store.updateStepStatus(i, "completed");
    }
    store.setCurrentStep(3);
    store.setRunning(true);

    // Rerun from step 2
    useWorkflowStore.getState().resetToStep(2);

    const state = useWorkflowStore.getState();
    // Steps 0-1 should remain completed
    expect(state.steps[0].status).toBe("completed");
    expect(state.steps[1].status).toBe("completed");
    // Steps 2-3 should be reset to pending
    for (let i = 2; i <= 3; i++) {
      expect(state.steps[i].status).toBe("pending");
    }
    // currentStep should be 2
    expect(state.currentStep).toBe(2);
    // isRunning should be false
    expect(state.isRunning).toBe(false);
  });

  it("resetToStep from step 0 resets all steps", () => {
    const store = useWorkflowStore.getState();
    for (let i = 0; i <= 3; i++) {
      store.updateStepStatus(i, "completed");
    }
    store.setCurrentStep(3);

    useWorkflowStore.getState().resetToStep(0);

    const state = useWorkflowStore.getState();
    state.steps.forEach((step) => {
      expect(step.status).toBe("pending");
    });
    expect(state.currentStep).toBe(0);
  });

  it("steps have expected names", () => {
    const state = useWorkflowStore.getState();
    expect(state.steps[0].name).toBe("Research");
    expect(state.steps[1].name).toBe("Detailed Research");
    expect(state.steps[2].name).toBe("Confirm Decisions");
    expect(state.steps[3].name).toBe("Generate Skill");
  });

  it("does not have a Package step", () => {
    const state = useWorkflowStore.getState();
    expect(state.steps.find((s) => s.name === "Package")).toBeUndefined();
  });

  describe("setInitializing / clearInitializing", () => {
    it("has correct initial state for initializing fields", () => {
      const state = useWorkflowStore.getState();
      expect(state.isInitializing).toBe(false);
      expect(state.initStartTime).toBeNull();
    });

    it("setInitializing sets isInitializing=true and records start time", () => {
      const before = Date.now();
      useWorkflowStore.getState().setInitializing();
      const state = useWorkflowStore.getState();
      expect(state.isInitializing).toBe(true);
      expect(state.initStartTime).toBeGreaterThanOrEqual(before);
      expect(state.initStartTime).toBeLessThanOrEqual(Date.now());
    });

    it("clearInitializing resets isInitializing=false and initStartTime=null", () => {
      useWorkflowStore.getState().setInitializing();
      useWorkflowStore.getState().clearInitializing();
      const state = useWorkflowStore.getState();
      expect(state.isInitializing).toBe(false);
      expect(state.initStartTime).toBeNull();
    });

    it("initWorkflow resets initializing state", () => {
      useWorkflowStore.getState().setInitializing();
      useWorkflowStore.getState().initWorkflow("test", "test domain");
      const state = useWorkflowStore.getState();
      expect(state.isInitializing).toBe(false);
      expect(state.initStartTime).toBeNull();
    });

    it("reset clears initializing state", () => {
      useWorkflowStore.getState().setInitializing();
      useWorkflowStore.getState().reset();
      const state = useWorkflowStore.getState();
      expect(state.isInitializing).toBe(false);
      expect(state.initStartTime).toBeNull();
    });
  });

  describe("workflowSessionId lifecycle", () => {
    it("starts with null workflowSessionId", () => {
      expect(useWorkflowStore.getState().workflowSessionId).toBeNull();
    });

    it("creates a session ID when setRunning(true) is called", async () => {
      const { createWorkflowSession } = await import("@/lib/tauri");
      useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
      useWorkflowStore.getState().setRunning(true);

      const state = useWorkflowStore.getState();
      expect(state.workflowSessionId).toBeTruthy();
      expect(typeof state.workflowSessionId).toBe("string");
      // createWorkflowSession should have been called fire-and-forget
      expect(createWorkflowSession).toHaveBeenCalledWith(
        state.workflowSessionId,
        "test-skill",
      );
    });

    it("does not create a new session if one already exists", async () => {
      const { createWorkflowSession } = await import("@/lib/tauri");
      vi.mocked(createWorkflowSession).mockClear();

      useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
      useWorkflowStore.getState().setRunning(true);
      const firstId = useWorkflowStore.getState().workflowSessionId;

      useWorkflowStore.getState().setRunning(true);
      expect(useWorkflowStore.getState().workflowSessionId).toBe(firstId);
      // Should only have been called once
      expect(createWorkflowSession).toHaveBeenCalledTimes(1);
    });

    it("clears session ID on reset", () => {
      useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
      useWorkflowStore.getState().setRunning(true);
      expect(useWorkflowStore.getState().workflowSessionId).toBeTruthy();

      useWorkflowStore.getState().reset();
      expect(useWorkflowStore.getState().workflowSessionId).toBeNull();
    });

    it("clears session ID on initWorkflow", () => {
      useWorkflowStore.getState().initWorkflow("test-skill", "test domain");
      useWorkflowStore.getState().setRunning(true);
      expect(useWorkflowStore.getState().workflowSessionId).toBeTruthy();

      useWorkflowStore.getState().initWorkflow("new-skill", "new domain");
      expect(useWorkflowStore.getState().workflowSessionId).toBeNull();
    });
  });

  describe("gateLoading", () => {
    it("defaults to false", () => {
      expect(useWorkflowStore.getState().gateLoading).toBe(false);
    });

    it("setGateLoading(true) sets it, setGateLoading(false) clears it", () => {
      useWorkflowStore.getState().setGateLoading(true);
      expect(useWorkflowStore.getState().gateLoading).toBe(true);

      useWorkflowStore.getState().setGateLoading(false);
      expect(useWorkflowStore.getState().gateLoading).toBe(false);
    });

    it("initWorkflow resets gateLoading to false", () => {
      useWorkflowStore.getState().setGateLoading(true);
      useWorkflowStore.getState().initWorkflow("test", "test domain");
      expect(useWorkflowStore.getState().gateLoading).toBe(false);
    });

    it("reset resets gateLoading to false", () => {
      useWorkflowStore.getState().setGateLoading(true);
      useWorkflowStore.getState().reset();
      expect(useWorkflowStore.getState().gateLoading).toBe(false);
    });
  });

  describe("loadWorkflowState migration safety", () => {
    it("completes all 4 steps (0-3)", () => {
      // Simulate SQLite returning all steps completed
      useWorkflowStore.getState().loadWorkflowState([0, 1, 2, 3]);

      const state = useWorkflowStore.getState();
      // All 4 steps (0-3) should be completed
      state.steps.forEach((step) => {
        expect(step.status).toBe("completed");
      });
      expect(state.steps).toHaveLength(4);
      // currentStep should be the last valid step since all are completed
      expect(state.currentStep).toBe(3);
      expect(state.hydrated).toBe(true);
    });

    it("ignores step_id 4, 5, 6, 7 and 8 from legacy SQLite data", () => {
      useWorkflowStore.getState().loadWorkflowState([0, 1, 2, 3, 4, 5, 6, 7, 8]);

      const state = useWorkflowStore.getState();
      state.steps.forEach((step) => {
        expect(step.status).toBe("completed");
      });
      expect(state.steps.find((s) => s.id === 4)).toBeUndefined();
      expect(state.steps.find((s) => s.id === 8)).toBeUndefined();
      expect(state.steps).toHaveLength(4);
    });

    it("correctly hydrates partial progress with legacy step_id 8 present", () => {
      // Steps 0-1 completed in SQLite, plus leftover step 8 from old data
      useWorkflowStore.getState().loadWorkflowState([0, 1, 8]);

      const state = useWorkflowStore.getState();
      for (let i = 0; i <= 1; i++) {
        expect(state.steps[i].status).toBe("completed");
      }
      for (let i = 2; i <= 3; i++) {
        expect(state.steps[i].status).toBe("pending");
      }
      // First incomplete step is 2
      expect(state.currentStep).toBe(2);
    });
  });

  describe("disabledSteps", () => {
    it("starts with empty disabledSteps", () => {
      expect(useWorkflowStore.getState().disabledSteps).toEqual([]);
    });

    it("setDisabledSteps updates the list", () => {
      useWorkflowStore.getState().setDisabledSteps([2, 3]);
      expect(useWorkflowStore.getState().disabledSteps).toEqual([2, 3]);
    });

    it("reset() clears disabledSteps", () => {
      useWorkflowStore.getState().setDisabledSteps([2, 3]);
      expect(useWorkflowStore.getState().disabledSteps).toEqual([2, 3]);

      useWorkflowStore.getState().reset();
      expect(useWorkflowStore.getState().disabledSteps).toEqual([]);
    });

    it("initWorkflow clears disabledSteps", () => {
      useWorkflowStore.getState().setDisabledSteps([3]);
      expect(useWorkflowStore.getState().disabledSteps).toEqual([3]);

      useWorkflowStore.getState().initWorkflow("new-skill", "domain");
      expect(useWorkflowStore.getState().disabledSteps).toEqual([]);
    });

    it("resetToStep(0) clears disabledSteps", () => {
      useWorkflowStore.getState().setDisabledSteps([2, 3]);
      useWorkflowStore.getState().resetToStep(0);
      expect(useWorkflowStore.getState().disabledSteps).toEqual([]);
    });

    it("resetToStep(n > 0) also clears disabledSteps", () => {
      useWorkflowStore.getState().setDisabledSteps([3]);
      useWorkflowStore.getState().resetToStep(2);
      // Guards are re-evaluated from disk after each step completes — stale guards
      // (e.g. contradictory_inputs from old decisions.md) must not persist across resets
      expect(useWorkflowStore.getState().disabledSteps).toEqual([]);
    });
  });

  describe("navigateBackToStep", () => {
    it("navigateBackToStep(0) keeps step 0 as completed, resets steps 1–3 to pending", () => {
      const store = useWorkflowStore.getState();
      store.updateStepStatus(0, "completed");
      store.updateStepStatus(1, "completed");
      store.updateStepStatus(2, "completed");
      store.updateStepStatus(3, "completed");
      store.setCurrentStep(3);

      useWorkflowStore.getState().navigateBackToStep(0);

      const state = useWorkflowStore.getState();
      expect(state.steps[0].status).toBe("completed");
      expect(state.steps[1].status).toBe("pending");
      expect(state.steps[2].status).toBe("pending");
      expect(state.steps[3].status).toBe("pending");
      expect(state.currentStep).toBe(0);
    });

    it("navigateBackToStep(1) keeps step 1 completed, resets steps 2–3 to pending", () => {
      const store = useWorkflowStore.getState();
      store.updateStepStatus(0, "completed");
      store.updateStepStatus(1, "completed");
      store.updateStepStatus(2, "completed");
      store.updateStepStatus(3, "completed");
      store.setCurrentStep(3);

      useWorkflowStore.getState().navigateBackToStep(1);

      const state = useWorkflowStore.getState();
      expect(state.steps[0].status).toBe("completed");
      expect(state.steps[1].status).toBe("completed");
      expect(state.steps[2].status).toBe("pending");
      expect(state.steps[3].status).toBe("pending");
      expect(state.currentStep).toBe(1);
    });

    it("navigateBackToStep clears disabledSteps", () => {
      useWorkflowStore.getState().setDisabledSteps([1, 2, 3]);

      useWorkflowStore.getState().navigateBackToStep(1);

      expect(useWorkflowStore.getState().disabledSteps).toEqual([]);
    });
  });
});

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

  it("has correct initial state with 8 steps, all pending, currentStep=0", () => {
    const state = useWorkflowStore.getState();
    expect(state.skillName).toBeNull();
    expect(state.domain).toBeNull();
    expect(state.currentStep).toBe(0);
    expect(state.isRunning).toBe(false);
    expect(state.steps).toHaveLength(8);
    state.steps.forEach((step) => {
      expect(step.status).toBe("pending");
    });
    // Verify step IDs are 0-7
    expect(state.steps.map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("initWorkflow sets skillName, domain, and resets steps", () => {
    // First change some state
    useWorkflowStore.getState().setCurrentStep(5);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().setRunning(true);

    // Now init a new workflow
    useWorkflowStore.getState().initWorkflow("my-skill", "sales pipeline");

    const state = useWorkflowStore.getState();
    expect(state.skillName).toBe("my-skill");
    expect(state.domain).toBe("sales pipeline");
    expect(state.currentStep).toBe(0);
    expect(state.isRunning).toBe(false);
    // All steps should be reset to pending
    state.steps.forEach((step) => {
      expect(step.status).toBe("pending");
    });
  });

  it("updateStepStatus changes a specific step's status", () => {
    useWorkflowStore.getState().updateStepStatus(3, "in_progress");
    const state = useWorkflowStore.getState();
    expect(state.steps[3].status).toBe("in_progress");
    // Other steps remain pending
    expect(state.steps[0].status).toBe("pending");
    expect(state.steps[2].status).toBe("pending");
    expect(state.steps[4].status).toBe("pending");
  });

  it("updateStepStatus can set different statuses", () => {
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "waiting_for_user");
    useWorkflowStore.getState().updateStepStatus(2, "error");

    const state = useWorkflowStore.getState();
    expect(state.steps[0].status).toBe("completed");
    expect(state.steps[1].status).toBe("waiting_for_user");
    expect(state.steps[2].status).toBe("error");
  });

  it("setCurrentStep changes currentStep", () => {
    useWorkflowStore.getState().setCurrentStep(7);
    expect(useWorkflowStore.getState().currentStep).toBe(7);
  });

  it("setRunning changes isRunning", () => {
    useWorkflowStore.getState().setRunning(true);
    expect(useWorkflowStore.getState().isRunning).toBe(true);
    useWorkflowStore.getState().setRunning(false);
    expect(useWorkflowStore.getState().isRunning).toBe(false);
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
    useWorkflowStore.getState().setCurrentStep(4);
    useWorkflowStore.getState().updateStepStatus(0, "completed");
    useWorkflowStore.getState().updateStepStatus(1, "completed");
    useWorkflowStore.getState().setRunning(true);

    useWorkflowStore.getState().reset();

    const state = useWorkflowStore.getState();
    expect(state.skillName).toBeNull();
    expect(state.domain).toBeNull();
    expect(state.currentStep).toBe(0);
    expect(state.isRunning).toBe(false);
    expect(state.steps).toHaveLength(8);
    state.steps.forEach((step) => {
      expect(step.status).toBe("pending");
    });
  });

  it("rerunFromStep resets target step and all subsequent steps to pending", () => {
    const store = useWorkflowStore.getState();
    // Complete steps 0 through 5
    for (let i = 0; i <= 5; i++) {
      store.updateStepStatus(i, "completed");
    }
    store.setCurrentStep(6);
    store.setRunning(true);

    // Rerun from step 3
    useWorkflowStore.getState().rerunFromStep(3);

    const state = useWorkflowStore.getState();
    // Steps 0-2 should remain completed
    expect(state.steps[0].status).toBe("completed");
    expect(state.steps[1].status).toBe("completed");
    expect(state.steps[2].status).toBe("completed");
    // Steps 3-7 should be reset to pending
    for (let i = 3; i <= 7; i++) {
      expect(state.steps[i].status).toBe("pending");
    }
    // currentStep should be 3
    expect(state.currentStep).toBe(3);
    // isRunning should be false
    expect(state.isRunning).toBe(false);
  });

  it("rerunFromStep from step 0 resets all steps", () => {
    const store = useWorkflowStore.getState();
    for (let i = 0; i <= 7; i++) {
      store.updateStepStatus(i, "completed");
    }
    store.setCurrentStep(7);

    useWorkflowStore.getState().rerunFromStep(0);

    const state = useWorkflowStore.getState();
    state.steps.forEach((step) => {
      expect(step.status).toBe("pending");
    });
    expect(state.currentStep).toBe(0);
  });

  it("steps have expected names", () => {
    const state = useWorkflowStore.getState();
    expect(state.steps[0].name).toBe("Research Concepts");
    expect(state.steps[2].name).toBe("Perform Research");
    expect(state.steps[3].name).toBe("Human Review");
    expect(state.steps[4].name).toBe("Reasoning");
    expect(state.steps[5].name).toBe("Build Skill");
    expect(state.steps[6].name).toBe("Validate");
    expect(state.steps[7].name).toBe("Refine");
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

  describe("loadWorkflowState migration safety", () => {
    it("completes all 8 steps including step 7 (Refine)", () => {
      // Simulate SQLite returning all steps completed including the Refine step (7)
      useWorkflowStore.getState().loadWorkflowState([0, 1, 2, 3, 4, 5, 6, 7]);

      const state = useWorkflowStore.getState();
      // All 8 real steps (0-7) should be completed
      state.steps.forEach((step) => {
        expect(step.status).toBe("completed");
      });
      expect(state.steps).toHaveLength(8);
      // currentStep should be the last valid step since all are completed
      expect(state.currentStep).toBe(7);
      expect(state.hydrated).toBe(true);
    });

    it("ignores step_id 8 from legacy SQLite data", () => {
      useWorkflowStore.getState().loadWorkflowState([0, 1, 2, 3, 4, 5, 6, 7, 8]);

      const state = useWorkflowStore.getState();
      state.steps.forEach((step) => {
        expect(step.status).toBe("completed");
      });
      expect(state.steps.find((s) => s.id === 8)).toBeUndefined();
      expect(state.steps).toHaveLength(8);
    });

    it("correctly hydrates partial progress with legacy step_id 8 present", () => {
      // Steps 0-4 completed in SQLite, plus leftover step 8 from old data
      useWorkflowStore.getState().loadWorkflowState([0, 1, 2, 3, 4, 8]);

      const state = useWorkflowStore.getState();
      for (let i = 0; i <= 4; i++) {
        expect(state.steps[i].status).toBe("completed");
      }
      for (let i = 5; i <= 7; i++) {
        expect(state.steps[i].status).toBe("pending");
      }
      // First incomplete step is 5
      expect(state.currentStep).toBe(5);
    });
  });
});

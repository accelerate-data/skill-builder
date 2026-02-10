import { describe, it, expect, beforeEach } from "vitest";
import { useWorkflowStore } from "@/stores/workflow-store";

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
    expect(state.steps[7].name).toBe("Test");
  });

  it("does not have a Package step", () => {
    const state = useWorkflowStore.getState();
    expect(state.steps.find((s) => s.name === "Package")).toBeUndefined();
  });

  describe("loadWorkflowState migration safety", () => {
    it("ignores step_id 8 from legacy SQLite data (removed Package step)", () => {
      // Simulate SQLite returning completed steps including the old Package step (8)
      useWorkflowStore.getState().loadWorkflowState([0, 1, 2, 3, 4, 5, 6, 7, 8]);

      const state = useWorkflowStore.getState();
      // All 8 real steps (0-7) should be completed
      state.steps.forEach((step) => {
        expect(step.status).toBe("completed");
      });
      // No step with id 8 should exist
      expect(state.steps.find((s) => s.id === 8)).toBeUndefined();
      expect(state.steps).toHaveLength(8);
      // currentStep should be the last valid step since all are completed
      expect(state.currentStep).toBe(7);
      expect(state.hydrated).toBe(true);
    });

    it("ignores step_id 9 from legacy SQLite data", () => {
      useWorkflowStore.getState().loadWorkflowState([0, 1, 2, 3, 4, 5, 6, 7, 9]);

      const state = useWorkflowStore.getState();
      state.steps.forEach((step) => {
        expect(step.status).toBe("completed");
      });
      expect(state.steps.find((s) => s.id === 9)).toBeUndefined();
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

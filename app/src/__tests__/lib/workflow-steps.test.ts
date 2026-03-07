import { describe, expect, it } from "vitest";
import { getWorkflowStepLabel, normalizeWorkflowStepId } from "@/lib/workflow-steps";

describe("workflow step semantics", () => {
  it("maps canonical workflow step ids", () => {
    expect(getWorkflowStepLabel(0)).toBe("Research");
    expect(getWorkflowStepLabel(1)).toBe("Detailed Research");
    expect(getWorkflowStepLabel(2)).toBe("Confirm Decisions");
    expect(getWorkflowStepLabel(3)).toBe("Generate Skill");
  });

  it("maps synthetic refine and test labels", () => {
    expect(getWorkflowStepLabel(-10)).toBe("Refine");
    expect(getWorkflowStepLabel(-11)).toBe("Test");
  });

  it("normalizes legacy step ids to canonical ids", () => {
    expect(normalizeWorkflowStepId(4)).toBe(2);
    expect(normalizeWorkflowStepId(5)).toBe(3);
    expect(getWorkflowStepLabel(4)).toBe("Confirm Decisions");
    expect(getWorkflowStepLabel(5)).toBe("Generate Skill");
  });
});

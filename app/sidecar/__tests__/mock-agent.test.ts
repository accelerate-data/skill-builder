import { describe, it, expect } from "vitest";
import { parsePromptPaths, resolveStepTemplate } from "../mock-agent.js";

// ---------------------------------------------------------------------------
// resolveStepTemplate
// ---------------------------------------------------------------------------

describe("resolveStepTemplate", () => {
  it("maps answer-evaluator to gate-answer-evaluator", () => {
    expect(resolveStepTemplate("answer-evaluator")).toBe(
      "gate-answer-evaluator",
    );
  });

  it("maps research agents to step0-research", () => {
    expect(resolveStepTemplate("research-orchestrator")).toBe("step0-research");
    expect(resolveStepTemplate("research-planner")).toBe("step0-research");
    expect(resolveStepTemplate("consolidate-research")).toBe("step0-research");
    expect(resolveStepTemplate("research-entities")).toBe("step0-research");
  });

  it("maps workflow step agents correctly", () => {
    expect(resolveStepTemplate("detailed-research")).toBe(
      "step2-detailed-research",
    );
    expect(resolveStepTemplate("confirm-decisions")).toBe(
      "step4-confirm-decisions",
    );
    expect(resolveStepTemplate("generate-skill")).toBe("step5-generate-skill");
    expect(resolveStepTemplate("validate-skill")).toBe("step6-validate-skill");
  });

  it("returns null for unknown agents", () => {
    expect(resolveStepTemplate("unknown-agent")).toBeNull();
    expect(resolveStepTemplate(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parsePromptPaths
// ---------------------------------------------------------------------------

describe("parsePromptPaths", () => {
  it("extracts all four standard paths from build_prompt output", () => {
    const prompt =
      "The domain is: e-commerce. The skill name is: my-skill. " +
      "The skill type is: domain. " +
      "The workspace directory is: /Users/john.doe/.vibedata/my-skill. " +
      "The context directory is: /home/user/my-skills/my-skill/context. " +
      "The skill output directory (SKILL.md and references/) is: /home/user/my-skills/my-skill. " +
      "All directories already exist.";

    const paths = parsePromptPaths(prompt);
    expect(paths.workspaceDir).toBe(
      "/Users/john.doe/.vibedata/my-skill",
    );
    expect(paths.contextDir).toBe(
      "/home/user/my-skills/my-skill/context",
    );
    expect(paths.skillOutputDir).toBe("/home/user/my-skills/my-skill");
    expect(paths.skillDir).toBeNull(); // not present in this prompt
  });

  it("extracts workspace + context from answer-evaluator prompt", () => {
    const prompt =
      "The workspace directory is: /Users/hb/.vibedata/test-skill. " +
      "The context directory is: /Users/hb/skills/test-skill/context. " +
      "All directories already exist — do not create any directories.";

    const paths = parsePromptPaths(prompt);
    expect(paths.workspaceDir).toBe("/Users/hb/.vibedata/test-skill");
    expect(paths.contextDir).toBe("/Users/hb/skills/test-skill/context");
    expect(paths.skillOutputDir).toBeNull();
  });

  it("handles paths with dots (e.g., john.doe)", () => {
    const prompt =
      "The workspace directory is: /Users/john.doe/workspace/skill. " +
      "The context directory is: /Users/john.doe/skills/skill/context. " +
      "Done.";

    const paths = parsePromptPaths(prompt);
    expect(paths.workspaceDir).toBe("/Users/john.doe/workspace/skill");
    expect(paths.contextDir).toBe("/Users/john.doe/skills/skill/context");
  });

  it("returns null for missing fields", () => {
    const prompt = "Just a simple prompt with no path markers.";
    const paths = parsePromptPaths(prompt);
    expect(paths.workspaceDir).toBeNull();
    expect(paths.contextDir).toBeNull();
    expect(paths.skillOutputDir).toBeNull();
    expect(paths.skillDir).toBeNull();
  });
});

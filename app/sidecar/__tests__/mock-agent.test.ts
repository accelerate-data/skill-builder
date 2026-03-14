import { describe, it, expect } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  buildStructuredMockResult,
  parsePromptPaths,
  resolvePromptPaths,
  resolveStepTemplate,
} from "../mock-agent.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
      "step1-detailed-research",
    );
    expect(resolveStepTemplate("confirm-decisions")).toBe(
      "step2-confirm-decisions",
    );
    expect(resolveStepTemplate("generate-skill")).toBe("step3-generate-skill");
  });

  it("returns null for unknown agents", () => {
    expect(resolveStepTemplate("unknown-agent")).toBeNull();
    expect(resolveStepTemplate(undefined)).toBeNull();
  });

  it("maps undefined agentName + runSource=test to test-evaluator (skill test evaluator)", () => {
    expect(resolveStepTemplate(undefined, { runSource: "test" })).toBe("test-evaluator");
    expect(resolveStepTemplate(undefined, { runSource: "test", skillName: "my-skill" })).toBe("test-evaluator");
  });

  it("returns null for undefined agentName without runSource=test", () => {
    expect(resolveStepTemplate(undefined, { runSource: "workflow" })).toBeNull();
    expect(resolveStepTemplate(undefined, { runSource: undefined })).toBeNull();
    expect(resolveStepTemplate(undefined, {})).toBeNull();
  });

  it("maps data-product-builder to test-plan-with for non-baseline skill names", () => {
    expect(resolveStepTemplate("data-product-builder", { skillName: "my-skill" })).toBe("test-plan-with");
    expect(resolveStepTemplate("data-product-builder", { skillName: "churn-analysis" })).toBe("test-plan-with");
  });

  it("maps data-product-builder to test-plan-without for __test_baseline__ skill name", () => {
    expect(resolveStepTemplate("data-product-builder", { skillName: "__test_baseline__" })).toBe("test-plan-without");
  });

  it("maps data-product-builder to test-plan-without when config is absent", () => {
    // Safe default: no config means treat as baseline
    expect(resolveStepTemplate("data-product-builder", undefined)).toBe("test-plan-without");
    expect(resolveStepTemplate("data-product-builder")).toBe("test-plan-without");
  });

  it("keeps backward-compat for legacy bare test-plan names", () => {
    expect(resolveStepTemplate("test-plan-with")).toBe("test-plan-with");
    expect(resolveStepTemplate("test-plan-without")).toBe("test-plan-without");
    expect(resolveStepTemplate("test-evaluator")).toBe("test-evaluator");
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
      "The workspace directory is: /Users/john.doe/.vibedata/skill-builder/my-skill. " +
      "The context directory is: /home/user/my-skills/my-skill/context. " +
      "The skill output directory (SKILL.md and references/) is: /home/user/my-skills/my-skill. " +
      "All directories already exist.";

    const paths = parsePromptPaths(prompt);
    expect(paths.workspaceDir).toBe(
      "/Users/john.doe/.vibedata/skill-builder/my-skill",
    );
    expect(paths.contextDir).toBe(
      "/home/user/my-skills/my-skill/context",
    );
    expect(paths.skillOutputDir).toBe("/home/user/my-skills/my-skill");
    // When "The skill directory is" is absent, skillDir falls back to skillOutputDir for mock destRoot
    expect(paths.skillDir).toBe("/home/user/my-skills/my-skill");
  });

  it("extracts workspace + context from answer-evaluator prompt", () => {
    const prompt =
      "The workspace directory is: /Users/hb/.vibedata/skill-builder/test-skill. " +
      "The context directory is: /Users/hb/skills/test-skill/context. " +
      "All directories already exist — do not create any directories.";

    const paths = parsePromptPaths(prompt);
    expect(paths.workspaceDir).toBe("/Users/hb/.vibedata/skill-builder/test-skill");
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

  it("extracts inline skill output dir from prompt", () => {
    const prompt =
      "The skill name is: my-skill. The workspace directory is: /Users/john/workspace/my-skill. " +
      "The skill output directory (SKILL.md and references/) is: /Users/john/skills/my-skill. " +
      "Read user-context.md from the workspace directory. " +
      "Derive context_dir as workspace_dir/context.";
    const paths = parsePromptPaths(prompt);
    expect(paths.workspaceDir).toBe("/Users/john/workspace/my-skill");
    expect(paths.contextDir).toBe(path.join("/Users/john/workspace/my-skill", "context"));
    expect(paths.skillOutputDir).toBe("/Users/john/skills/my-skill");
    expect(paths.skillDir).toBe("/Users/john/skills/my-skill");
  });
});

describe("resolvePromptPaths", () => {
  it("resolves skillOutputDir from inline prompt path", () => {
    const prompt =
      "The skill name is: x. The workspace directory is: /tmp/ws/x. " +
      "The skill output directory (SKILL.md and references/) is: /tmp/skills/x. " +
      "Read user-context.md from the workspace directory.";
    const paths = resolvePromptPaths(prompt);
    expect(paths.workspaceDir).toBe("/tmp/ws/x");
    expect(paths.contextDir).toBe(path.join("/tmp/ws/x", "context"));
    expect(paths.skillOutputDir).toBe("/tmp/skills/x");
    expect(paths.skillDir).toBe("/tmp/skills/x");
  });
});

// ---------------------------------------------------------------------------
// mock-agent drift detection
// ---------------------------------------------------------------------------

/**
 * Agents that intentionally have no mock template mapping.
 * If you add a new agent that should be mocked, add a mapping in
 * resolveStepTemplate() — don't just add it here.
 */
const AGENTS_WITHOUT_MOCK = new Set([
  "eval-skill",
  "validate-quality",
  "validate-skill",
]);

describe("mock-agent drift detection", () => {
  it("every agent in agent-sources/agents has a mock template mapping or is explicitly excluded", async () => {
    const agentsDir = path.resolve(__dirname, "../../../agent-sources/agents");
    const files = await fs.readdir(agentsDir);
    const agentNames = files
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));

    expect(agentNames.length).toBeGreaterThan(0);

    const unmapped: string[] = [];
    for (const name of agentNames) {
      const template = resolveStepTemplate(name);
      if (template === null && !AGENTS_WITHOUT_MOCK.has(name)) {
        unmapped.push(name);
      }
    }

    expect(
      unmapped,
      `These agents have no mock template mapping and are not in the exclusion list. ` +
        `Either add a mapping in resolveStepTemplate() or add them to AGENTS_WITHOUT_MOCK:\n` +
        unmapped.join("\n"),
    ).toEqual([]);
  });

  it("each mapped template resolves to a valid template name", async () => {
    const agentsDir = path.resolve(__dirname, "../../../agent-sources/agents");
    const files = await fs.readdir(agentsDir);
    const agentNames = files
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));

    const templateNames = new Set<string>();
    for (const name of agentNames) {
      const template = resolveStepTemplate(name);
      if (template !== null) {
        templateNames.add(template);
      }
    }

    // Each template should have a corresponding .jsonl file in mock-templates/
    const templatesDir = path.resolve(__dirname, "../mock-templates");
    for (const template of templateNames) {
      const jsonlPath = path.join(templatesDir, `${template}.jsonl`);
      let exists = false;
      try {
        await fs.access(jsonlPath);
        exists = true;
      } catch {
        // file doesn't exist
      }
      expect(
        exists,
        `Template "${template}" mapped by resolveStepTemplate() but ` +
          `${template}.jsonl not found in mock-templates/`,
      ).toBe(true);
    }
  });

  it("exclusion list only contains agents that actually exist", async () => {
    const agentsDir = path.resolve(__dirname, "../../../agent-sources/agents");
    const files = await fs.readdir(agentsDir);
    const agentNames = new Set(
      files.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")),
    );

    for (const excluded of AGENTS_WITHOUT_MOCK) {
      expect(
        agentNames.has(excluded),
        `AGENTS_WITHOUT_MOCK contains "${excluded}" but no agent-sources/agents/${excluded}.md exists. ` +
          `Remove it from the exclusion list.`,
      ).toBe(true);
    }
  });
});

describe("buildStructuredMockResult", () => {
  it("returns structured payload for step0-research", async () => {
    const result = await buildStructuredMockResult("step0-research");
    expect(result).not.toBeNull();
    const payload = result as Record<string, unknown>;
    expect(payload.status).toBe("research_complete");
    expect(typeof payload.question_count).toBe("number");
    expect(typeof payload.dimensions_selected).toBe("number");
    expect(typeof payload.research_output).toBe("object");
    const researchOutput = payload.research_output as Record<string, unknown>;
    expect(researchOutput.version).toBe("1");
    expect(typeof researchOutput.metadata).toBe("object");
    expect(Array.isArray(researchOutput.sections)).toBe(true);
    expect(Array.isArray(researchOutput.notes)).toBe(true);
  });

  it("returns structured payload for step2-confirm-decisions", async () => {
    // The mock now returns the raw { version, metadata, decisions } fixture
    // matching the real agent's outputFormat schema (no envelope wrapping).
    const result = await buildStructuredMockResult("step2-confirm-decisions");
    expect(result).not.toBeNull();
    const payload = result as Record<string, unknown>;
    expect(payload.version).toBe("1");
    expect(typeof payload.metadata).toBe("object");
    expect(Array.isArray(payload.decisions)).toBe(true);
  });

  it("returns structured payload for gate-answer-evaluator", async () => {
    const result = await buildStructuredMockResult("gate-answer-evaluator");
    expect(result).not.toBeNull();
    const payload = result as Record<string, unknown>;
    expect(typeof payload.verdict).toBe("string");
    expect(Array.isArray(payload.per_question)).toBe(true);
  });
});

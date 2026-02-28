import { describe, it, expect } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { parsePromptPaths, resolveStepTemplate } from "../mock-agent.js";

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
    expect(paths.skillDir).toBeNull(); // not present in this prompt
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
  "validate-skill",
]);

describe("mock-agent drift detection", () => {
  it("every agent in agents/ has a mock template mapping or is explicitly excluded", async () => {
    const agentsDir = path.resolve(__dirname, "../../../agents");
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
    const agentsDir = path.resolve(__dirname, "../../../agents");
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
    const agentsDir = path.resolve(__dirname, "../../../agents");
    const files = await fs.readdir(agentsDir);
    const agentNames = new Set(
      files.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")),
    );

    for (const excluded of AGENTS_WITHOUT_MOCK) {
      expect(
        agentNames.has(excluded),
        `AGENTS_WITHOUT_MOCK contains "${excluded}" but no agents/${excluded}.md exists. ` +
          `Remove it from the exclusion list.`,
      ).toBe(true);
    }
  });
});

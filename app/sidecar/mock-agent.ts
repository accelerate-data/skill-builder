import type { SidecarConfig } from "./config.js";
import { MessageProcessor } from "./message-processor.js";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Map agent names to step template files.
 *
 * Agents use bare names (e.g., `research-orchestrator`, `generate-skill`,
 * `research-entities`). Shared agents like `detailed-research` and
 * `confirm-decisions` use the same bare names.
 */
/** @internal Exported for testing only. */
export function resolveStepTemplate(
  agentName: string | undefined,
  config?: { skillName?: string },
): string | null {
  if (!agentName) return null;

  // Exact matches first
  if (agentName === "detailed-research") return "step1-detailed-research";
  if (agentName === "confirm-decisions") return "step2-confirm-decisions";
  if (agentName === "generate-skill") return "step3-generate-skill";
  if (agentName === "refine-skill") return "refine";
  if (agentName === "rewrite-skill") return "rewrite-skill";
  if (agentName === "answer-evaluator") return "gate-answer-evaluator";

  // All research-related agents (orchestrator, planner, dimension agents, consolidate)
  if (
    agentName === "research-orchestrator" ||
    agentName === "research-planner" ||
    agentName === "consolidate-research" ||
    agentName.startsWith("research-")
  ) {
    return "step0-research";
  }

  // Skill test agents — invoked with agentName="data-product-builder" (the vd-agent plugin agent).
  // Discriminate with vs. without skill using skillName: baseline runs use "__test_baseline__".
  if (agentName === "data-product-builder") {
    // Use "test-plan-with" only when skillName is a real skill name (not baseline sentinel, not absent).
    // Absent config is the safe default → treat as baseline.
    const skillName = config?.skillName;
    return skillName && skillName !== "__test_baseline__" ? "test-plan-with" : "test-plan-without";
  }

  // Legacy bare names kept for backward compatibility
  if (agentName === "test-plan-with") return "test-plan-with";
  if (agentName === "test-plan-without") return "test-plan-without";
  if (agentName === "test-evaluator") return "test-evaluator";

  return null;
}

/** Map step template name to the outputs subdirectory. */
function getOutputDir(stepTemplate: string): string {
  const stepMap: Record<string, string> = {
    "step0-research": "step0",
    "step1-detailed-research": "step1",
    "step2-confirm-decisions": "step2",
    "step3-generate-skill": "step3",
    "refine": "refine",
    "rewrite-skill": "refine",
    "gate-answer-evaluator": "gate-answer-evaluator",
  };
  return stepMap[stepTemplate] || "";
}

/**
 * Extract directory paths from the agent prompt.
 *
 * Prompt includes all paths inline: workspace_dir, skill output dir, and optionally context_dir.
 * context_dir is derived from workspace_dir/context when not explicit.
 */
/** @internal Exported for testing only. */
export function parsePromptPaths(prompt: string): {
  workspaceDir: string | null;
  contextDir: string | null;
  skillOutputDir: string | null;
  skillDir: string | null;
} {
  const workspaceMatch = prompt.match(
    /The workspace directory is: ([^\n]+?)\.\s/,
  );
  const workspaceDir = workspaceMatch?.[1]?.trim() ?? null;

  const contextMatch = prompt.match(
    /The context directory is: ([^\n]+?)\.\s/,
  );
  const outputMatch = prompt.match(
    /The skill output directory \(SKILL\.md and references\/\) is: ([^\n]+?)\.\s/,
  );
  const skillDirMatch = prompt.match(
    /The skill directory is: ([^\n]+?)\.\s/,
  );

  const contextDir =
    contextMatch?.[1]?.trim() ??
    (workspaceDir !== null ? path.join(workspaceDir, "context") : null);
  const skillOutputDir = outputMatch?.[1]?.trim() ?? null;

  return {
    workspaceDir,
    contextDir,
    skillOutputDir,
    skillDir: skillDirMatch?.[1]?.trim() ?? skillOutputDir ?? null,
  };
}

/**
 * Resolve all paths from the prompt. Paths are now inline in the prompt string.
 */
export async function resolvePromptPathsAsync(prompt: string): Promise<{
  workspaceDir: string | null;
  contextDir: string | null;
  skillOutputDir: string | null;
  skillDir: string | null;
}> {
  return parsePromptPaths(prompt);
}

/** Check if a path exists (async replacement for fs.existsSync). */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a mock agent that replays pre-recorded JSONL messages and writes
 * mock output files to disk. Used when `MOCK_AGENTS=true` is set.
 */
export async function runMockAgent(
  config: SidecarConfig,
  onMessage: (message: Record<string, unknown>) => void,
  externalSignal?: AbortSignal,
): Promise<void> {
  const stepTemplate = resolveStepTemplate(config.agentName, config);

  if (!stepTemplate) {
    // Unknown agent — emit a simple success result
    onMessage({ type: "system", subtype: "init_start", timestamp: Date.now() });
    await delay(50);
    onMessage({ type: "system", subtype: "sdk_ready", timestamp: Date.now() });
    await delay(50);
    onMessage({
      type: "result",
      subtype: "success",
      result: "Mock: unknown agent, skipped",
      is_error: false,
      duration_ms: 100,
      duration_api_ms: 0,
      num_turns: 0,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    return;
  }

  // 1. Write mock output files to disk
  await writeMockOutputFiles(stepTemplate, config);

  // 2. Stream JSONL template messages
  const templatePath = path.join(
    __dirname,
    "mock-templates",
    `${stepTemplate}.jsonl`,
  );

  if (!(await pathExists(templatePath))) {
    // No template file — emit minimal success
    onMessage({ type: "system", subtype: "init_start", timestamp: Date.now() });
    await delay(50);
    onMessage({ type: "system", subtype: "sdk_ready", timestamp: Date.now() });
    await delay(50);
    onMessage({
      type: "result",
      subtype: "success",
      result: `Mock: ${stepTemplate} completed (no template file)`,
      is_error: false,
      duration_ms: 100,
      duration_api_ms: 0,
      num_turns: 0,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    return;
  }

  const content = await fs.readFile(templatePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());
  const structuredResultOverride = await buildStructuredMockResult(stepTemplate);

  // Process mock template messages through MessageProcessor identically to live SDK
  const processor = new MessageProcessor();

  let emittedResult = false;
  for (const line of lines) {
    if (externalSignal?.aborted) {
      const cancelMsg: Record<string, unknown> = {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["Mock agent cancelled"],
        duration_ms: 0,
        duration_api_ms: 0,
        num_turns: 0,
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
      const items = processor.process(cancelMsg);
      for (const item of items) {
        onMessage(item as Record<string, unknown>);
      }
      emittedResult = true;
      break;
    }

    try {
      const message = JSON.parse(line) as Record<string, unknown>;
      // Update timestamp to current time
      if (message.timestamp) {
        message.timestamp = Date.now();
      }
      if (message.type === "result") {
        if (structuredResultOverride !== null) {
          // Match real SDK behavior: structured JSON in structured_output, text summary in result.
          message.structured_output = structuredResultOverride;
          message.result = `Mock: ${stepTemplate} completed`;
        }
        emittedResult = true;
      }
      // Process through MessageProcessor for display items
      const items = processor.process(message);
      for (const item of items) {
        onMessage(item as Record<string, unknown>);
      }
      // Short delay between messages for realistic UI streaming
      await delay(100);
    } catch {
      process.stderr.write(
        `[mock-agent] Skipping malformed JSONL line: ${line.substring(0, 100)}\n`,
      );
    }
  }

  // Safety net: always emit a result so the UI doesn't hang
  if (!emittedResult) {
    const safetyResult: Record<string, unknown> = {
      type: "result",
      subtype: "success",
      result: `Mock: ${stepTemplate} completed`,
      is_error: false,
      duration_ms: 100,
      duration_api_ms: 0,
      num_turns: 1,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    const items = processor.process(safetyResult);
    for (const item of items) {
      onMessage(item as Record<string, unknown>);
    }
  }
}

/**
 * Copy mock output files from the bundled templates into the workspace
 * so that `verify_step_output` finds them and the workflow can advance.
 */
async function writeMockOutputFiles(
  stepTemplate: string,
  config: SidecarConfig,
): Promise<void> {
  const outputDir = getOutputDir(stepTemplate);
  const srcDir = path.join(__dirname, "mock-templates", "outputs", outputDir);

  if (!(await pathExists(srcDir))) return;

  const paths = await resolvePromptPathsAsync(config.prompt);

  // Determine the destination root for this step's files.
  //
  // Step 5 writes SKILL.md + references/ to the "skill output directory".
  // All other steps write context/ files relative to the "skill directory"
  // (or use the context directory's parent, which is the skill directory).
  let destRoot: string;

  if (stepTemplate === "gate-answer-evaluator") {
    // Gate: answer-evaluation.json is an internal file written to the workspace directory.
    destRoot = paths.workspaceDir ?? config.cwd;
  } else if (stepTemplate === "refine-skill") {
    // Refine: files go directly to cwd (the skill directory)
    destRoot = config.cwd;
  } else if (stepTemplate === "step3-generate-skill") {
    // Step 3: files go to skill output dir (may differ from skill dir when skills_path is set)
    destRoot = paths.skillOutputDir ?? paths.skillDir ?? config.cwd;
  } else {
    // Steps 0, 1, 2: context files go under the skill directory.
    // The mock template has outputs/{stepN}/context/... so we strip the
    // "context/" prefix by writing to the skill dir (the parent of context/).
    if (paths.contextDir) {
      destRoot = path.dirname(paths.contextDir);
    } else {
      destRoot = paths.skillDir ?? config.cwd;
    }
  }

  await copyDirRecursive(srcDir, destRoot);
}

/** Recursively copy a directory tree, creating parents as needed. */
async function copyDirRecursive(src: string, dest: string): Promise<void> {
  if (!(await pathExists(src))) return;

  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(srcPath, destPath);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type JsonObject = Record<string, unknown>;

async function readJsonIfExists(filePath: string): Promise<JsonObject | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : null;
  } catch {
    return null;
  }
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/** @internal Exported for testing only. */
export async function buildStructuredMockResult(
  stepTemplate: string,
): Promise<unknown | null> {
  const outputsRoot = path.join(__dirname, "mock-templates", "outputs");
  if (stepTemplate === "step0-research") {
    const clarifications = await readJsonIfExists(
      path.join(outputsRoot, "step0", "context", "clarifications.json"),
    );
    if (!clarifications) return null;
    const metadata =
      clarifications.metadata &&
      typeof clarifications.metadata === "object" &&
      !Array.isArray(clarifications.metadata)
        ? (clarifications.metadata as JsonObject)
        : {};
    const researchPlan =
      metadata.research_plan &&
      typeof metadata.research_plan === "object" &&
      !Array.isArray(metadata.research_plan)
        ? (metadata.research_plan as JsonObject)
        : {};
    const questionCount =
      typeof metadata.question_count === "number" ? metadata.question_count : 0;
    const dimensionsSelected =
      typeof researchPlan.dimensions_selected === "number"
        ? researchPlan.dimensions_selected
        : 0;
    return {
      status: "research_complete",
      dimensions_selected: dimensionsSelected,
      question_count: questionCount,
      research_output: clarifications,
    };
  }

  if (stepTemplate === "step1-detailed-research") {
    const clarifications = await readJsonIfExists(
      path.join(outputsRoot, "step1", "context", "clarifications.json"),
    );
    if (!clarifications) return null;
    const metadata =
      clarifications.metadata &&
      typeof clarifications.metadata === "object" &&
      !Array.isArray(clarifications.metadata)
        ? (clarifications.metadata as JsonObject)
        : {};
    const refinementCount =
      typeof metadata.refinement_count === "number"
        ? metadata.refinement_count
        : 0;
    const sectionCount =
      typeof metadata.section_count === "number" ? metadata.section_count : 0;
    return {
      status: "detailed_research_complete",
      refinement_count: refinementCount,
      section_count: sectionCount,
      clarifications_json: clarifications,
    };
  }

  if (stepTemplate === "step2-confirm-decisions") {
    const decisions = await readJsonIfExists(
      path.join(outputsRoot, "step2", "context", "decisions.json"),
    );
    if (!decisions) return null;
    const metadata =
      decisions.metadata &&
      typeof decisions.metadata === "object" &&
      !Array.isArray(decisions.metadata)
        ? (decisions.metadata as JsonObject)
        : {};
    const decisionsArray = Array.isArray(decisions.decisions)
      ? decisions.decisions
      : [];
    const decisionCount =
      typeof metadata.decision_count === "number"
        ? metadata.decision_count
        : decisionsArray.length;
    const conflictsResolved =
      typeof metadata.conflicts_resolved === "number"
        ? metadata.conflicts_resolved
        : 0;
    const round = typeof metadata.round === "number" ? metadata.round : 1;
    return {
      status: "confirm_decisions_complete",
      decision_count: decisionCount,
      conflicts_resolved: conflictsResolved,
      round,
      decisions_json: decisions,
    };
  }

  if (stepTemplate === "gate-answer-evaluator") {
    return readJsonIfExists(
      path.join(outputsRoot, "gate-answer-evaluator", "answer-evaluation.json"),
    );
  }

  return null;
}

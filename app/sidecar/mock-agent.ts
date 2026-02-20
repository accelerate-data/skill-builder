import type { SidecarConfig } from "./config.js";
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
export function resolveStepTemplate(agentName: string | undefined): string | null {
  if (!agentName) return null;

  // Exact matches first
  if (agentName === "detailed-research") return "step2-detailed-research";
  if (agentName === "confirm-decisions") return "step4-confirm-decisions";
  if (agentName === "generate-skill") return "step5-generate-skill";
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

  return null;
}

/** Map step template name to the outputs subdirectory. */
function getOutputDir(stepTemplate: string): string {
  const stepMap: Record<string, string> = {
    "step0-research": "step0",
    "step2-detailed-research": "step2",
    "step4-confirm-decisions": "step4",
    "step5-generate-skill": "step5",
    "refine": "refine",
    "rewrite-skill": "refine",
    "gate-answer-evaluator": "gate-answer-evaluator",
  };
  return stepMap[stepTemplate] || "";
}

/**
 * Extract directory paths from the agent prompt.
 *
 * The Rust backend injects these into every prompt:
 *   "The context directory is: /path/to/context."
 *   "The skill output directory (SKILL.md and references/) is: /path/to/output."
 *   "The skill directory is: /path/to/skill."
 */
/** @internal Exported for testing only. */
export function parsePromptPaths(prompt: string): {
  workspaceDir: string | null;
  contextDir: string | null;
  skillOutputDir: string | null;
  skillDir: string | null;
} {
  // Use [^\n]+ to capture paths that may contain dots (e.g., /Users/john.doe/)
  const workspaceMatch = prompt.match(
    /The workspace directory is: ([^\n]+?)\.\s/,
  );
  const contextMatch = prompt.match(
    /The context directory is: ([^\n]+?)\.\s/,
  );
  const outputMatch = prompt.match(
    /The skill output directory \(SKILL\.md and references\/\) is: ([^\n]+?)\.\s/,
  );
  const skillDirMatch = prompt.match(
    /The skill directory is: ([^\n]+?)\.\s/,
  );

  return {
    workspaceDir: workspaceMatch?.[1]?.trim() ?? null,
    contextDir: contextMatch?.[1]?.trim() ?? null,
    skillOutputDir: outputMatch?.[1]?.trim() ?? null,
    skillDir: skillDirMatch?.[1]?.trim() ?? null,
  };
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
  const stepTemplate = resolveStepTemplate(config.agentName);

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

  let emittedResult = false;
  for (const line of lines) {
    if (externalSignal?.aborted) {
      onMessage({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["Mock agent cancelled"],
        duration_ms: 0,
        duration_api_ms: 0,
        num_turns: 0,
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
      });
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
        emittedResult = true;
      }
      onMessage(message);
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
    onMessage({
      type: "result",
      subtype: "success",
      result: `Mock: ${stepTemplate} completed`,
      is_error: false,
      duration_ms: 100,
      duration_api_ms: 0,
      num_turns: 1,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    });
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

  const paths = parsePromptPaths(config.prompt);

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
  } else if (stepTemplate === "step5-generate-skill") {
    // Step 5: files go to skill output dir (may differ from skill dir when skills_path is set)
    destRoot = paths.skillOutputDir ?? paths.skillDir ?? config.cwd;
  } else {
    // Steps 0, 2, 4: context files go under the skill directory.
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

import type { SidecarConfig } from "./config.js";
import { MessageProcessor } from "./message-processor.js";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Active mock scenario. Set `MOCK_SCENARIO=contradictory` to exercise the
 * contradictory-answer gate flow in step 0 without live API calls.
 */
const MOCK_SCENARIO = process.env.MOCK_SCENARIO ?? "default";

/**
 * Map agent names to step template files.
 *
 * Plugin-hosted agents use qualified names (e.g., `skill-creator:generate-skill`,
 * `skill-content-researcher:research-orchestrator`,
 * `skill-content-researcher:detailed-research`,
 * `skill-content-researcher:confirm-decisions`).
 */
/** @internal Exported for testing only. */
export function resolveStepTemplate(
  agentName: string | undefined,
  config?: { skillName?: string; runSource?: string },
): string | null {
  if (!agentName) {
    // Eval generator: invoked without a plugin agentName; identified by skillName.
    if (config?.skillName === "skill-evals-generator" || config?.skillName === "eval-generator") return "eval-generator";
    // Test evaluator: invoked without a plugin agentName; identified by runSource="test".
    // The with/without plan agents always have agentName="data-product-builder", so this
    // branch is only reached for the evaluator.
    if (config?.runSource === "test") return "test-evaluator";
    return null;
  }

  // Exact matches first
  if (agentName === "skill-content-researcher:detailed-research") return "step1-detailed-research";
  if (agentName === "skill-content-researcher:confirm-decisions") return "step2-confirm-decisions";
  if (agentName === "skill-creator:generate-skill") return "step3-generate-skill";
  if (agentName === "skill-creator:rewrite-skill") return "rewrite-skill";
  if (agentName === "skill-creator:grader" || agentName === "evaluate-skill") return "evaluate-skill";
  if (agentName === "answer-evaluator") return MOCK_SCENARIO === "contradictory" ? "gate-answer-evaluator-contradictory" : "gate-answer-evaluator";

  // Research orchestrator (plugin-qualified) and all sub-agents spawned by the research skill
  if (
    agentName === "skill-content-researcher:research-orchestrator" ||
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

  return null;
}

/** Map step template name to the outputs subdirectory. */
function getOutputDir(stepTemplate: string): string {
  const stepMap: Record<string, string> = {
    "step0-research": MOCK_SCENARIO === "contradictory" ? "step0-contradictory" : "step0",
    "step1-detailed-research": "step1",
    "step2-confirm-decisions": "step2",
    "step3-generate-skill": "step3",
    "rewrite-skill": "refine",
    "gate-answer-evaluator": MOCK_SCENARIO === "contradictory" ? "gate-answer-evaluator-contradictory" : "gate-answer-evaluator",
    "eval-generator": "eval-generator",
    "evaluate-skill": "benchmark",
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
    /The workspace directory is: ([^\r\n]+?)\.\s/,
  );
  const workspaceDir = workspaceMatch?.[1]?.trim() ?? null;

  const contextMatch = prompt.match(
    /The context directory is: ([^\r\n]+?)\.\s/,
  );
  const outputMatch = prompt.match(
    /The skill output directory \(SKILL\.md and references\/\) is: ([^\r\n]+?)\.\s/,
  );
  const skillDirMatch = prompt.match(
    /The skill directory is: ([^\r\n]+?)\.\s/,
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
 * Determine the next iteration number for mock eval runs.
 * Scans existing `iteration-*` dirs under `{skillWorkspace}/evals/iterations/`
 * and returns max + 1, or 1 if none exist.
 */
async function getNextMockIterationNumber(skillWorkspace: string): Promise<number> {
  const wsDir = path.join(skillWorkspace, "evals", "workspace");
  try {
    const entries = await fs.readdir(wsDir, { withFileTypes: true });
    let max = 0;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const match = entry.name.match(/^iteration-(\d+)$/);
        if (match) max = Math.max(max, parseInt(match[1], 10));
      }
    }
    return max + 1;
  } catch {
    return 1;
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
    // Unknown agent — emit a simple success result through processor for run_summary
    onMessage({ type: "system", subtype: "init_start", timestamp: Date.now() });
    await delay(50);
    onMessage({ type: "system", subtype: "sdk_ready", timestamp: Date.now() });
    await delay(50);
    const unknownProcessor = new MessageProcessor({
      skillName: config.skillName,
      stepId: config.stepId,
      workflowSessionId: config.workflowSessionId,
      usageSessionId: config.usageSessionId,
      runSource: config.runSource,
    });
    const resultMsg: Record<string, unknown> = {
      type: "result",
      subtype: "success",
      result: "Mock: unknown agent, skipped",
      is_error: false,
      duration_ms: 100,
      duration_api_ms: 0,
      num_turns: 0,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    for (const item of unknownProcessor.process(resultMsg)) {
      onMessage(item as Record<string, unknown>);
    }
    return;
  }

  // 1. Write mock output files to disk (returns iteration number for evaluate-skill)
  const mockIterationNumber = await writeMockOutputFiles(stepTemplate, config);

  // 2. Stream JSONL template messages
  const templatePath = path.join(
    __dirname,
    "mock-templates",
    `${stepTemplate}.jsonl`,
  );

  if (!(await pathExists(templatePath))) {
    // No template file — emit minimal success through processor for run_summary
    onMessage({ type: "system", subtype: "init_start", timestamp: Date.now() });
    await delay(50);
    onMessage({ type: "system", subtype: "sdk_ready", timestamp: Date.now() });
    await delay(50);
    const noTemplateProcessor = new MessageProcessor({
      skillName: config.skillName,
      stepId: config.stepId,
      workflowSessionId: config.workflowSessionId,
      usageSessionId: config.usageSessionId,
      runSource: config.runSource,
    });
    const resultMsg: Record<string, unknown> = {
      type: "result",
      subtype: "success",
      result: `Mock: ${stepTemplate} completed (no template file)`,
      is_error: false,
      duration_ms: 100,
      duration_api_ms: 0,
      num_turns: 0,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    for (const item of noTemplateProcessor.process(resultMsg)) {
      onMessage(item as Record<string, unknown>);
    }
    return;
  }

  const content = await fs.readFile(templatePath, "utf-8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const structuredResultOverride = await buildStructuredMockResult(stepTemplate, config, mockIterationNumber);

  // Process mock template messages through MessageProcessor identically to live SDK
  const processor = new MessageProcessor({
    skillName: config.skillName,
    stepId: config.stepId,
    workflowSessionId: config.workflowSessionId,
    usageSessionId: config.usageSessionId,
    runSource: config.runSource,
  });

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
 *
 * Returns the iteration number used for evaluate-skill (or undefined for other steps).
 */
export async function writeMockOutputFiles(
  stepTemplate: string,
  config: SidecarConfig,
): Promise<number | undefined> {
  const outputDir = getOutputDir(stepTemplate);
  // No output directory mapped for this template (e.g. test-evaluator, test-plan-*) — nothing to copy.
  if (!outputDir) return;

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
    destRoot = paths.workspaceDir ?? config.workspaceSkillDir;
  } else if (stepTemplate === "step3-generate-skill") {
    // Step 3: files go to skill output dir (may differ from skill dir when skills_path is set)
    destRoot = paths.skillOutputDir ?? paths.skillDir ?? config.workspaceSkillDir;
  } else if (stepTemplate === "eval-generator") {
    // Eval generator: pending-eval.json goes to {skills_path}/{skill}/evals/
    // Extract the evals directory from the absolute path embedded in the prompt.
    const match = config.prompt?.match(/`([^`]+)\/pending-eval\.json`/);
    destRoot = match ? match[1] : config.workspaceSkillDir;
  } else if (stepTemplate === "evaluate-skill") {
    // Evaluate-skill: grading files go into the iteration directory created by Rust.
    // Extract iter_dir from the prompt — it already contains the plugin-aware path.
    // iter_dir = {skillWorkspace}/evals/iterations/iteration-{N}/
    // destRoot  = three dirname() calls up → {skillWorkspace}
    // iter_dir lives in the SYSTEM prompt (key-value block), not the user prompt
    const iterMatch = (config.systemPrompt ?? config.prompt)?.match(/iter_dir:\s*(.+)/);
    const iterDir = iterMatch?.[1]?.trim();
    if (iterDir) {
      destRoot = path.dirname(path.dirname(path.dirname(iterDir)));
      const iterNum = parseInt(path.basename(iterDir).replace("iteration-", ""), 10) || 1;
      const rewriteFrom = iterNum !== 1 ? "iteration-1" : null;
      const rewriteTo = iterNum !== 1 ? `iteration-${iterNum}` : null;
      await copyDirRecursive(srcDir, destRoot, rewriteFrom, rewriteTo);
      return iterNum;
    }
    // Fallback: iter_dir not found in prompt — skip file copy.
    return 1;
  } else {
    // Steps 0, 1, 2: context files go under the skill directory.
    // The mock template has outputs/{stepN}/context/... so we strip the
    // "context/" prefix by writing to the skill dir (the parent of context/).
    if (paths.contextDir) {
      destRoot = path.dirname(paths.contextDir);
    } else {
      destRoot = paths.skillDir ?? config.workspaceSkillDir;
    }
  }

  await copyDirRecursive(srcDir, destRoot);
  return undefined;
}

/**
 * Recursively copy a directory tree, creating parents as needed.
 * When `rewriteFrom`/`rewriteTo` are provided, directory names matching
 * `rewriteFrom` are renamed to `rewriteTo`, and JSON file content has
 * all occurrences of `rewriteFrom` replaced with `rewriteTo`.
 * This is used to increment mock iteration directories so eval history
 * is never overwritten.
 */
async function copyDirRecursive(
  src: string,
  dest: string,
  rewriteFrom?: string | null,
  rewriteTo?: string | null,
): Promise<void> {
  if (!(await pathExists(src))) return;

  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destName = (rewriteFrom && rewriteTo && entry.name === rewriteFrom)
      ? rewriteTo
      : entry.name;
    const destPath = path.join(dest, destName);

    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyDirRecursive(srcPath, destPath, rewriteFrom, rewriteTo);
    } else {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      if (rewriteFrom && rewriteTo && entry.name.endsWith(".json")) {
        // Rewrite iteration references inside JSON files (grading paths, iteration field)
        let content = await fs.readFile(srcPath, "utf-8");
        content = content.replaceAll(rewriteFrom, rewriteTo);
        await fs.writeFile(destPath, content, "utf-8");
      } else {
        await fs.copyFile(srcPath, destPath);
      }
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
  config?: SidecarConfig,
  mockIterationNumber?: number,
): Promise<unknown | null> {
  const outputsRoot = path.join(__dirname, "mock-templates", "outputs");
  if (stepTemplate === "step0-research") {
    const step0Dir = MOCK_SCENARIO === "contradictory" ? "step0-contradictory" : "step0";
    const clarifications = await readJsonIfExists(
      path.join(outputsRoot, step0Dir, "context", "clarifications.json"),
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
    // The real agent returns { version, metadata, decisions } matching the
    // outputFormat schema. Materialization writes the entire payload as
    // decisions.json, so the mock must return the same shape — no envelope.
    const decisions = await readJsonIfExists(
      path.join(outputsRoot, "step2", "context", "decisions.json"),
    );
    if (!decisions) return null;
    return decisions;
  }

  if (stepTemplate === "step3-generate-skill") {
    const skillMd = await readTextIfExists(
      path.join(outputsRoot, "step3", "SKILL.md"),
    );
    if (!skillMd) return null;
    return {
      status: "generated",
      commit_summary: "Create initial skill with SKILL.md and reference files",
      version_bump: "minor",
      call_trace: ["read-user-context", "write-skill", "write-evals"],
    };
  }

  if (stepTemplate === "rewrite-skill") {
    return {
      status: "rewritten",
      commit_summary: "Improve error handling patterns and update testing references",
      version_bump: "minor",
      call_trace: ["read-user-context", "read-existing-skill", "rewrite-skill"],
    };
  }

  if (stepTemplate === "gate-answer-evaluator" || stepTemplate === "gate-answer-evaluator-contradictory") {
    const dir = stepTemplate === "gate-answer-evaluator-contradictory" ? "gate-answer-evaluator-contradictory" : "gate-answer-evaluator";
    return readJsonIfExists(
      path.join(outputsRoot, dir, "answer-evaluation.json"),
    );
  }

  if (stepTemplate === "evaluate-skill") {
    // The benchmark is computed by Rust from grading files — the agent only
    // signals completion. Mock grading files are already copied by writeMockOutputFiles.
    const iterNum = mockIterationNumber ?? 1;

    // Write mock analyst-notes.json to the iteration directory so Rust can read it.
    const iterMatch = (config?.systemPrompt ?? config?.prompt)?.match(/iter_dir:\s*(.+)/);
    const iterDir = iterMatch?.[1]?.trim();
    if (iterDir) {
      const analystNotes = [
        "Eval 3 (snapshot SCD2): with-skill scores 75% vs 50% without \u2014 the skill adds correct target_schema but misses NULL handling in check columns.",
        "Eval 4 (incremental model): with-skill scores 50% vs 25% without \u2014 incremental strategy is correct but is_incremental() guard and directory convention are missing.",
        "The skill provides +25% improvement on aggregate pass rate (62.5% vs 37.5%) but still has significant gaps.",
      ];
      await fs.mkdir(iterDir, { recursive: true });
      await fs.writeFile(
        path.join(iterDir, "analyst-notes.json"),
        JSON.stringify(analystNotes, null, 2),
        "utf-8",
      );
    }

    return {
      type: "complete",
      iteration: iterNum,
    };
  }

  return null;
}

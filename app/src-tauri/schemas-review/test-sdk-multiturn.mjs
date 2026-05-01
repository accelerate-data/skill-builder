/**
 * Test: does the Agent SDK return structured_output for each step's inline schema?
 *
 * Pass criteria (in order):
 * 1. structured_output is present (SDK enforced)
 * 2. Rust serde accepts that structured_output for the step contract
 *
 * Missing structured_output is a failure; the app no longer parses result text
 * as a recovery path for outputFormat runs.
 *
 * Usage:
 *   cd app
 *   node src-tauri/schemas-review/test-sdk-multiturn.mjs              # all steps
 *   node src-tauri/schemas-review/test-sdk-multiturn.mjs --step 0
 *   node src-tauri/schemas-review/test-sdk-multiturn.mjs --model <provider-model-id>
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const tauriDir = join(repoRoot, "app", "src-tauri");

// ─── Load .env if present ───────────────────────────────────────────────────

const envPath = join(repoRoot, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

// ─── Args ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const modelId = getArg("model", null);
const stepArg = getArg("step", "all");

if (!modelId) {
  console.error("Pass --model with a provider model ID from Settings.");
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set. Set it or add to .env at repo root.");
  process.exit(1);
}

// ─── Load generated schemas ─────────────────────────────────────────────────

const schemasDir = join(
  repoRoot,
  "agent-sources/plugins/skill-content-researcher/shared/output-schemas"
);

function loadSchema(filename) {
  const p = join(schemasDir, filename);
  if (!existsSync(p)) {
    console.error(`Schema not found: ${p}\nRun 'cargo run --bin codegen' first.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(p, "utf-8"));
}

// ─── Rust serde validation ──────────────────────────────────────────────────

// Use pre-compiled binary to avoid per-call cargo recompilation (slow + file lock contention).
// Build first with: cd app/src-tauri && cargo build --bin validate-output
const validateBin = join(tauriDir, "target", "debug", "validate-output.exe");
const validateBinUnix = join(tauriDir, "target", "debug", "validate-output");
const validateBinPath = existsSync(validateBin) ? validateBin : validateBinUnix;

if (!existsSync(validateBinPath)) {
  console.error(
    `validate-output binary not found at ${validateBinPath}\n` +
    `Build it first: cd app/src-tauri && cargo build --bin validate-output`
  );
  process.exit(1);
}

function validateWithRust(stepId, jsonText) {
  try {
    const result = execSync(
      `"${validateBinPath}" --step ${stepId}`,
      {
        input: jsonText,
        encoding: "utf-8",
        timeout: 10_000,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    return { ok: true, output: result };
  } catch (err) {
    return { ok: false, error: (err.stderr || err.message || "").trim() };
  }
}

// ─── Steps ──────────────────────────────────────────────────────────────────

const SYSTEM =
  "CRITICAL — your final message MUST be ONLY a raw JSON object. " +
  "No markdown, no explanation, no summary, no code fences, no wrapping text. " +
  "Do not use ```json blocks. Output ONLY valid JSON that conforms to the output schema. " +
  "If you write anything other than a valid JSON object the system will REJECT your output.";

const steps = [
  {
    id: "0",
    name: "Step 0: ResearchStepOutput",
    schema: loadSchema("step-0-research.json"),
    prompt:
      SYSTEM + "\n\n" +
      "Return a ResearchStepOutput JSON object with: " +
      'status "research_complete", dimensions_selected 3, question_count 1, ' +
      "research_output: a ClarificationsFile with version '1', " +
      "metadata (question_count 1, section_count 1, refinement_count 0, must_answer_count 1, priority_questions ['Q1'], " +
      "research_plan: purpose 'domain', domain 'test', topic_relevance 'relevant', " +
      "dimensions_evaluated 3, dimensions_selected 3, " +
      "dimension_scores [{name:'d1',score:5,reason:'r',focus:'f'}], " +
      "selected_dimensions [{name:'d1',focus:'f'}]), " +
      "sections: [{id:1,title:'S1',questions:[{id:'Q1',title:'T',text:'Q?',must_answer:true," +
      "choices:[{id:'A',text:'Yes',is_other:false}],refinements:[]}]}], notes: [], answer_evaluator_notes: [].",
  },
  {
    id: "1",
    name: "Step 1: DetailedResearchOutput",
    schema: loadSchema("step-1-detailed-research.json"),
    prompt:
      SYSTEM + "\n\n" +
      "Return a DetailedResearchOutput JSON object with: " +
      'status "detailed_research_complete", refinement_count 0, section_count 1, ' +
      "clarifications_json: a ClarificationsFile with version '1', " +
      "metadata (question_count 1, section_count 1, refinement_count 0, must_answer_count 1, priority_questions ['Q1']), " +
      "sections: [{id:1,title:'S1',questions:[{id:'Q1',title:'T',text:'Q?',must_answer:true," +
      "choices:[{id:'A',text:'Yes',is_other:false}],refinements:[]}]}], notes: [], answer_evaluator_notes: [].",
  },
  {
    id: "2",
    name: "Step 2: DecisionsOutput",
    schema: loadSchema("step-2-decisions.json"),
    prompt:
      SYSTEM + "\n\n" +
      "Return a DecisionsOutput JSON object with: " +
      'version "1", metadata (decision_count 1, conflicts_resolved 0, round 1), ' +
      'decisions: [{id:"D1",title:"T",original_question:"Q?",decision:"D",implication:"I",status:"resolved"}].',
  },
];

// ─── Runner ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

const toRun = stepArg === "all" ? steps : steps.filter((s) => s.id === stepArg);
if (toRun.length === 0) {
  console.error(`Unknown step: ${stepArg}. Use 0, 1, 2, or all.`);
  process.exit(1);
}

console.log(`Schemas: ${schemasDir}`);
console.log(`Model:   ${modelId}`);
console.log(`Steps:   ${toRun.map((s) => s.id).join(", ")}\n`);

const outDir = join(__dirname, "test-results");
mkdirSync(outDir, { recursive: true });

for (const step of toRun) {
  console.log(`── ${step.name} ──`);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 90_000);
  let result = null;

  try {
    for await (const msg of query({
      prompt: step.prompt,
      options: {
        model: modelId,
        outputFormat: { type: "json_schema", schema: step.schema },
        maxTurns: 3,
        permissionMode: "bypassPermissions",
        abortController: abort,
      },
    })) {
      if (msg.type === "result") result = msg;
    }
  } catch (err) {
    console.log(`  ERROR: ${err.message}\n`);
    failed++;
    continue;
  } finally {
    clearTimeout(timer);
  }

  if (!result) {
    console.log("  \x1b[31mFAIL\x1b[0m  no result message\n");
    failed++;
    continue;
  }

  const hasStructured = result.structured_output != null;
  console.log(`  structured_output: ${hasStructured ? "present (SDK enforced)" : "missing"}`);
  console.log(`  subtype: ${result.subtype}`);

  if (!hasStructured) {
    console.log(`  \x1b[31mFAIL\x1b[0m  structured_output missing`);
    writeFileSync(join(outDir, `step-${step.id}-failed.txt`), String(result.result ?? ""));
    failed++;
  } else {
    const jsonText = JSON.stringify(result.structured_output, null, 2);
    console.log(`  Validating structured_output with Rust serde...`);

    const validation = validateWithRust(step.id, jsonText);
    if (validation.ok) {
      console.log(`  \x1b[32mPASS\x1b[0m  structured_output present and valid`);
      writeFileSync(join(outDir, `step-${step.id}.json`), jsonText);
      passed++;
    } else {
      console.log(`  \x1b[31mFAIL\x1b[0m  Rust serde rejected structured_output`);
      console.log(`  ${validation.error.trim()}`);
      writeFileSync(join(outDir, `step-${step.id}-failed.json`), jsonText);
      failed++;
    }
  }
  console.log("");
}

// ─── Summary ────────────────────────────────────────────────────────────────

const c = failed === 0 ? "\x1b[32m" : "\x1b[31m";
console.log(`${c}${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) process.exit(1);

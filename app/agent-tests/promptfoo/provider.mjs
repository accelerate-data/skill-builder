import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allTrue,
  assessAnswerEvaluationSchema,
  assessClarificationsSchema,
  assessDecisionsJsonSchema,
  assessInvocationContracts,
  parseFrontmatter,
} from "./assertions/contracts.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const AGENTS_DIR = path.join(REPO_ROOT, "agent-sources", "agents");
const PLUGINS_DIR = path.join(REPO_ROOT, "agent-sources", "plugins");
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const DEFAULT_SKILL_NAME = "pet-store-analytics";

function parseBudget(...candidates) {
  for (const value of candidates) {
    if (value === "none") return null;
    if (value != null && value !== "") return value;
  }
  return null;
}

function makeTempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `skill-builder-promptfoo-${label}-`));
}

function hasApiAccess() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.FORCE_PLUGIN_TESTS);
}

function runAgent(prompt, { budgetUsd, timeoutMs, cwd }) {
  const env = { ...process.env, CLAUDECODE: undefined };
  const budgetArgs = budgetUsd != null ? ["--max-budget-usd", budgetUsd] : [];
  const modelArgs = process.env.AGENTS_TEST_MODEL
    ? ["--model", process.env.AGENTS_TEST_MODEL]
    : [];

  const result = spawnSync(
    CLAUDE_BIN,
    ["-p", "--dangerously-skip-permissions", ...modelArgs, ...budgetArgs],
    {
      input: prompt,
      encoding: "utf8",
      cwd,
      env,
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  if (result.error) {
    throw new Error(`runAgent process error: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    const stdout = (result.stdout ?? "").trim();
    throw new Error(
      `runAgent exited with status ${result.status}\nstdout: ${stdout}\nstderr: ${stderr}`
    );
  }
  return (result.stdout ?? "").trim();
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeSessionJson(dir, skillName, phase) {
  writeFile(
    path.join(dir, "workspace", skillName, "session.json"),
    JSON.stringify(
      {
        skill_name: skillName,
        skill_type: "domain",
        domain: "Pet Store Analytics",
        skill_dir: `./${skillName}/`,
        created_at: "2026-01-01T00:00:00Z",
        last_activity: "2026-01-01T01:00:00Z",
        current_phase: phase,
        phases_completed: [],
        mode: "guided",
        research_dimensions_used: ["entities", "metrics"],
        clarification_status: { total_questions: 6, answered: 0 },
        auto_filled: false,
        iterative_history: [],
      },
      null,
      2
    )
  );
}

function makeSkillDirs(dir, skillName) {
  fs.mkdirSync(path.join(dir, "workspace", skillName, "context"), { recursive: true });
  fs.mkdirSync(path.join(dir, skillName, "references"), { recursive: true });
}

function writeUserContext(dir, skillName) {
  writeFile(
    path.join(dir, "workspace", skillName, "user-context.md"),
    `# User Context

- **Industry**: Retail / E-commerce
- **Function**: Analytics Engineering
- **Target Audience**: Intermediate data engineers building dbt models
- **Key Challenges**: Handling seasonal spikes, multi-location inventory reconciliation
- **Scope**: Silver and gold layer dbt modeling for pet store operations
- **What Makes This Setup Unique**: Multi-location with centralized e-commerce fulfillment
- **What Claude Gets Wrong**: Assumes single-store context; misses cross-location stock logic
`
  );
}

function createFixtureScoping(dir, skillName) {
  writeSessionJson(dir, skillName, "scoping");
  writeUserContext(dir, skillName);
  makeSkillDirs(dir, skillName);
}

function createFixtureClarification(dir, skillName) {
  writeSessionJson(dir, skillName, "clarification");
  writeUserContext(dir, skillName);
  makeSkillDirs(dir, skillName);
  writeFile(
    path.join(dir, "workspace", skillName, "context", "clarifications.json"),
    JSON.stringify(
      {
        version: "1",
        metadata: {
          title: "Pet Store Analytics Clarifications",
          question_count: 6,
          section_count: 2,
          refinement_count: 0,
          must_answer_count: 2,
          priority_questions: ["Q1", "Q4"],
          scope_recommendation: false,
        },
        sections: [
          {
            id: "S1",
            title: "Core Entities",
            questions: [
              {
                id: "Q1",
                title: "Primary entities",
                must_answer: true,
                text: "What are the primary business entities in pet store analytics?",
                choices: [
                  { id: "A", text: "Products, Customers, Transactions", is_other: false },
                  {
                    id: "B",
                    text: "Products, Customers, Transactions, Inventory",
                    is_other: false,
                  },
                  { id: "C", text: "Other (please specify)", is_other: true },
                ],
                recommendation: "B",
                answer_choice: "B",
                answer_text: "We track all four entities in the core model.",
                refinements: [],
              },
              {
                id: "Q2",
                title: "Customer segmentation",
                must_answer: false,
                text: "How do you segment customers?",
                choices: [
                  { id: "A", text: "Purchase frequency", is_other: false },
                  { id: "B", text: "Pet type", is_other: false },
                  { id: "C", text: "Both dimensions", is_other: false },
                ],
                recommendation: "C",
                answer_choice: "C",
                answer_text: "Both frequency and pet type are required.",
                refinements: [],
              },
            ],
          },
          {
            id: "S2",
            title: "Data Modeling",
            questions: [
              {
                id: "Q4",
                title: "Return policy",
                must_answer: true,
                text: "What is the return model for different product types?",
                choices: [
                  { id: "A", text: "30-day refund for all products", is_other: false },
                  { id: "B", text: "Exchange-only for live animals", is_other: false },
                  { id: "C", text: "Custom by category", is_other: false },
                ],
                recommendation: "B",
                answer_choice: null,
                answer_text: null,
                refinements: [],
              },
            ],
          },
        ],
        notes: [],
      },
      null,
      2
    )
  );
}

function createFixtureDetailedResearchWorkspace(dir, skillName, { scopeRecommendation = false } = {}) {
  createFixtureClarification(dir, skillName);
  const clarificationsPath = path.join(dir, "workspace", skillName, "context", "clarifications.json");
  const clarifications = readJson(clarificationsPath);
  clarifications.metadata.scope_recommendation = scopeRecommendation;
  writeFile(clarificationsPath, JSON.stringify(clarifications, null, 2));

  writeFile(
    path.join(dir, "workspace", skillName, "answer-evaluation.json"),
    JSON.stringify(
      {
        verdict: "mixed",
        answered_count: 2,
        empty_count: 1,
        vague_count: 1,
        contradictory_count: 0,
        total_count: 4,
        reasoning: "Some answers need follow-up clarifications.",
        per_question: [
          { question_id: "Q1", verdict: "clear" },
          { question_id: "Q2", verdict: "vague", reason: "Needs more detail." },
          { question_id: "Q4", verdict: "not_answered" },
          { question_id: "Q5", verdict: "needs_refinement" },
        ],
      },
      null,
      2
    )
  );
}

function createFixtureDecisionWorkspace(dir, skillName, { scopeRecommendation = false } = {}) {
  writeSessionJson(dir, skillName, "clarification");
  writeUserContext(dir, skillName);
  makeSkillDirs(dir, skillName);
  writeFile(
    path.join(dir, "workspace", skillName, "context", "clarifications.json"),
    JSON.stringify(
      {
        version: "1",
        metadata: {
          title: "Pet Store Analytics Clarifications",
          question_count: 3,
          section_count: 1,
          refinement_count: 0,
          must_answer_count: 1,
          priority_questions: ["Q1"],
          scope_recommendation: scopeRecommendation,
        },
        sections: [
          {
            id: "S1",
            title: "Core Entities",
            questions: [
              {
                id: "Q1",
                title: "Primary entities",
                must_answer: true,
                text: "What are the primary business entities?",
                choices: [
                  { id: "A", text: "Products, Customers, Transactions", is_other: false },
                  {
                    id: "B",
                    text: "Products, Customers, Transactions, Inventory",
                    is_other: false,
                  },
                ],
                recommendation: "B",
                answer_choice: "B",
                answer_text: "Track products, customers, transactions, and inventory.",
                refinements: [],
              },
            ],
          },
        ],
        notes: [],
      },
      null,
      2
    )
  );
}

function createFixtureRefinableSkill(dir, skillName) {
  writeSessionJson(dir, skillName, "refinement");
  writeUserContext(dir, skillName);
  makeSkillDirs(dir, skillName);
  writeFile(
    path.join(dir, skillName, "SKILL.md"),
    `---
name: ${skillName}
description: Guides data engineers to build silver and gold layer dbt models for pet store analytics. Use when modeling sales transactions, inventory levels, or customer behavior from a pet store POS system.
domain: Pet Store Analytics
type: domain
tools: Read, Edit, Write, Glob, Grep, Task
version: 1.0.0
author: testuser
created: 2026-01-15
modified: 2026-01-15
---

# Pet Store Analytics
`
  );
}

function writeDecisionsJson(dir, skillName, metadata, decisions = []) {
  writeFile(
    path.join(dir, "workspace", skillName, "context", "decisions.json"),
    JSON.stringify({ version: "1", metadata, decisions }, null, 2),
  );
}

function writeClarificationsFile(dir, skillName, payload) {
  writeFile(
    path.join(dir, "workspace", skillName, "context", "clarifications.json"),
    JSON.stringify(payload, null, 2),
  );
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---[\s\S]*?---\n/, "");
}

function loadWorkspaceContext() {
  return fs.readFileSync(
    path.join(REPO_ROOT, "agent-sources", "workspace", "CLAUDE.md"),
    "utf8"
  );
}

function loadRefineInstructions() {
  const content = fs.readFileSync(path.join(AGENTS_DIR, "refine-skill.md"), "utf8");
  return stripFrontmatter(content);
}

function loadAgentInstructions(agentName) {
  const primary = path.join(AGENTS_DIR, `${agentName}.md`);
  if (fs.existsSync(primary)) {
    return stripFrontmatter(fs.readFileSync(primary, "utf8"));
  }
  // Fall back to plugin agents (e.g. generate-skill lives under skill-creator plugin)
  const pluginDirs = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const plugin of pluginDirs) {
    const pluginAgent = path.join(PLUGINS_DIR, plugin, "agents", `${agentName}.md`);
    if (fs.existsSync(pluginAgent)) {
      return stripFrontmatter(fs.readFileSync(pluginAgent, "utf8"));
    }
  }
  throw new Error(`Agent instructions not found for "${agentName}" in agents/ or plugins/`);
}

function parseAgentJsonOutput(stdout) {
  if (!stdout) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(stdout.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function finalizeScenario(scenario, contracts, invocationExpected = [], invocationObserved = []) {
  const invocation = assessInvocationContracts(invocationExpected, invocationObserved);
  const mergedContracts = {
    ...contracts,
    invocationPresence: invocation.invocationPresence,
    invocationOrder: invocation.invocationOrder,
  };
  const failures = [
    ...Object.entries(mergedContracts)
      .filter(([, value]) => value !== true)
      .map(([key]) => key),
    ...invocation.missingCalls.map((value) => `missing:${value}`),
  ];
  return {
    scenario,
    ok: failures.length === 0,
    contracts: mergedContracts,
    invocations: {
      expected: invocationExpected,
      observed: invocationObserved,
      unexpectedCalls: invocation.unexpectedCalls,
      missingCalls: invocation.missingCalls,
    },
    failures,
  };
}

function runResearchOrchestrator({ budgetUsd }) {
  const dir = makeTempDir("research");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureScoping(dir, skillName);
  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("research-orchestrator");

  const prompt = `You are the research-orchestrator agent for the skill-builder plugin.

Skill type: domain
Domain: Pet Store Analytics
Skill name: ${skillName}
Context directory: ${dir}/workspace/${skillName}/context
Workspace directory: ${dir}/workspace/${skillName}

<workspace-instructions>
${workspaceContext}
</workspace-instructions>
<agent-instructions>
${agentInstructions}
</agent-instructions>

Return JSON only:
{
  "status": "research_complete",
  "dimensions_selected": <number>,
  "question_count": <number>,
  "research_output": { "<canonical clarifications object>" }
}`;

  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 260_000, cwd: dir });
  const response = parseAgentJsonOutput(stdout);
  const researchOutput = response?.research_output ?? null;
  const schema = assessClarificationsSchema(researchOutput);
  return finalizeScenario(
    "research-orchestrator",
    {
      structuredResponseObject: Boolean(response && typeof response === "object"),
      statusResearchComplete: response?.status === "research_complete",
      dimensionsSelectedNumber:
        typeof response?.dimensions_selected === "number" && response.dimensions_selected >= 0,
      questionCountNumber: typeof response?.question_count === "number" && response.question_count >= 0,
      returnsResearchOutput: Boolean(researchOutput && typeof researchOutput === "object"),
      ...schema,
    },
    [],
    [],
  );
}

function runResearchOrchestratorScopeGuard({ budgetUsd }) {
  const dir = makeTempDir("research-scope");
  const skillName = "testing";
  createFixtureScoping(dir, skillName);
  writeFile(
    path.join(dir, "workspace", skillName, "user-context.md"),
    `# User Context
- **Purpose**: Business process knowledge
- **Description**: Just testing
- **What Claude Needs to Know**: Throwaway UI test only
`,
  );
  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("research-orchestrator");
  const prompt = `You are the research-orchestrator agent for the skill-builder plugin.
Skill type: domain
Skill name: ${skillName}
Context directory: ${dir}/workspace/${skillName}/context
Workspace directory: ${dir}/workspace/${skillName}
<workspace-instructions>
${workspaceContext}
</workspace-instructions>
<agent-instructions>
${agentInstructions}
</agent-instructions>
Return JSON only with status, dimensions_selected, question_count, and research_output.`;
  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 260_000, cwd: dir });
  const response = parseAgentJsonOutput(stdout);
  const researchOutput = response?.research_output ?? {};
  return finalizeScenario(
    "research-orchestrator-scope-guard",
    {
      statusResearchComplete: response?.status === "research_complete",
      scopeRecommendation: researchOutput?.metadata?.scope_recommendation === true,
      zeroDimensions: Number(response?.dimensions_selected ?? -1) === 0,
      zeroQuestions: Number(response?.question_count ?? -1) === 0,
      hasScopeReasonOrNotes:
        typeof researchOutput?.metadata?.scope_reason === "string"
        || (Array.isArray(researchOutput?.notes) && researchOutput.notes.length > 0),
    },
    [],
    [],
  );
}

function runDetailedResearch({ budgetUsd }) {
  const dir = makeTempDir("detailed-research");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureDetailedResearchWorkspace(dir, skillName);
  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("detailed-research");

  const prompt = `You are the detailed-research agent for the skill-builder plugin.

Skill type: domain
Skill name: ${skillName}
Context directory: ${dir}/workspace/${skillName}/context
Skill output directory: ${dir}/${skillName}
Workspace directory: ${dir}/workspace/${skillName}

<workspace-instructions>
${workspaceContext}
</workspace-instructions>
<agent-instructions>
${agentInstructions}
</agent-instructions>

Return JSON only with:
{
  "status": "detailed_research_complete",
  "refinement_count": <number>,
  "section_count": <number>,
  "clarifications_json": { ...canonical object... }
}`;

  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 260_000, cwd: dir });
  const response = parseAgentJsonOutput(stdout);
  const clarifications = response?.clarifications_json ?? null;
  const schema = assessClarificationsSchema(clarifications);
  return finalizeScenario(
    "detailed-research",
    {
      structuredResponseObject: Boolean(response && typeof response === "object"),
      statusDetailedResearchComplete: response?.status === "detailed_research_complete",
      refinementCountNumber:
        typeof response?.refinement_count === "number" && response.refinement_count >= 0,
      sectionCountNumber: typeof response?.section_count === "number" && response.section_count >= 0,
      returnsClarificationsJson: Boolean(clarifications && typeof clarifications === "object"),
      ...schema,
    },
    [],
    [],
  );
}

function runDetailedResearchScopeGuard({ budgetUsd }) {
  const dir = makeTempDir("detailed-research-scope");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureDetailedResearchWorkspace(dir, skillName, { scopeRecommendation: true });
  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("detailed-research");

  const prompt = `You are the detailed-research agent for the skill-builder plugin.
Skill type: domain
Skill name: ${skillName}
Context directory: ${dir}/workspace/${skillName}/context
Skill output directory: ${dir}/${skillName}
Workspace directory: ${dir}/workspace/${skillName}
<workspace-instructions>
${workspaceContext}
</workspace-instructions>
<agent-instructions>
${agentInstructions}
</agent-instructions>
Return JSON only with status, refinement_count, section_count, and clarifications_json.`;

  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 260_000, cwd: dir });
  const response = parseAgentJsonOutput(stdout);
  const clarifications = response?.clarifications_json ?? {};
  return finalizeScenario(
    "detailed-research-scope-guard",
    {
      statusDetailedResearchComplete: response?.status === "detailed_research_complete",
      scopeRecommendation: clarifications?.metadata?.scope_recommendation === true,
      zeroRefinements: Number(response?.refinement_count ?? -1) === 0,
      sectionCountZero: Number(response?.section_count ?? -1) === 0,
      canonicalShape: Boolean(
        clarifications
        && typeof clarifications === "object"
        && clarifications.version === "1"
        && Array.isArray(clarifications.sections)
      ),
    },
    [],
    [],
  );
}

function runDetailedResearchAllClear({ budgetUsd }) {
  const dir = makeTempDir("detailed-research-all-clear");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureDetailedResearchWorkspace(dir, skillName);
  writeFile(
    path.join(dir, "workspace", skillName, "answer-evaluation.json"),
    JSON.stringify(
      {
        verdict: "sufficient",
        answered_count: 4,
        empty_count: 0,
        vague_count: 0,
        contradictory_count: 0,
        total_count: 4,
        reasoning: "All answers are clear.",
        per_question: [
          { question_id: "Q1", verdict: "clear" },
          { question_id: "Q2", verdict: "clear" },
          { question_id: "Q4", verdict: "clear" },
          { question_id: "Q5", verdict: "clear" },
        ],
      },
      null,
      2
    )
  );

  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("detailed-research");
  const prompt = `You are the detailed-research agent for the skill-builder plugin.
Skill type: domain
Skill name: ${skillName}
Context directory: ${dir}/workspace/${skillName}/context
Skill output directory: ${dir}/${skillName}
Workspace directory: ${dir}/workspace/${skillName}
<workspace-instructions>
${workspaceContext}
</workspace-instructions>
<agent-instructions>
${agentInstructions}
</agent-instructions>
Return JSON only with status, refinement_count, section_count, and clarifications_json.`;

  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 260_000, cwd: dir });
  const response = parseAgentJsonOutput(stdout);
  return finalizeScenario("detailed-research-all-clear", {
    statusDetailedResearchComplete: response?.status === "detailed_research_complete",
    zeroRefinements: Number(response?.refinement_count ?? -1) === 0,
    sectionCountNumber: typeof response?.section_count === "number" && response.section_count >= 0,
  });
}

function runDetailedResearchMissingEvaluationFallback({ budgetUsd }) {
  const dir = makeTempDir("detailed-research-fallback");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureDetailedResearchWorkspace(dir, skillName);
  fs.rmSync(path.join(dir, "workspace", skillName, "answer-evaluation.json"));

  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("detailed-research");
  const prompt = `You are the detailed-research agent for the skill-builder plugin.
Skill type: domain
Skill name: ${skillName}
Context directory: ${dir}/workspace/${skillName}/context
Skill output directory: ${dir}/${skillName}
Workspace directory: ${dir}/workspace/${skillName}
<workspace-instructions>
${workspaceContext}
</workspace-instructions>
<agent-instructions>
${agentInstructions}
</agent-instructions>
Return JSON only with status, refinement_count, section_count, and clarifications_json.`;

  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 260_000, cwd: dir });
  const response = parseAgentJsonOutput(stdout);
  const clarifications = response?.clarifications_json ?? null;
  return finalizeScenario("detailed-research-missing-evaluation-fallback", {
    statusDetailedResearchComplete: response?.status === "detailed_research_complete",
    returnsClarificationsJson: Boolean(clarifications && typeof clarifications === "object"),
    hasRefinementCount: typeof response?.refinement_count === "number",
  });
}

function runAnswerEvaluator({ budgetUsd }) {
  const dir = makeTempDir("answer-eval");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureClarification(dir, skillName);
  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("answer-evaluator");

  const prompt = `You are the answer-evaluator agent for the skill-builder plugin.

Context directory: ${dir}/workspace/${skillName}/context
Workspace directory: ${dir}/workspace/${skillName}

<workspace-instructions>
${workspaceContext}
</workspace-instructions>
<agent-instructions>
${agentInstructions}
</agent-instructions>

Read the clarification file at: ${dir}/workspace/${skillName}/context/clarifications.json
Return JSON only with these fields:
{
  "total_count": <number>,
  "answered_count": <number>,
  "empty_count": <number>,
  "vague_count": <number>,
  "contradictory_count": <number>,
  "verdict": "sufficient" | "mixed" | "insufficient",
  "per_question": [ ... ],
  "reasoning": "<brief explanation>"
}

Return only the evaluation object (no markdown).`;

  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 120_000, cwd: dir });
  const evaluation = parseAgentJsonOutput(stdout) ?? {};
  const contracts = {
    structuredResponseObject: typeof evaluation === "object" && !Array.isArray(evaluation),
    ...assessAnswerEvaluationSchema(evaluation),
  };
  return finalizeScenario("answer-evaluator", contracts);
}

function runConfirmDecisions({ budgetUsd }) {
  const dir = makeTempDir("decisions");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureDecisionWorkspace(dir, skillName);
  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("confirm-decisions");

  const prompt = `You are the confirm-decisions agent for the skill-builder plugin.

Skill type: domain
Domain: Pet Store Analytics
Skill name: ${skillName}
Context directory: ${dir}/workspace/${skillName}/context
Skill directory: ${dir}/${skillName}
Workspace directory: ${dir}/workspace/${skillName}

<workspace-instructions>
${workspaceContext}
</workspace-instructions>
<agent-instructions>
${agentInstructions}
</agent-instructions>

Read the answered clarifications at: ${dir}/workspace/${skillName}/context/clarifications.json
Synthesize the answers into concrete design decisions for the skill.
Return JSON only with:
{
  "status": "decisions_complete",
  "decisions_json": { "<canonical decisions_json object>" },
  "call_trace": ["..."]
}`;

  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 120_000, cwd: dir });
  const response = parseAgentJsonOutput(stdout);
  const decisions_json = response?.decisions_json ?? null;
  return finalizeScenario(
    "confirm-decisions",
    {
      decisionsExists: Boolean(decisions_json && typeof decisions_json === "object"),
      decisionCountField: typeof decisions_json?.metadata?.decision_count === "number",
      status: Array.isArray(decisions_json?.decisions) && decisions_json.decisions.every((d) => typeof d.status === "string" && d.status.length > 0),
    },
    [],
    response?.call_trace ?? [],
  );
}

function runConfirmDecisionsScopeGuard({ budgetUsd }) {
  const dir = makeTempDir("decisions-scope");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureDecisionWorkspace(dir, skillName, { scopeRecommendation: true });
  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("confirm-decisions");
  const prompt = `You are the confirm-decisions agent.
Context directory: ${dir}/workspace/${skillName}/context
Workspace directory: ${dir}/workspace/${skillName}
<workspace-instructions>${workspaceContext}</workspace-instructions>
<agent-instructions>${agentInstructions}</agent-instructions>
Return JSON only with "status":"decisions_complete" and "decisions_json".`;
  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 120_000, cwd: dir });
  const response = parseAgentJsonOutput(stdout);
  const decisions_json = response?.decisions_json ?? null;
  return finalizeScenario("confirm-decisions-scope-guard", {
    hasScopeRecommendationFlag: decisions_json?.metadata?.scope_recommendation === true,
    hasZeroDecisionCount: decisions_json?.metadata?.decision_count === 0,
  });
}

function runConfirmDecisionsContradictory({ budgetUsd }) {
  const dir = makeTempDir("decisions-contradictory");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureDecisionWorkspace(dir, skillName);
  const clarificationsPath = path.join(dir, "workspace", skillName, "context", "clarifications.json");
  const clarifications = readJson(clarificationsPath);
  clarifications.sections[0].questions.push({
    id: "Q9",
    title: "Revenue tracking scope",
    must_answer: true,
    text: "Should this skill track revenue metrics?",
    choices: [
      { id: "A", text: "Track revenue monthly", is_other: false },
      { id: "B", text: "Do not track revenue at all", is_other: false },
      { id: "C", text: "Other (please specify)", is_other: true },
    ],
    recommendation: "A",
    answer_choice: "B",
    answer_text: "Do not track revenue at all.",
    refinements: [],
  });
  clarifications.sections[0].questions.push({
    id: "Q10",
    title: "Revenue reporting cadence",
    must_answer: true,
    text: "How often should revenue be reported?",
    choices: [
      { id: "A", text: "Monthly revenue reporting", is_other: false },
      { id: "B", text: "Quarterly only", is_other: false },
      { id: "C", text: "Other (please specify)", is_other: true },
    ],
    recommendation: "A",
    answer_choice: "A",
    answer_text: "Track monthly revenue reports.",
    refinements: [],
  });
  writeClarificationsFile(dir, skillName, clarifications);
  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("confirm-decisions");
  const prompt = `You are confirm-decisions.
Context directory: ${dir}/workspace/${skillName}/context
Workspace directory: ${dir}/workspace/${skillName}
<workspace-instructions>${workspaceContext}</workspace-instructions>
<agent-instructions>${agentInstructions}</agent-instructions>
Return JSON only with "status":"decisions_complete" and "decisions_json".`;
  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 120_000, cwd: dir });
  const response = parseAgentJsonOutput(stdout);
  const decisions_json = response?.decisions_json ?? null;
  return finalizeScenario("confirm-decisions-contradictory", {
    decisionsPayloadExists: Boolean(decisions_json && typeof decisions_json === "object"),
    contradictoryFlagSet: decisions_json?.metadata?.contradictory_inputs === true,
    canonicalShape: allTrue(assessDecisionsJsonSchema(decisions_json ?? {})),
  });
}

function runConfirmDecisionsResolvableConflict({ budgetUsd }) {
  const dir = makeTempDir("decisions-resolvable");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureDecisionWorkspace(dir, skillName);
  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("confirm-decisions");
  const prompt = `You are confirm-decisions.
Context directory: ${dir}/workspace/${skillName}/context
Workspace directory: ${dir}/workspace/${skillName}
<workspace-instructions>${workspaceContext}</workspace-instructions>
<agent-instructions>${agentInstructions}</agent-instructions>
Return JSON only with "status":"decisions_complete" and "decisions_json".`;
  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 120_000, cwd: dir });
  const response = parseAgentJsonOutput(stdout);
  const decisions_json = response?.decisions_json ?? null;
  return finalizeScenario("confirm-decisions-resolvable-conflict", {
    decisionsPayloadExists: Boolean(decisions_json && typeof decisions_json === "object"),
    noContradictoryFlag: decisions_json?.metadata?.contradictory_inputs !== true,
    hasConflictResolvedOrResolved: Array.isArray(decisions_json?.decisions)
      && decisions_json.decisions.some((d) => d.status === "conflict-resolved" || d.status === "resolved"),
  });
}

function runGenerateSkill({ budgetUsd }) {
  const dir = makeTempDir("generate");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureRefinableSkill(dir, skillName);
  createFixtureDecisionWorkspace(dir, skillName);
  writeDecisionsJson(dir, skillName, { decision_count: 2, conflicts_resolved: 0, round: 1 }, [
    {
      id: "D1",
      title: "Capability",
      original_question: "What should this skill enable Claude to do?",
      decision: "Build dbt-ready silver and gold model guidance for pet-store analytics.",
      implication: "Include concrete layer-specific patterns and tests.",
      status: "needs-review",
    },
    {
      id: "D2",
      title: "Trigger",
      original_question: "When should this skill trigger?",
      decision: "Trigger for requests about pet-store dbt modeling, medallion layers, and data tests.",
      implication: "Use these trigger contexts in SKILL frontmatter description.",
      status: "needs-review",
    },
  ]);
  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("generate-skill");
  const prompt = `You are generate-skill.
Skill name: ${skillName}
Purpose: Business process knowledge
Context directory: ${dir}/workspace/${skillName}/context
Skill output directory: ${dir}/${skillName}
Workspace directory: ${dir}/workspace/${skillName}
<workspace-instructions>${workspaceContext}</workspace-instructions>
<agent-instructions>${agentInstructions}</agent-instructions>
Return JSON only with "status":"generated", "evaluations_markdown", and "call_trace".`;
  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 300_000, cwd: dir });
  const response = parseAgentJsonOutput(stdout);
  const skillMdPath = path.join(dir, skillName, "SKILL.md");
  const evaluationsMarkdown = response?.evaluations_markdown ?? "";
  return finalizeScenario(
    "generate-skill",
    {
      skillMdExists: fs.existsSync(skillMdPath),
      hasReferencesDir: fs.existsSync(path.join(dir, skillName, "references")),
      evaluationsExists:
        typeof evaluationsMarkdown === "string" && evaluationsMarkdown.trim().length > 0,
    },
    ["read-user-context", "read-decisions", "write-skill", "write-references", "write-evaluations"],
    response?.call_trace ?? [],
  );
}

function runGenerateSkillScopeGuard({ budgetUsd }) {
  const dir = makeTempDir("generate-scope");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureRefinableSkill(dir, skillName);
  // generate-skill reads scope_recommendation from clarifications.json
  createFixtureDecisionWorkspace(dir, skillName, { scopeRecommendation: true });
  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("generate-skill");
  const prompt = `You are generate-skill.
Context directory: ${dir}/workspace/${skillName}/context
Skill output directory: ${dir}/${skillName}
Workspace directory: ${dir}/workspace/${skillName}
<workspace-instructions>${workspaceContext}</workspace-instructions>
<agent-instructions>${agentInstructions}</agent-instructions>
Return JSON only with "status":"generated", "evaluations_markdown", and "call_trace".`;
  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 180_000, cwd: dir });
  const response = parseAgentJsonOutput(stdout);
  const content = fs.readFileSync(path.join(dir, skillName, "SKILL.md"), "utf8");
  return finalizeScenario("generate-skill-scope-guard", {
    structuredResponseObject: Boolean(response && typeof response === "object"),
    evaluationsPayloadExists:
      typeof response?.evaluations_markdown === "string" && response.evaluations_markdown.trim().length > 0,
    scopeStubWritten: /scope_recommendation:\s*true/.test(content),
    scopeStubHeading: /## Scope Recommendation Active/.test(content),
  });
}

function runGenerateSkillContradictory({ budgetUsd }) {
  const dir = makeTempDir("generate-contradictory");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureRefinableSkill(dir, skillName);
  createFixtureDecisionWorkspace(dir, skillName);
  writeDecisionsJson(dir, skillName, { decision_count: 2, conflicts_resolved: 1, round: 1, contradictory_inputs: true }, [
    {
      id: "D1",
      title: "Contradiction",
      original_question: "What revenue should be tracked?",
      decision: "Track monthly revenue",
      implication: "Requires revenue tracking in the data model.",
      status: "conflict-resolved",
    },
  ]);
  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("generate-skill");
  const prompt = `You are generate-skill.
Context directory: ${dir}/workspace/${skillName}/context
Skill output directory: ${dir}/${skillName}
Workspace directory: ${dir}/workspace/${skillName}
<workspace-instructions>${workspaceContext}</workspace-instructions>
<agent-instructions>${agentInstructions}</agent-instructions>
Return JSON only with "status":"generated", "evaluations_markdown", and "call_trace".`;
  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 180_000, cwd: dir });
  const response = parseAgentJsonOutput(stdout);
  const content = fs.readFileSync(path.join(dir, skillName, "SKILL.md"), "utf8");
  return finalizeScenario("generate-skill-contradictory", {
    structuredResponseObject: Boolean(response && typeof response === "object"),
    evaluationsPayloadExists:
      typeof response?.evaluations_markdown === "string" && response.evaluations_markdown.trim().length > 0,
    contradictionStubWritten: /contradictory_inputs:\s*true/.test(content),
    contradictionStubHeading: /## Contradictory Inputs Detected/.test(content),
  });
}

function runGenerateSkillRevised({ budgetUsd }) {
  const dir = makeTempDir("generate-revised");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureRefinableSkill(dir, skillName);
  createFixtureDecisionWorkspace(dir, skillName);
  writeDecisionsJson(dir, skillName, { decision_count: 2, conflicts_resolved: 1, round: 1, contradictory_inputs: "revised" }, [
    {
      id: "D1",
      title: "Capability",
      original_question: "What should this skill enable Claude to do?",
      decision: "Build dbt guidance.",
      implication: "Provide concrete modeling examples.",
      status: "needs-review",
    },
  ]);
  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("generate-skill");
  const prompt = `You are generate-skill.
Context directory: ${dir}/workspace/${skillName}/context
Skill output directory: ${dir}/${skillName}
Workspace directory: ${dir}/workspace/${skillName}
<workspace-instructions>${workspaceContext}</workspace-instructions>
<agent-instructions>${agentInstructions}</agent-instructions>
Return JSON only with "status":"generated", "evaluations_markdown", and "call_trace".`;
  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 300_000, cwd: dir });
  const response = parseAgentJsonOutput(stdout);
  const content = fs.readFileSync(path.join(dir, skillName, "SKILL.md"), "utf8");
  return finalizeScenario(
    "generate-skill-revised",
    {
      notStub: !/scope_recommendation:\s*true|contradictory_inputs:\s*true/.test(content),
      generatedSkillBody: /# /.test(content),
    },
    ["read-user-context", "read-decisions", "write-skill"],
    response?.call_trace ?? [],
  );
}

function runRefineSkill({ budgetUsd }) {
  const dir = makeTempDir("refine");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureRefinableSkill(dir, skillName);
  const workspaceContext = loadWorkspaceContext();
  const refineInstructions = loadRefineInstructions();
  const skillMdPath = path.join(dir, skillName, "SKILL.md");

  const prompt = `You are the refine-skill agent for the skill-builder plugin.

Skill directory: ${dir}/${skillName}
Context directory: ${dir}/workspace/${skillName}/context
Workspace directory: ${dir}/workspace/${skillName}
Skill type: domain
Command: refine

<agent-instructions>
${refineInstructions}
${workspaceContext}
</agent-instructions>

Current user message: Add to the description that this skill works well with dbt-testing when running test suites`;

  runAgent(prompt, { budgetUsd, timeoutMs: 120_000, cwd: dir });

  const content = fs.existsSync(skillMdPath) ? fs.readFileSync(skillMdPath, "utf8") : "";
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
  const modifiedMatch = frontmatter.match(/^modified:\s*(.+)$/m);

  return finalizeScenario("refine-skill", {
    descriptionUpdated: /dbt.testing/i.test(content),
    descriptionPreserved: frontmatter.includes("Guides data engineers"),
    modifiedUpdated: modifiedMatch != null && modifiedMatch[1].trim() !== "2026-01-15",
  });
}

function runRefineSkillScopeGuard({ budgetUsd }) {
  const dir = makeTempDir("refine-scope");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureRefinableSkill(dir, skillName);
  createFixtureDecisionWorkspace(dir, skillName);
  writeDecisionsJson(dir, skillName,
    { scope_recommendation: true, decision_count: 0, conflicts_resolved: 0, round: 1 },
    [],
  );
  writeClarificationsFile(dir, skillName, {
    version: "1",
    metadata: { scope_recommendation: true, question_count: 0, section_count: 0, refinement_count: 0, must_answer_count: 0, priority_questions: [] },
    sections: [],
    notes: [],
  });
  const workspaceContext = loadWorkspaceContext();
  const refineInstructions = loadRefineInstructions();
  const before = fs.readFileSync(path.join(dir, skillName, "SKILL.md"), "utf8");
  const prompt = `You are refine-skill.
Skill directory: ${dir}/${skillName}
Context directory: ${dir}/workspace/${skillName}/context
Workspace directory: ${dir}/workspace/${skillName}
<workspace-instructions>${workspaceContext}</workspace-instructions>
<agent-instructions>${refineInstructions}</agent-instructions>
Current user message: update description`;
  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 120_000, cwd: dir });
  const after = fs.readFileSync(path.join(dir, skillName, "SKILL.md"), "utf8");
  return finalizeScenario("refine-skill-scope-guard", {
    blockedMessage: /Scope recommendation active\. Blocked until resolved\./i.test(stdout),
    noFileEdits: before === after,
  });
}

function runValidateSkillScopeGuard({ budgetUsd }) {
  const dir = makeTempDir("validate-scope");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureRefinableSkill(dir, skillName);
  createFixtureDecisionWorkspace(dir, skillName, { scopeRecommendation: true });
  writeDecisionsJson(dir, skillName,
    { decision_count: 0, conflicts_resolved: 0, round: 1 },
    [],
  );
  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("validate-skill");
  const prompt = `You are validate-skill.
Skill name: ${skillName}
Purpose: Business process knowledge
Context directory: ${dir}/workspace/${skillName}/context
Skill output directory: ${dir}/${skillName}
Workspace directory: ${dir}/workspace/${skillName}
<workspace-instructions>${workspaceContext}</workspace-instructions>
<agent-instructions>${agentInstructions}</agent-instructions>
Return JSON only with "status":"validation_complete", "validation_log_markdown", and "test_results_markdown".`;
  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 180_000, cwd: dir });
  const response = parseAgentJsonOutput(stdout);
  const validation = response?.validation_log_markdown ?? "";
  const tests = response?.test_results_markdown ?? "";
  return finalizeScenario("validate-skill-scope-guard", {
    structuredResponseObject: Boolean(response && typeof response === "object"),
    validationPayloadExists: typeof validation === "string" && validation.trim().length > 0,
    testPayloadExists: typeof tests === "string" && tests.trim().length > 0,
    validationStub: /## Validation Skipped/.test(validation),
    testStub: /## Testing Skipped/.test(tests),
  });
}

function runValidateSkillMissingSkillMd({ budgetUsd }) {
  const dir = makeTempDir("validate-missing-skill");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureDecisionWorkspace(dir, skillName);
  const workspaceContext = loadWorkspaceContext();
  const agentInstructions = loadAgentInstructions("validate-skill");
  const prompt = `You are validate-skill.
Skill name: ${skillName}
Purpose: Business process knowledge
Context directory: ${dir}/workspace/${skillName}/context
Skill output directory: ${dir}/${skillName}
Workspace directory: ${dir}/workspace/${skillName}
<workspace-instructions>${workspaceContext}</workspace-instructions>
<agent-instructions>${agentInstructions}</agent-instructions>`;
  const stdout = runAgent(prompt, { budgetUsd, timeoutMs: 180_000, cwd: dir });
  const response = parseAgentJsonOutput(stdout);
  const validation = response?.validation_log_markdown ?? stdout;
  return finalizeScenario("validate-skill-missing-skill-md", {
    guardMessage: /No SKILL\.md found|Validation Skipped/.test(validation),
    noValidationFile: !fs.existsSync(path.join(dir, "workspace", skillName, "context", "agent-validation-log.md")),
  });
}

function runSkillTestContract() {
  const skillTestPath = path.join(REPO_ROOT, "agent-sources", "skills", "skill-test", "SKILL.md");
  const content = fs.readFileSync(skillTestPath, "utf8");
  const fm = parseFrontmatter(content);
  return finalizeScenario("skill-test-contract", {
    hasName: fm.name === "skill-test",
    hasVersion: typeof fm.version === "string" && fm.version.length > 0,
    notUserInvocable: fm["user-invocable"] === "false",
    hasRubricSection: /## Evaluation Rubric/.test(content),
  });
}

const scenarioHandlers = {
  "research-orchestrator": runResearchOrchestrator,
  "research-orchestrator-scope-guard": runResearchOrchestratorScopeGuard,
  "detailed-research": runDetailedResearch,
  "detailed-research-scope-guard": runDetailedResearchScopeGuard,
  "detailed-research-all-clear": runDetailedResearchAllClear,
  "detailed-research-missing-evaluation-fallback": runDetailedResearchMissingEvaluationFallback,
  "answer-evaluator": runAnswerEvaluator,
  "confirm-decisions": runConfirmDecisions,
  "confirm-decisions-scope-guard": runConfirmDecisionsScopeGuard,
  "confirm-decisions-contradictory": runConfirmDecisionsContradictory,
  "confirm-decisions-resolvable-conflict": runConfirmDecisionsResolvableConflict,
  "generate-skill": runGenerateSkill,
  "generate-skill-scope-guard": runGenerateSkillScopeGuard,
  "generate-skill-contradictory": runGenerateSkillContradictory,
  "generate-skill-revised": runGenerateSkillRevised,
  "refine-skill": runRefineSkill,
  "refine-skill-scope-guard": runRefineSkillScopeGuard,
  "validate-skill-scope-guard": runValidateSkillScopeGuard,
  "validate-skill-missing-skill-md": runValidateSkillMissingSkillMd,
  "skill-test-contract": runSkillTestContract,
};

export default class SkillBuilderAgentProvider {
  id() {
    return "skill-builder-agent-regression";
  }

  async callApi(prompt, context) {
    if (!hasApiAccess()) {
      return {
        error:
          "Missing API auth. Set ANTHROPIC_API_KEY or FORCE_PLUGIN_TESTS=1 before running Promptfoo agent evals.",
      };
    }

    const scenario = String(context?.vars?.scenario ?? prompt ?? "").trim();
    const runScenario = scenarioHandlers[scenario];
    if (!runScenario) {
      return {
        error: `Unknown scenario '${scenario}'. Expected one of: ${Object.keys(
          scenarioHandlers
        ).join(", ")}`,
      };
    }

    const budgetUsd = parseBudget(
      process.env.MAX_BUDGET_AGENTS,
      process.env.MAX_BUDGET_WORKFLOW,
      "2.00"
    );

    try {
      const result = runScenario({ budgetUsd });
      return { output: JSON.stringify(result) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

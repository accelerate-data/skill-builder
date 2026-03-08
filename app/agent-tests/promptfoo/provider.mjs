import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const AGENTS_DIR = path.join(REPO_ROOT, "agents");
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
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeSessionJson(dir, skillName, phase) {
  writeFile(
    path.join(dir, ".vibedata", "skill-builder", skillName, "session.json"),
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
  fs.mkdirSync(path.join(dir, skillName, "context"), { recursive: true });
  fs.mkdirSync(path.join(dir, skillName, "references"), { recursive: true });
}

function writeUserContext(dir, skillName) {
  writeFile(
    path.join(dir, ".vibedata", "skill-builder", skillName, "user-context.md"),
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
    path.join(dir, skillName, "context", "clarifications.json"),
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

function createFixtureT4Workspace(dir, skillName) {
  writeSessionJson(dir, skillName, "clarification");
  writeUserContext(dir, skillName);
  makeSkillDirs(dir, skillName);
  writeFile(
    path.join(dir, skillName, "context", "clarifications.json"),
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

function runResearchOrchestrator({ budgetUsd }) {
  const dir = makeTempDir("research");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureScoping(dir, skillName);
  const workspaceContext = loadWorkspaceContext();

  const prompt = `You are the research-orchestrator agent for the skill-builder plugin.

Skill type: domain
Domain: Pet Store Analytics
Skill name: ${skillName}
Context directory: ${dir}/${skillName}/context
Workspace directory: ${dir}/.vibedata/skill-builder/${skillName}

<agent-instructions>
${workspaceContext}
</agent-instructions>

Run the full research-orchestrator flow and write canonical outputs to:
- ${dir}/${skillName}/context/research-plan.md
- ${dir}/${skillName}/context/clarifications.json

The clarifications JSON MUST use the canonical schema (not legacy dimension/clarifications arrays):
{
  "version": "1",
  "metadata": {
    "title": "<string>",
    "question_count": <number>,
    "section_count": <number>,
    "refinement_count": <number>,
    "must_answer_count": <number>,
    "priority_questions": ["Q1"]
  },
  "sections": [
    {
      "id": "S1",
      "title": "<string>",
      "questions": [
        {
          "id": "Q1",
          "title": "<string>",
          "must_answer": <boolean>,
          "text": "<string>",
          "choices": [{"id":"A","text":"<string>","is_other":false}],
          "recommendation": "A",
          "answer_choice": null,
          "answer_text": null,
          "refinements": []
        }
      ]
    }
  ],
  "notes": []
}

Return JSON only:
{
  "status": "research_complete",
  "dimensions_selected": <number>,
  "question_count": <number>
}`;

  runAgent(prompt, { budgetUsd, timeoutMs: 260_000, cwd: dir });
  const clarificationsPath = path.join(dir, skillName, "context", "clarifications.json");
  const researchPlanPath = path.join(dir, skillName, "context", "research-plan.md");
  const clarificationsExists = fs.existsSync(clarificationsPath);
  const researchPlanExists = fs.existsSync(researchPlanPath);
  const clarifications = clarificationsExists
    ? JSON.parse(fs.readFileSync(clarificationsPath, "utf8"))
    : {};

  return {
    scenario: "research-orchestrator",
    ok: true,
    clarifications: clarificationsExists,
    researchPlan: researchPlanExists,
    clarificationsSchema: {
      version: clarifications?.version === "1",
      metadata: Boolean(clarifications?.metadata),
      questionCountNumber: typeof clarifications?.metadata?.question_count === "number",
      sectionsArray: Array.isArray(clarifications?.sections),
    },
  };
}

function runAnswerEvaluator({ budgetUsd }) {
  const dir = makeTempDir("answer-eval");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureClarification(dir, skillName);
  const workspaceContext = loadWorkspaceContext();

  const prompt = `You are the answer-evaluator agent for the skill-builder plugin.

Context directory: ${dir}/${skillName}/context
Workspace directory: ${dir}/.vibedata/skill-builder/${skillName}

<agent-instructions>
${workspaceContext}
</agent-instructions>

Read the clarification file at: ${dir}/${skillName}/context/clarifications.json
Write your evaluation to: ${dir}/.vibedata/skill-builder/${skillName}/answer-evaluation.json

The JSON must contain exactly these fields:
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

Return: the evaluation JSON contents.`;

  runAgent(prompt, { budgetUsd, timeoutMs: 120_000, cwd: dir });
  const outputPath = path.join(
    dir,
    ".vibedata",
    "skill-builder",
    skillName,
    "answer-evaluation.json"
  );
  const outputExists = fs.existsSync(outputPath);
  const evaluation = outputExists ? JSON.parse(fs.readFileSync(outputPath, "utf8")) : {};
  const requiredFields = [
    "total_count",
    "answered_count",
    "empty_count",
    "vague_count",
    "contradictory_count",
    "per_question",
    "verdict",
    "reasoning",
  ];

  return {
    scenario: "answer-evaluator",
    ok: true,
    answerEvaluation: outputExists,
    schema: {
      hasRequiredFields: requiredFields.every((field) =>
        Object.prototype.hasOwnProperty.call(evaluation, field)
      ),
      verdictValid: ["sufficient", "mixed", "insufficient"].includes(
        evaluation?.verdict
      ),
      perQuestionArray: Array.isArray(evaluation?.per_question),
    },
  };
}

function runConfirmDecisions({ budgetUsd }) {
  const dir = makeTempDir("decisions");
  const skillName = DEFAULT_SKILL_NAME;
  createFixtureT4Workspace(dir, skillName);
  const workspaceContext = loadWorkspaceContext();

  const prompt = `You are the confirm-decisions agent for the skill-builder plugin.

Skill type: domain
Domain: Pet Store Analytics
Skill name: ${skillName}
Context directory: ${dir}/${skillName}/context
Skill directory: ${dir}/${skillName}
Workspace directory: ${dir}/.vibedata/skill-builder/${skillName}

<agent-instructions>
${workspaceContext}
</agent-instructions>

Read the answered clarifications at: ${dir}/${skillName}/context/clarifications.json
Synthesize the answers into concrete design decisions for the skill.
Write your decisions to: ${dir}/${skillName}/context/decisions.md

Use canonical decisions format with YAML frontmatter and D-numbered headings (for example: ### D1:) containing:
- **Original question:**
- **Decision:**
- **Implication:**
- **Status:** resolved|conflict-resolved|needs-review

Return: path to decisions.md and a one-line summary of key decisions.`;

  runAgent(prompt, { budgetUsd, timeoutMs: 120_000, cwd: dir });
  const decisionsPath = path.join(dir, skillName, "context", "decisions.md");
  const decisionsExists = fs.existsSync(decisionsPath);
  const content = decisionsExists ? fs.readFileSync(decisionsPath, "utf8") : "";

  return {
    scenario: "confirm-decisions",
    ok: true,
    decisions: decisionsExists,
    structure: {
      frontmatter: /^---\n[\s\S]*?decision_count:/m.test(content),
      heading: /^### D\d+:/m.test(content),
      originalQuestion: /\*\*Original question:\*\*/.test(content),
      decision: /\*\*Decision:\*\*/.test(content),
      implication: /\*\*Implication:\*\*/.test(content),
      status: /\*\*Status:\*\*/.test(content),
    },
  };
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
Context directory: ${dir}/${skillName}/context
Workspace directory: ${dir}/.vibedata/skill-builder/${skillName}
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

  return {
    scenario: "refine-skill",
    ok: true,
    descriptionUpdated: /dbt.testing/i.test(content),
    descriptionPreserved: frontmatter.includes("Guides data engineers"),
    modifiedUpdated:
      modifiedMatch != null && modifiedMatch[1].trim() !== "2026-01-15",
  };
}

const scenarioHandlers = {
  "research-orchestrator": runResearchOrchestrator,
  "answer-evaluator": runAnswerEvaluator,
  "confirm-decisions": runConfirmDecisions,
  "refine-skill": runRefineSkill,
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

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { HAS_API_KEY, REPO_ROOT, AGENTS_DIR, makeTempDir, runAgent, parseBudget } from "./helpers";
import {
  createFixtureScoping,
  createFixtureClarification,
  createFixtureT4Workspace,
  createFixtureRefinableSkill,
} from "./fixtures";

const SKILL_NAME = "pet-store-analytics";
// Per-test cap. Override precedence: MAX_BUDGET_AGENTS > MAX_BUDGET_WORKFLOW > 0.50
const BUDGET = parseBudget(
  process.env.MAX_BUDGET_AGENTS,
  process.env.MAX_BUDGET_WORKFLOW,
  "0.50"
);

let WORKSPACE_CONTEXT: string;
let REFINE_SKILL_INSTRUCTIONS: string;

beforeAll(() => {
  WORKSPACE_CONTEXT = fs.readFileSync(
    path.join(REPO_ROOT, "agent-sources", "workspace", "CLAUDE.md"),
    "utf8"
  );
  REFINE_SKILL_INSTRUCTIONS = fs
    .readFileSync(path.join(AGENTS_DIR, "refine-skill.md"), "utf8")
    .replace(/^---[\s\S]*?---\n/, ""); // strip YAML frontmatter
});

// ── research-orchestrator ────────────────────────────────────────────────────

describe.skipIf(!HAS_API_KEY)("research-orchestrator", () => {
  let researchDir: string;

  beforeAll(() => {
    researchDir = makeTempDir("agents-research");
    createFixtureScoping(researchDir, SKILL_NAME);

    const prompt = `You are the research-orchestrator agent for the skill-builder plugin.

Skill type: domain
Domain: Pet Store Analytics
Skill name: ${SKILL_NAME}
Context directory: ${researchDir}/${SKILL_NAME}/context
Workspace directory: ${researchDir}/.vibedata/skill-builder/${SKILL_NAME}

<agent-instructions>
${WORKSPACE_CONTEXT}
</agent-instructions>

Research the pet store analytics domain and generate clarification questions for a skill builder.
Write the consolidated clarification questions to: ${researchDir}/${SKILL_NAME}/context/clarifications.md

The file must contain 5-10 questions grouped by dimension (e.g. Core Entities, Business Patterns, Data Modeling).
Each question must follow this format:
### Q<n>: <title>
<question text>
A. <option>
B. <option>
**Recommendation:** <letter>
**Answer:**

Return: path to clarifications.md and question count.`;

    runAgent(prompt, BUDGET, 180_000, researchDir);
  }, 200_000);

  it("creates clarifications.md", { timeout: 200_000 }, () => {
    const p = path.join(researchDir, SKILL_NAME, "context", "clarifications.md");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("clarifications.md has at least 5 questions", { timeout: 200_000 }, () => {
    const p = path.join(researchDir, SKILL_NAME, "context", "clarifications.md");
    if (!fs.existsSync(p)) return;
    const content = fs.readFileSync(p, "utf8");
    const count = (content.match(/^### Q\d/gm) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(5);
  });

  it("clarifications.md has **Answer:** fields", { timeout: 200_000 }, () => {
    const p = path.join(researchDir, SKILL_NAME, "context", "clarifications.md");
    if (!fs.existsSync(p)) return;
    const content = fs.readFileSync(p, "utf8");
    expect(content).toMatch(/^\*\*Answer:\*\*/m);
  });
});

// ── answer-evaluator ─────────────────────────────────────────────────────────

describe.skipIf(!HAS_API_KEY)("answer-evaluator", () => {
  let evalDir: string;

  beforeAll(() => {
    evalDir = makeTempDir("agents-answer-eval");
    createFixtureClarification(evalDir, SKILL_NAME);

    const prompt = `You are the answer-evaluator agent for the skill-builder plugin.

Context directory: ${evalDir}/${SKILL_NAME}/context
Workspace directory: ${evalDir}/.vibedata/skill-builder/${SKILL_NAME}

<agent-instructions>
${WORKSPACE_CONTEXT}
</agent-instructions>

Read the clarification file at: ${evalDir}/${SKILL_NAME}/context/clarifications.md

Count answered vs unanswered questions (answered = **Answer:** has non-empty content after the colon).
Evaluate whether the answers are sufficient to proceed to skill generation without more research.

Write your evaluation to: ${evalDir}/.vibedata/skill-builder/${SKILL_NAME}/answer-evaluation.json

The JSON must contain exactly these fields:
{
  "total_questions": <number>,
  "answered_count": <number>,
  "empty_count": <number>,
  "verdict": "sufficient" | "needs_more_research" | "insufficient",
  "reasoning": "<brief explanation>"
}

Return: the evaluation JSON contents.`;

    runAgent(prompt, BUDGET, 120_000, evalDir);
  }, 135_000);

  it("creates answer-evaluation.json", { timeout: 135_000 }, () => {
    const p = path.join(evalDir, ".vibedata", SKILL_NAME, "answer-evaluation.json");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("answer-evaluation.json has required fields and valid verdict", { timeout: 135_000 }, () => {
    const p = path.join(evalDir, ".vibedata", SKILL_NAME, "answer-evaluation.json");
    if (!fs.existsSync(p)) return;
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(data).toHaveProperty("total_questions");
    expect(data).toHaveProperty("answered_count");
    expect(data).toHaveProperty("empty_count");
    expect(data).toHaveProperty("verdict");
    expect(data).toHaveProperty("reasoning");
    expect(["sufficient", "needs_more_research", "insufficient"]).toContain(data.verdict);
  });
});

// ── confirm-decisions ────────────────────────────────────────────────────────

describe.skipIf(!HAS_API_KEY)("confirm-decisions", () => {
  let decisionsDir: string;
  let answerEvalPath: string;

  beforeAll(() => {
    // Run answer-evaluator first to get the JSON dependency
    const evalDir = makeTempDir("agents-decisions-eval");
    createFixtureClarification(evalDir, SKILL_NAME);
    const evalPrompt = `You are the answer-evaluator agent for the skill-builder plugin.
Context directory: ${evalDir}/${SKILL_NAME}/context
Workspace directory: ${evalDir}/.vibedata/skill-builder/${SKILL_NAME}
Read: ${evalDir}/${SKILL_NAME}/context/clarifications.md
Write evaluation to: ${evalDir}/.vibedata/skill-builder/${SKILL_NAME}/answer-evaluation.json
JSON fields: total_questions, answered_count, empty_count, verdict (sufficient|needs_more_research|insufficient), reasoning.
Return the JSON.`;
    runAgent(evalPrompt, BUDGET, 120_000, evalDir);
    answerEvalPath = path.join(evalDir, ".vibedata", SKILL_NAME, "answer-evaluation.json");

    // Set up decisions workspace
    decisionsDir = makeTempDir("agents-decisions");
    createFixtureT4Workspace(decisionsDir, SKILL_NAME);

    if (fs.existsSync(answerEvalPath)) {
      fs.copyFileSync(
        answerEvalPath,
        path.join(decisionsDir, ".vibedata", SKILL_NAME, "answer-evaluation.json")
      );
    }

    if (!fs.existsSync(answerEvalPath)) return;

    const prompt = `You are the confirm-decisions agent for the skill-builder plugin.

Skill type: domain
Domain: Pet Store Analytics
Skill name: ${SKILL_NAME}
Context directory: ${decisionsDir}/${SKILL_NAME}/context
Skill directory: ${decisionsDir}/${SKILL_NAME}
Workspace directory: ${decisionsDir}/.vibedata/skill-builder/${SKILL_NAME}

<agent-instructions>
${WORKSPACE_CONTEXT}
</agent-instructions>

Read the answered clarifications at: ${decisionsDir}/${SKILL_NAME}/context/clarifications.md

Synthesize the answers into concrete design decisions for the skill.
Write your decisions to: ${decisionsDir}/${SKILL_NAME}/context/decisions.md

Each decision must follow this format:
### D<n>: <title>
- **Question**: <the original clarification question>
- **Decision**: <the chosen answer>
- **Implication**: <what this means for the skill design>

Return: path to decisions.md and a one-line summary of key decisions.`;

    runAgent(prompt, BUDGET, 120_000, decisionsDir);
  }, 270_000);

  it("creates decisions.md", { timeout: 260_000 }, () => {
    if (!fs.existsSync(answerEvalPath)) return;
    const p = path.join(decisionsDir, SKILL_NAME, "context", "decisions.md");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("decisions.md has at least 3 decisions", { timeout: 260_000 }, () => {
    const p = path.join(decisionsDir, SKILL_NAME, "context", "decisions.md");
    if (!fs.existsSync(p)) return;
    const content = fs.readFileSync(p, "utf8");
    const count = (content.match(/^### D\d/gm) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

// ── refine-skill ─────────────────────────────────────────────────────────────

describe.skipIf(!HAS_API_KEY)("refine-skill: frontmatter description edits", () => {
  let refineDir: string;
  let skillMdPath: string;

  beforeAll(() => {
    refineDir = makeTempDir("agents-refine");
    createFixtureRefinableSkill(refineDir, SKILL_NAME);
    skillMdPath = path.join(refineDir, SKILL_NAME, "SKILL.md");

    const skillDir = path.join(refineDir, SKILL_NAME);
    const contextDir = path.join(refineDir, SKILL_NAME, "context");
    const workspaceDir = path.join(refineDir, ".vibedata", SKILL_NAME);

    const prompt = `You are the refine-skill agent for the skill-builder plugin.

Skill directory: ${skillDir}
Context directory: ${contextDir}
Workspace directory: ${workspaceDir}
Skill type: domain
Command: refine

<agent-instructions>
${REFINE_SKILL_INSTRUCTIONS}
${WORKSPACE_CONTEXT}
</agent-instructions>

Current user message: Add to the description that this skill works well with dbt-testing when running test suites`;

    runAgent(prompt, BUDGET, 120_000, refineDir);
  }, 135_000);

  it("description field is updated with companion trigger", { timeout: 135_000 }, () => {
    if (!fs.existsSync(skillMdPath)) return;
    const fm = extractFrontmatter(skillMdPath);
    expect(fm).toMatch(/dbt.testing/i);
  });

  it("original description content is preserved", { timeout: 135_000 }, () => {
    if (!fs.existsSync(skillMdPath)) return;
    const fm = extractFrontmatter(skillMdPath);
    expect(fm).toContain("Guides data engineers");
  });

  it("modified date is updated after description edit", { timeout: 135_000 }, () => {
    if (!fs.existsSync(skillMdPath)) return;
    const fm = extractFrontmatter(skillMdPath);
    const modifiedMatch = fm.match(/^modified:\s*(.+)$/m);
    expect(modifiedMatch).not.toBeNull();
    expect(modifiedMatch![1].trim()).not.toBe("2026-01-15");
  });
});

function extractFrontmatter(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : "";
}

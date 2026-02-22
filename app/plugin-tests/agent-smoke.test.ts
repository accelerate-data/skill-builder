import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { HAS_API_KEY, PLUGIN_DIR, makeTempDir, runClaude, parseBudget } from "./helpers";
import {
  createFixtureScoping,
  createFixtureClarification,
  createFixtureT4Workspace,
} from "./fixtures";

const SKILL_NAME = "pet-store-analytics";
// Per-test cap. Override precedence: MAX_BUDGET_AGENTS > MAX_BUDGET_WORKFLOW > 0.50
const BUDGET = parseBudget(
  process.env.MAX_BUDGET_AGENTS,
  process.env.MAX_BUDGET_WORKFLOW,
  "0.50"
);
const WORKSPACE_CONTEXT = fs.readFileSync(
  path.join(PLUGIN_DIR, "skills", "building-skills", "references", "workspace-context.md"),
  "utf8"
);

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
Workspace directory: ${researchDir}/.vibedata/${SKILL_NAME}

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

    runClaude(prompt, BUDGET, 180_000, researchDir);
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
Workspace directory: ${evalDir}/.vibedata/${SKILL_NAME}

<agent-instructions>
${WORKSPACE_CONTEXT}
</agent-instructions>

Read the clarification file at: ${evalDir}/${SKILL_NAME}/context/clarifications.md

Count answered vs unanswered questions (answered = **Answer:** has non-empty content after the colon).
Evaluate whether the answers are sufficient to proceed to skill generation without more research.

Write your evaluation to: ${evalDir}/.vibedata/${SKILL_NAME}/answer-evaluation.json

The JSON must contain exactly these fields:
{
  "total_questions": <number>,
  "answered_count": <number>,
  "empty_count": <number>,
  "verdict": "sufficient" | "needs_more_research" | "insufficient",
  "reasoning": "<brief explanation>"
}

Return: the evaluation JSON contents.`;

    runClaude(prompt, BUDGET, 120_000, evalDir);
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
// Depends on answer-evaluator output. Uses its own fixture workspace so it
// can run independently; copies the answer-evaluation.json from a fresh eval run.

describe.skipIf(!HAS_API_KEY)("confirm-decisions", () => {
  let decisionsDir: string;
  let answerEvalPath: string;

  beforeAll(() => {
    // Run answer-evaluator first to get the JSON dependency
    const evalDir = makeTempDir("agents-decisions-eval");
    createFixtureClarification(evalDir, SKILL_NAME);
    const evalPrompt = `You are the answer-evaluator agent for the skill-builder plugin.
Context directory: ${evalDir}/${SKILL_NAME}/context
Workspace directory: ${evalDir}/.vibedata/${SKILL_NAME}
Read: ${evalDir}/${SKILL_NAME}/context/clarifications.md
Write evaluation to: ${evalDir}/.vibedata/${SKILL_NAME}/answer-evaluation.json
JSON fields: total_questions, answered_count, empty_count, verdict (sufficient|needs_more_research|insufficient), reasoning.
Return the JSON.`;
    runClaude(evalPrompt, BUDGET, 120_000, evalDir);
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
Workspace directory: ${decisionsDir}/.vibedata/${SKILL_NAME}

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

    runClaude(prompt, BUDGET, 120_000, decisionsDir);
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

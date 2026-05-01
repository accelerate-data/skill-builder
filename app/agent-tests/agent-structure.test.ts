import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { AGENTS_DIR, PLUGINS_DIR, REPO_ROOT } from "./helpers";

/** Top-level agents deployed to .claude/agents/ */
const EXPECTED_AGENTS: string[] = [];

/** Plugin-hosted agents: agent name → plugin path relative to PLUGINS_DIR */
const PLUGIN_AGENTS: Record<string, string> = {
  "research-agent": "skill-content-researcher/agents/research-agent.md",
  "answer-evaluator": "skill-content-researcher/agents/answer-evaluator.md",
  "skill-writer-agent": "skill-creator/agents/skill-writer-agent.md",
  "rewrite-skill": "skill-creator/agents/rewrite-skill.md",
  grader: "skill-creator/agents/grader.md",
};

const OPENHANDS_WORKFLOW_AGENTS = [
  "research-agent",
  "answer-evaluator",
  "skill-writer-agent",
] as const;

const OBSOLETE_WORKFLOW_AGENT_PATHS = [
  "skill-content-researcher/agents/skill-builder.md",
  "skill-content-researcher/agents/detailed-research.md",
  "skill-content-researcher/agents/confirm-decisions.md",
  "skill-creator/agents/generate-skill.md",
] as const;

/** Resolve the .md file path for any agent (top-level or plugin). */
function resolveAgentPath(agentName: string): string {
  const pluginRelPath = PLUGIN_AGENTS[agentName];
  if (pluginRelPath) return path.join(PLUGINS_DIR, pluginRelPath);
  return path.join(AGENTS_DIR, `${agentName}.md`);
}

/** All agent names (top-level + plugin). */
const ALL_AGENTS = [...EXPECTED_AGENTS, ...Object.keys(PLUGIN_AGENTS)];

function frontmatter(filePath: string): Record<string, string> {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n").map((line) => line.replace(/\r$/, ""));
  if (lines[0] !== "---") return {};
  const end = lines.indexOf("---", 1);
  if (end === -1) return {};
  const fm: Record<string, string> = {};
  lines.slice(1, end).forEach((line) => {
    const [key, ...rest] = line.split(":");
    if (key && rest.length) fm[key.trim()] = rest.join(":").trim();
  });
  return fm;
}

function fileContent(agentName: string): string {
  return fs.readFileSync(resolveAgentPath(agentName), "utf8");
}

function frontmatterBlock(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match?.[1] ?? "";
}

// ── Agent files ────────────────────────────────────────────────────────────

describe("agent files", () => {
  it(`exactly ${EXPECTED_AGENTS.length} agent files exist`, () => {
    const count = fs.existsSync(AGENTS_DIR)
      ? fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md")).length
      : 0;
    expect(count).toBe(EXPECTED_AGENTS.length);
  });

  it("all agents have YAML frontmatter", () => {
    const missing = EXPECTED_AGENTS.filter((agent) => {
      const file = path.join(AGENTS_DIR, `${agent}.md`);
      if (!fs.existsSync(file)) return true;
      const firstLine = fs
        .readFileSync(file, "utf8")
        .split("\n")[0]
        .replace(/\r$/, "");
      return firstLine !== "---";
    });
    expect(missing).toHaveLength(0);
  });

  it.each(EXPECTED_AGENTS)("model tier correct: %s", (agent) => {
    const fm = frontmatter(path.join(AGENTS_DIR, `${agent}.md`));
    expect(fm.model).toBeUndefined();
  });

  it.each(Object.keys(PLUGIN_AGENTS))(
    "does not pin model in bundled agent frontmatter: %s",
    (agent) => {
      const fm = frontmatter(resolveAgentPath(agent));
      expect(fm.model).toBeUndefined();
    },
  );

  it.each(OPENHANDS_WORKFLOW_AGENTS)(
    "OpenHands workflow agent has file-agent frontmatter: %s",
    (agent) => {
      const file = resolveAgentPath(agent);
      const fm = frontmatter(file);
      const raw = frontmatterBlock(file);

      expect(fm.name).toBe(agent);
      expect(raw).toMatch(/tools:\s*\n(?:\s+-\s+(?:file_editor|terminal)\s*\n?)+/);
      expect(raw).not.toMatch(/\b(Read|Write|Edit|Glob|Grep|Bash|Agent|Skill|AskUserQuestion|Task|TaskOutput)\b/);
    },
  );

  it("only OpenHands workflow agents remain for the workflow topology", () => {
    const missing = OPENHANDS_WORKFLOW_AGENTS.filter(
      (agent) => !fs.existsSync(resolveAgentPath(agent)),
    );
    const obsolete = OBSOLETE_WORKFLOW_AGENT_PATHS.filter((relPath) =>
      fs.existsSync(path.join(PLUGINS_DIR, relPath)),
    );

    expect(missing).toEqual([]);
    expect(obsolete).toEqual([]);
  });
});

// ── Canonical format compliance ────────────────────────────────────────────

describe("canonical format compliance", () => {
  const antiPatterns: Array<[string, RegExp]> = [
    ["**Answer**: (colon outside bold)", /\*\*Answer\*\*:/],
    ["**Recommendation**: (colon outside bold)", /\*\*Recommendation\*\*:/],
    ["checkbox choices", /^\s*- \[[ x]\]/m],
    ["**Choices**: label", /\*\*Choices\*\*[:\*]/],
    ["**Question**: label", /\*\*Question\*\*[:\*]/],
  ];

  it.each(
    ALL_AGENTS.flatMap((agent) =>
      antiPatterns.map(([label, pattern]) => [agent, label, pattern] as const),
    ),
  )("%s: no %s", (agent, _label, pattern) => {
    const content = fs.readFileSync(resolveAgentPath(agent), "utf8");
    expect(content).not.toMatch(pattern);
  });
});

// ── Read-directive compliance ───────────────────────────────────────────────

describe("read directive compliance", () => {
  const SKILL_VALIDATOR_PATH = path.join(
    PLUGINS_DIR,
    "skill-creator",
    "skills",
    "skill-validator",
    "SKILL.md",
  );

  const TARGET_FILES = [
    resolveAgentPath("skill-writer-agent"),
    SKILL_VALIDATOR_PATH,
  ];

  const bannedPatterns: Array<[string, RegExp]> = [
    ["blanket 'Read all files' directive", /\bRead all files\b/i],
    [
      "blanket 'Read all provided files' directive",
      /\bRead all provided files\b/i,
    ],
    [
      "up-front all references ingestion",
      /\ball\s+`?references\/?`?\s+files\b/i,
    ],
  ];

  it.each(
    TARGET_FILES.flatMap((file) =>
      bannedPatterns.map(([label, pattern]) => [file, label, pattern] as const),
    ),
  )("%s: avoids %s", (file, _label, pattern) => {
    const content = fs.readFileSync(file, "utf8");
    expect(content).not.toMatch(pattern);
  });

  it.each(TARGET_FILES)(
    "%s: requires progressive discovery language",
    (file) => {
      const content = fs.readFileSync(file, "utf8");
      expect(content).toMatch(/progressive|staged|demand-driven/i);
    },
  );
});

describe("Research scope guard contract prompts", () => {
  it("research skill does not run preflight and emits low-score scope recommendation", () => {
    const content = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "agent-sources/plugins/skill-content-researcher/skills/research/SKILL.md",
      ),
      "utf8",
    );
    expect(content).not.toMatch(/Preflight Scope Guard/i);
    expect(content).toMatch(/topic_relevance[^\n]{0,80}not_relevant/i);
    expect(content).toMatch(/scope-recommendation clarifications output/i);
    expect(content).toMatch(/all_dimensions_low_score/);
  });

  it("scoring rubric stays scoring-only and delegates selection policy", () => {
    const content = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "agent-sources/plugins/skill-content-researcher/skills/research/references/scoring-rubric.md",
      ),
      "utf8",
    );
    expect(content).toMatch(
      /Do not perform selection or branching in this rubric output/i,
    );
    expect(content).not.toMatch(
      /If all scores are <=2, trigger scope recommendation output/i,
    );
  });

  it("research-agent includes scope recommendation short-circuit contract", () => {
    const content = fileContent("research-agent");
    expect(content).toMatch(
      /Scope (Recommendation )?[Gg]uard|scope_recommendation/,
    );
    expect(content).toMatch(/status": "research_complete"/);
    expect(content).toMatch(/dimensions_selected": 0/);
    expect(content).toMatch(/question_count": 0/);
  });

  it("research-agent refinement pass preserves original questions and canonical metadata", () => {
    const content = fileContent("research-agent");
    expect(content).toMatch(/strictly additive/i);
    expect(content).toMatch(
      /do \*\*not\*\* delete any existing `sections\[\]\.questions\[\]` item/i,
    );
    expect(content).toMatch(
      /every original top-level question ID captured before merge must still exist after merge/i,
    );
    expect(content).toMatch(/metadata\.priority_questions/);
    expect(content).toMatch(/metadata\.duplicates_removed/);
    expect(content).toMatch(/remove transient fields/i);
  });
});

// ── Agent output contracts (backend protocol alignment) ──────────────────────
//
// Each test checks that an agent's markdown contains the exact output keys
// the Rust backend expects. These are the contracts enforced by:
//   - workflow_output_format_for_agent() → structured output schema
//   - materialize_workflow_step_output_value() → materialization logic
//   - materialize_answer_evaluation_output_value() → answer-evaluator path

describe("Agent output contracts (backend protocol alignment)", () => {
  it("research-agent returns initial and refinement research payloads", () => {
    const content = fileContent("research-agent");
    expect(content).toMatch(/answer-evaluation\.json/);
    expect(content).toMatch(/"status": "research_complete"/);
    expect(content).toMatch(/"research_output"/);
    expect(content).toMatch(/"refinements"/);
  });

  it("skill-writer-agent decision phase returns version/metadata/decisions shape", () => {
    const content = fileContent("skill-writer-agent");
    // Backend uses additionalProperties: false — only version, metadata, decisions allowed at top level
    expect(content).toMatch(/"version"/);
    expect(content).toMatch(/"metadata"/);
    expect(content).toMatch(/"decisions"/);
    // Agent must document the three-key constraint explicitly
    expect(content).toMatch(/Top-level keys|version.*metadata.*decisions/i);
  });

  it("skill-writer-agent generation phase returns generated status", () => {
    const content = fileContent("skill-writer-agent");
    expect(content).toMatch(/status.*generated/);
    expect(content).toMatch(/call_trace/);
  });

  it("rewrite-skill returns rewritten status", () => {
    const content = fs.readFileSync(resolveAgentPath("rewrite-skill"), "utf8");
    expect(content).toMatch(/status.*rewritten/);
    expect(content).toMatch(/call_trace/);
  });

  it("answer-evaluator returns verdict enum and per_question array", () => {
    const content = fileContent("answer-evaluator");
    expect(content).toMatch(/"verdict"/);
    expect(content).toMatch(/sufficient|mixed|insufficient/);
    expect(content).toMatch(/"per_question"/);
    expect(content).toMatch(/"answered_count"/);
  });

  it("evaluate-skill prompt template matches SDK-enforced schema", () => {
    const content = fs.readFileSync(
      path.join(REPO_ROOT, "agent-sources/workspace/prompts/eval-initial.txt"),
      "utf8",
    );
    expect(content).toMatch(/"status":\s*"complete"/);
    expect(content).toMatch(/"iteration"/);
    expect(content).toMatch(/"results"/);
  });

  it("evaluate-skill prompt documents grading.json write paths", () => {
    const content = fs.readFileSync(
      path.join(REPO_ROOT, "agent-sources/workspace/prompts/eval-initial.txt"),
      "utf8",
    );
    expect(content).toMatch(/grading\.json/);
    expect(content).toMatch(/eval_dir/);
    expect(content).toMatch(/with_skill\/grading\.json/);
    expect(content).toMatch(/without_skill\/grading\.json/);
  });
});

describe("detailed-research output contract", () => {
  const step1Json = JSON.parse(
    fs.readFileSync(
      path.join(
        REPO_ROOT,
        "app/sidecar/mock-templates/outputs/step1/context/clarifications.json",
      ),
      "utf-8",
    ),
  );

  it("step1 clarifications.json sections contain refinements (additive from step0)", () => {
    const hasRefinements = step1Json.sections.some(
      (s: { questions?: Array<{ refinements?: unknown[] }> }) =>
        s.questions?.some((q) => q.refinements && q.refinements.length > 0),
    );
    expect(hasRefinements).toBe(true);
  });
});

// ── Plugin structure sanity checks ───────────────────────────────────────────

describe("skill-content-researcher plugin structure", () => {
  const pluginRoot = path.join(
    REPO_ROOT,
    "agent-sources",
    "plugins",
    "skill-content-researcher",
  );

  it("plugin manifest has required fields", () => {
    const manifestPath = path.join(pluginRoot, ".claude-plugin", "plugin.json");
    const raw = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(raw);

    expect(manifest.name).toBe("skill-content-researcher");
    expect(manifest.version).toBeDefined();
    expect(manifest.description).toBeDefined();
  });

  it("embedded research skill is internal-only (not user-invocable)", () => {
    const researchPath = path.join(
      pluginRoot,
      "skills",
      "research",
      "SKILL.md",
    );
    const fm = frontmatter(researchPath);
    expect(fm.user_invocable).toBe("false");
  });

  it("active workflow prompts avoid Claude routing mechanics", () => {
    const activeFiles = [
      resolveAgentPath("research-agent"),
      resolveAgentPath("answer-evaluator"),
      resolveAgentPath("skill-writer-agent"),
      path.join(pluginRoot, "skills", "research", "SKILL.md"),
    ];
    const forbiddenPatterns: Array<[string, RegExp]> = [
      ["Claude Code routing", /Claude Code/i],
      ["Claude tool names", /\b(?:AskUserQuestion|TaskOutput|TaskStop|bypassPermissions)\b/],
      ["Agent tool routing", /(?:\bAgent\b|\bSkill\b)\s+tool/i],
      ["sub-agent fan-out", /sub-?agents?|fan-?out|spawn .*parallel/i],
      ["wait/merge mechanics", /wait for all|merge helper|merge-helper/i],
    ];

    const failures = activeFiles.flatMap((file) => {
      const content = fs.readFileSync(file, "utf8");
      return forbiddenPatterns
        .filter(([, pattern]) => pattern.test(content))
        .map(([label]) => `${path.relative(REPO_ROOT, file)}: ${label}`);
    });

    expect(failures).toEqual([]);
  });
});

describe("skill-creator plugin structure", () => {
  const pluginRoot = path.join(
    REPO_ROOT,
    "agent-sources",
    "plugins",
    "skill-creator",
  );

  it("plugin manifest has required fields", () => {
    const manifestPath = path.join(pluginRoot, ".claude-plugin", "plugin.json");
    const raw = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(raw);

    expect(manifest.name).toBe("skill-creator");
    expect(manifest.version).toBeDefined();
    expect(manifest.description).toBeDefined();
  });

  it("skill-creator SKILL.md references bundled scripts and eval viewer via relative paths", () => {
    const skillPath = path.join(
      pluginRoot,
      "skills",
      "skill-creator",
      "SKILL.md",
    );
    const content = fs.readFileSync(skillPath, "utf8");

    // Aggregation + optimization scripts via uv under scripts/
    expect(content).toMatch(/uv run scripts\/aggregate_benchmark\.py/);
    expect(content).toMatch(/uv run scripts\/run_loop\.py/);
    // Eval viewer launched via generate_review.py (relative or with skill-creator-path placeholder)
    expect(content).toMatch(/generate_review\.py/);
  });

  it("skill-creator freezes eval expectations at creation time", () => {
    const skillPath = path.join(
      pluginRoot,
      "skills",
      "skill-creator",
      "SKILL.md",
    );
    const schemaPath = path.join(
      pluginRoot,
      "skills",
      "skill-creator",
      "references",
      "schemas.md",
    );
    const content = fs.readFileSync(skillPath, "utf8");
    const schemaContent = fs.readFileSync(schemaPath, "utf8");
    const skillWriterContent = fs.readFileSync(
      resolveAgentPath("skill-writer-agent"),
      "utf8",
    );
    expect(content).toMatch(
      /Write the quantitative assertions at the same time as the prompts/i,
    );
    expect(content).toMatch(
      /treat those fields and those assertions as fixed/i,
    );
    expect(content).toMatch(/deterministic `slug`/i);
    expect(content).toMatch(
      /Do not rewrite `evals\/evals\.json` or `eval_metadata\.json` during the run/i,
    );
    expect(skillWriterContent).toMatch(
      /must include a human-readable `eval_name`, a deterministic `slug`, and its fixed `expectations` at creation time/i,
    );
    expect(schemaContent).toMatch(/evals\[\]\.eval_name/);
    expect(schemaContent).toMatch(/evals\[\]\.slug/);
    expect(schemaContent).toMatch(
      /written at eval creation time and frozen for subsequent benchmark iterations/i,
    );
  });
});

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { AGENTS_DIR, PLUGINS_DIR, REPO_ROOT } from "./helpers";

/** Top-level agents deployed to .claude/agents/ */
const EXPECTED_AGENTS: string[] = [];
const WORKSPACE_AGENTS_DIR = path.join(
  REPO_ROOT,
  "agent-sources",
  "workspace",
  "agents",
);

/** Plugin-hosted agents: agent name → plugin path relative to PLUGINS_DIR */
const PLUGIN_AGENTS: Record<string, string> = {
  "research-agent": "skill-content-researcher/agents/research-agent.md",
  "rewrite-skill": "skill-creator/agents/rewrite-skill.md",
  grader: "skill-creator/agents/grader.md",
};

const OPENHANDS_WORKFLOW_AGENTS = ["skill-creator"] as const;
const OPENHANDS_WORKFLOW_SKILLS = ["creating-skills"] as const;

const OBSOLETE_WORKFLOW_AGENT_PATHS = [
  "skill-content-researcher/agents/skill-builder.md",
  "skill-content-researcher/agents/detailed-research.md",
  "skill-content-researcher/agents/confirm-decisions.md",
  "skill-content-researcher/agents/answer-evaluator.md",
  "skill-creator/agents/generate-skill.md",
] as const;

const AGENT_SKILL_ROOTS = [
  path.join(REPO_ROOT, "agent-sources", "skills"),
  path.join(REPO_ROOT, "agent-sources", "workspace", "skills"),
  path.join(PLUGINS_DIR, "skill-content-researcher", "skills"),
  path.join(PLUGINS_DIR, "skill-creator", "skills"),
] as const;

/** Resolve the .md file path for any agent (top-level or plugin). */
function resolveAgentPath(agentName: string): string {
  if ((OPENHANDS_WORKFLOW_AGENTS as readonly string[]).includes(agentName)) {
    return path.join(WORKSPACE_AGENTS_DIR, `${agentName}.md`);
  }
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

function findSkillFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return findSkillFiles(entryPath);
      return entry.name === "SKILL.md" ? [entryPath] : [];
    })
    .sort();
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

  it("OpenHands workflow skills required by the runtime are present in bundled skill sources", () => {
    const missing = OPENHANDS_WORKFLOW_SKILLS.filter(
      (skill) =>
        !fs.existsSync(path.join(REPO_ROOT, "agent-sources", "skills", skill, "SKILL.md")),
    );

    expect(missing).toEqual([]);
  });

  it("creating-skills is focused on generation and verifier review", () => {
    const file = path.join(
      REPO_ROOT,
      "agent-sources",
      "skills",
      "creating-skills",
      "SKILL.md",
    );
    const fm = frontmatter(file);
    const content = fs.readFileSync(file, "utf8");

    expect(fm.name).toBe("creating-skills");
    expect(fm.description).toMatch(/writing a new reusable skill/i);
    expect(fm.description).not.toMatch(/workflow step|step \d/i);
    expect(content).toMatch(/Fresh-Context Verification/);
    expect(content).toMatch(/verifier-subagent-prompt\.md/);
    expect(content).toMatch(/run exactly one\s+re-verification pass/i);
    expect(content).toMatch(/Return the raw JSON object requested by the caller/i);
  });

  it("creating-skills does not include legacy lifecycle mechanics", () => {
    const file = path.join(
      REPO_ROOT,
      "agent-sources",
      "skills",
      "creating-skills",
      "SKILL.md",
    );
    const content = fs.readFileSync(file, "utf8");
    const forbidden = [
      /run_loop\.py/,
      /generate_report\.py/,
      /^## .*Blind comparison/im,
      /^## .*Description Optimization/im,
      /^## .*Benchmark/im,
      /commit and tag/i,
      /commit_all/,
      /create_skill_version_tag/,
    ];

    expect(forbidden.filter((pattern) => pattern.test(content))).toEqual([]);
  });
});

describe("AgentSkill frontmatter", () => {
  it("does not use colons in description values", () => {
    const offenders = AGENT_SKILL_ROOTS.flatMap(findSkillFiles).flatMap((file) => {
      const block = frontmatterBlock(file);
      return block
        .split(/\r?\n/)
        .map((line, index) => ({ file, line, lineNumber: index + 2 }))
        .filter(({ line }) => /^description:\s+.*:/.test(line));
    });

    expect(offenders).toEqual([]);
  });

  it("does not use unquoted single-line values containing YAML mapping separators", () => {
    const offenders = AGENT_SKILL_ROOTS.flatMap(findSkillFiles).flatMap((file) => {
      const block = frontmatterBlock(file);
      return block
        .split(/\r?\n/)
        .map((line, index) => ({ file, line, lineNumber: index + 2 }))
        .filter(({ line }) =>
          /^[A-Za-z_][A-Za-z0-9_-]*:\s+[^'"|>][^#]*:\s+/.test(line),
        );
    });

    expect(offenders).toEqual([]);
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
  const CREATING_SKILLS_PATH = path.join(
    REPO_ROOT,
    "agent-sources",
    "skills",
    "creating-skills",
    "SKILL.md",
  );

  const TARGET_FILES = [CREATING_SKILLS_PATH];

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
  const WORKSPACE_RESEARCHING_SKILL_PATH = path.join(
    REPO_ROOT,
    "agent-sources",
    "workspace",
    "skills",
    "researching-skill-requirements",
    "SKILL.md",
  );
  const WORKSPACE_RESEARCH_REFERENCES_DIR = path.join(
    REPO_ROOT,
    "agent-sources",
    "workspace",
    "skills",
    "researching-skill-requirements",
    "references",
  );

  it("workspace research skill is generalized for initial and detailed clarification research", () => {
    const content = fs.readFileSync(
      WORKSPACE_RESEARCHING_SKILL_PATH,
      "utf8",
    );
    expect(content).not.toMatch(
      /references\/(?:dimension-sets|scoring-rubric|consolidation-handoff)\.md/,
    );
    expect(content).not.toMatch(/references\/dimensions\//);
    expect(content).toMatch(/name: researching-skill-requirements/);
    expect(content).toMatch(/creation or refinement of a skill/i);
    expect(content).toMatch(/Step prompts own the exact JSON\s+envelope/i);
    expect(content).toMatch(/Scope Guard/i);
    expect(content).toMatch(/do not manufacture questions/i);
    expect(content).toMatch(/Initial research should create top-level sections/i);
    expect(content).toMatch(/Detailed\s+follow-up research should preserve/i);
    expect(content).toMatch(/Return exactly the object requested by the current step prompt/i);
    expect(content).not.toMatch(/research_complete/);
    expect(content).not.toMatch(/step-0-research\.json/);
  });

  it("workspace research legacy reference files are removed", () => {
    function findFiles(dir: string): string[] {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return findFiles(entryPath);
        return [entryPath];
      });
    }

    const legacyFiles = findFiles(WORKSPACE_RESEARCH_REFERENCES_DIR);

    expect(legacyFiles).toEqual([]);
  });

  it("research-agent includes scope recommendation short-circuit contract", () => {
    const content = fs.readFileSync(WORKSPACE_RESEARCHING_SKILL_PATH, "utf8");
    expect(content).toMatch(
      /Scope (Recommendation )?[Gg]uard|scope_recommendation/,
    );
    expect(content).toMatch(/do not manufacture questions/i);
    expect(content).toMatch(/Follow the current\s+step prompt for the exact output shape/i);
    expect(content).not.toMatch(/dimensions_selected": 0/);
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

  it("skill-creator generation phase routes through creating-skills", () => {
    const agentContent = fileContent("skill-creator");
    const skillContent = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "agent-sources",
        "skills",
        "creating-skills",
        "SKILL.md",
      ),
      "utf8",
    );
    const promptContent = fs.readFileSync(
      path.join(REPO_ROOT, "agent-sources", "prompts", "skill-generation.txt"),
      "utf8",
    );
    const content = `${agentContent}\n${skillContent}\n${promptContent}`;
    expect(content).toMatch(/workflow\.skill_generation/);
    expect(content).toMatch(/creating-skills/);
    expect(content).toMatch(/status.*generated/);
    expect(content).toMatch(/version_bump.*1\.0\.0/);
    expect(content).toMatch(/fresh[- ]context (?:verification|verifier)/i);
    expect(content).toMatch(/call_trace/);
    expect(agentContent).not.toMatch(/^\s+-\s+skill-validator\s*$/m);
    expect(agentContent).not.toMatch(/^\s+-\s+answer-evaluator\s*$/m);
  });

  it("rewrite-skill returns rewritten status", () => {
    const content = fs.readFileSync(resolveAgentPath("rewrite-skill"), "utf8");
    expect(content).toMatch(/status.*rewritten/);
    expect(content).toMatch(/call_trace/);
  });

  it("answer-evaluator returns verdict enum and per_question array", () => {
    const content = fs.readFileSync(
      path.join(REPO_ROOT, "agent-sources", "prompts", "answer-evaluator.txt"),
      "utf8",
    );
    expect(content).toMatch(/"verdict"/);
    expect(content).toMatch(/sufficient|mixed|insufficient/);
    expect(content).toMatch(/"per_question"/);
    expect(content).toMatch(/"answered_count"/);
    expect(content).toMatch(/Do not invoke\s+an answer-evaluator skill/i);
  });

  it("evaluate-skill prompt template matches SDK-enforced schema", () => {
    const content = fs.readFileSync(
      path.join(REPO_ROOT, "agent-sources/prompts/eval-initial.txt"),
      "utf8",
    );
    expect(content).toMatch(/"status":\s*"complete"/);
    expect(content).toMatch(/"iteration"/);
    expect(content).toMatch(/"results"/);
  });

  it("evaluate-skill prompt documents grading.json write paths", () => {
    const content = fs.readFileSync(
      path.join(REPO_ROOT, "agent-sources/prompts/eval-initial.txt"),
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

  it("embedded legacy research skill is internal-only (not user-invocable)", () => {
    const researchPath = path.join(
      pluginRoot,
      "skills",
      "research",
      "SKILL.md",
    );
    const fm = frontmatter(researchPath);
    expect(fm.name).toBe("research");
    expect(fm.user_invocable).toBe("false");
  });

  it("active workflow prompts avoid Claude routing mechanics", () => {
    const skillCreatorSkillPath = path.join(
      REPO_ROOT,
      "agent-sources",
      "skills",
      "creating-skills",
      "SKILL.md",
    );
    const legacyPluginSkillCreatorPath = path.join(
      REPO_ROOT,
      "agent-sources",
      "plugins",
      "skill-creator",
      "skills",
      "skill-creator",
      "SKILL.md",
    );
    const activeFiles = [
      resolveAgentPath("research-agent"),
      path.join(REPO_ROOT, "agent-sources", "prompts", "answer-evaluator.txt"),
      path.join(
        REPO_ROOT,
        "agent-sources",
        "workspace",
        "skills",
        "researching-skill-requirements",
        "SKILL.md",
      ),
      skillCreatorSkillPath,
      legacyPluginSkillCreatorPath,
    ];
    const forbiddenPatterns: Array<[string, RegExp]> = [
      ["Claude Code routing", /Claude Code/i],
      ["Claude tool names", /\b(?:AskUserQuestion|TaskOutput|TaskStop|StructuredOutput|bypassPermissions)\b/],
      ["Agent tool routing", /(?:\bAgent\b|\bSkill\b)\s+tool/i],
      ["sub-agent fan-out", /fan-?out|spawn .*parallel/i],
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
    expect(content).toMatch(/eval_name[\s\S]*slug[\s\S]*(?:expectations|assertions)/i);
    expect(schemaContent).toMatch(/evals\[\]\.eval_name/);
    expect(schemaContent).toMatch(/evals\[\]\.slug/);
    expect(schemaContent).toMatch(
      /written at eval creation time and frozen for subsequent benchmark iterations/i,
    );
  });
});

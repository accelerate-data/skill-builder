import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Resolve paths relative to the app directory.
// __dirname is src/__tests__/lib, so go up 3 levels to reach app/.
const APP_ROOT = path.resolve(__dirname, "../../..");
const MOCK_ROOT = path.join(APP_ROOT, "sidecar/mock-templates/outputs");
const FIXTURE_ROOT = path.join(APP_ROOT, "e2e/fixtures/agent-responses");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect files matching an extension from a directory */
function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Collect all .md files from mock templates and fixtures */
function collectMarkdownFiles(): string[] {
  const files: string[] = [];
  files.push(...findFiles(MOCK_ROOT, ".md"));
  files.push(...findFiles(FIXTURE_ROOT, ".md"));
  return files;
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function relPath(filePath: string): string {
  return path.relative(APP_ROOT, filePath);
}

// ---------------------------------------------------------------------------
// Anti-pattern checks (shared across all .md artifacts)
// ---------------------------------------------------------------------------

describe("Canonical format: anti-pattern checks (all markdown files)", () => {
  const mdFiles = collectMarkdownFiles();

  it("finds markdown files to check", () => {
    expect(mdFiles.length).toBeGreaterThan(0);
  });

  for (const file of mdFiles) {
    const rel = relPath(file);

    it(`${rel}: no **Answer**: (colon must be inside bold)`, () => {
      const content = readFile(file);
      expect(content).not.toMatch(/\*\*Answer\*\*:/);
    });

    it(`${rel}: no **Recommendation**: (colon must be inside bold)`, () => {
      const content = readFile(file);
      expect(content).not.toMatch(/\*\*Recommendation\*\*:/);
    });

    it(`${rel}: no checkbox choices (- [ ] / - [x])`, () => {
      const content = readFile(file);
      expect(content).not.toMatch(/^[ \t]*- \[[ x]\]/m);
    });

    it(`${rel}: no **Choices**: label`, () => {
      const content = readFile(file);
      expect(content).not.toMatch(/\*\*Choices\*\*[:\*]/);
    });

    it(`${rel}: no **Question**: label`, () => {
      const content = readFile(file);
      expect(content).not.toMatch(/\*\*Question\*\*[:\*]/);
    });

    it(`${rel}: no [MUST ANSWER] inline tags`, () => {
      const content = readFile(file);
      expect(content).not.toMatch(/\[MUST ANSWER\]/);
    });
  }
});

// ---------------------------------------------------------------------------
// clarifications.json structural checks (step0 + step1 + review-content.json)
// ---------------------------------------------------------------------------

describe("Canonical format: clarifications.json structure", () => {
  const clarificationFiles = [
    path.join(MOCK_ROOT, "step0/context/clarifications.json"),
    path.join(MOCK_ROOT, "step1/context/clarifications.json"),
    path.join(FIXTURE_ROOT, "review-content.json"),
  ].filter((f) => fs.existsSync(f));

  it("finds clarification files to check", () => {
    expect(clarificationFiles.length).toBeGreaterThan(0);
  });

  for (const file of clarificationFiles) {
    const rel = relPath(file);

    describe(rel, () => {
      const raw = readFile(file);

      it("is valid JSON", () => {
        expect(() => JSON.parse(raw)).not.toThrow();
      });

      const data = JSON.parse(raw);

      it("has version field set to '1'", () => {
        expect(data.version).toBe("1");
      });

      it("has metadata with question_count", () => {
        expect(typeof data.metadata.question_count).toBe("number");
      });

      it("has metadata with section_count", () => {
        expect(typeof data.metadata.section_count).toBe("number");
      });

      it("has metadata with refinement_count", () => {
        expect(typeof data.metadata.refinement_count).toBe("number");
      });

      it("has metadata with must_answer_count", () => {
        expect(typeof data.metadata.must_answer_count).toBe("number");
      });

      it("has metadata with priority_questions array", () => {
        expect(Array.isArray(data.metadata.priority_questions)).toBe(true);
      });

      it("has sections array matching section_count", () => {
        expect(Array.isArray(data.sections)).toBe(true);
        expect(data.sections.length).toBe(data.metadata.section_count);
      });

      it("sections have id, title, and questions", () => {
        for (const section of data.sections) {
          expect(section.id).toMatch(/^S\d+$/);
          expect(typeof section.title).toBe("string");
          expect(Array.isArray(section.questions)).toBe(true);
        }
      });

      it("questions have required fields", () => {
        for (const section of data.sections) {
          for (const q of section.questions) {
            expect(q.id).toMatch(/^Q\d+$/);
            expect(typeof q.title).toBe("string");
            expect(typeof q.must_answer).toBe("boolean");
            expect(typeof q.text).toBe("string");
            expect(Array.isArray(q.choices)).toBe(true);
            expect(Array.isArray(q.refinements)).toBe(true);
          }
        }
      });

      it("choices have id, text, and is_other", () => {
        for (const section of data.sections) {
          for (const q of section.questions) {
            for (const c of q.choices) {
              expect(c.id).toMatch(/^[A-E]$/);
              expect(typeof c.text).toBe("string");
              expect(typeof c.is_other).toBe("boolean");
            }
          }
        }
      });

      it("has notes array", () => {
        expect(Array.isArray(data.notes)).toBe(true);
      });

      it("has answer_evaluator_notes array", () => {
        expect(Array.isArray(data.answer_evaluator_notes ?? [])).toBe(true);
      });
    });
  }

  // Step1-specific refinement checks (Detailed Research)
  const step1 = path.join(MOCK_ROOT, "step1/context/clarifications.json");
  if (fs.existsSync(step1)) {
    describe("step1 refinements", () => {
      const data = JSON.parse(readFile(step1));

      it("has refinement_count > 0", () => {
        expect(data.metadata.refinement_count).toBeGreaterThan(0);
      });

      it("has questions with non-empty refinements arrays", () => {
        const hasRefinements = data.sections.some(
          (s: { questions: Array<{ refinements: unknown[] }> }) =>
            s.questions.some((q) => q.refinements.length > 0),
        );
        expect(hasRefinements).toBe(true);
      });

      it("refinements have R{n}.{m} style IDs", () => {
        for (const section of data.sections) {
          for (const q of section.questions) {
            for (const r of q.refinements) {
              expect(r.id).toMatch(/^R\d+\.\d+/);
            }
          }
        }
      });
    });
  }

  it("accepts canonical minimal scope recommendation output with reason fields", () => {
    const minimal = {
      version: "1",
      metadata: {
        title: "Scope Recommendation",
        question_count: 0,
        section_count: 0,
        refinement_count: 0,
        must_answer_count: 0,
        priority_questions: [],
        scope_recommendation: true,
        scope_reason: "Explicit throwaway intent detected.",
        scope_next_action: "Provide a concrete domain and rerun research.",
      },
      sections: [],
      notes: [
        {
          type: "blocked",
          title: "Scope Recommendation Active",
          body: "Narrow the skill scope to a meaningful production topic.",
        },
      ],
    };

    expect(minimal.version).toBe("1");
    expect(minimal.metadata.scope_recommendation).toBe(true);
    expect(minimal.metadata.question_count).toBe(0);
    expect(minimal.metadata.section_count).toBe(0);
    expect(minimal.metadata.refinement_count).toBe(0);
    expect(minimal.metadata.must_answer_count).toBe(0);
    expect(Array.isArray(minimal.metadata.priority_questions)).toBe(true);
    expect(Array.isArray(minimal.sections)).toBe(true);
    expect(minimal.sections).toHaveLength(0);
    expect(Array.isArray(minimal.notes)).toBe(true);
    expect(minimal.notes[0]?.type).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// decisions.md structural checks (step2)
// ---------------------------------------------------------------------------

describe("Canonical format: decisions.md structure", () => {
  const decisionsFile = path.join(MOCK_ROOT, "step2/context/decisions.md");

  it("decisions.md exists", () => {
    expect(fs.existsSync(decisionsFile)).toBe(true);
  });

  if (fs.existsSync(decisionsFile)) {
    const content = readFile(decisionsFile);
    const normalizedContent = content.replace(/\r\n/g, "\n");

    it("has YAML frontmatter with decision_count", () => {
      expect(normalizedContent).toMatch(/^---\n[\s\S]*?decision_count:/m);
    });

    it("has YAML frontmatter with conflicts_resolved", () => {
      expect(normalizedContent).toMatch(/^---\n[\s\S]*?conflicts_resolved:/m);
    });

    it("has YAML frontmatter with round", () => {
      expect(normalizedContent).toMatch(/^---\n[\s\S]*?round:/m);
    });

    it("has ### D{N}: decision headings (H3)", () => {
      expect(content).toMatch(/^### D\d+:/m);
    });

    it("no ## D{N}: headings (H2 is old format)", () => {
      expect(content).not.toMatch(/^## D\d+:/m);
    });

    it("has **Original question:** fields", () => {
      expect(content).toMatch(/\*\*Original question:\*\*/);
    });

    it("has **Decision:** fields", () => {
      expect(content).toMatch(/\*\*Decision:\*\*/);
    });

    it("has **Implication:** fields", () => {
      expect(content).toMatch(/\*\*Implication:\*\*/);
    });

    it("has **Status:** fields", () => {
      expect(content).toMatch(/\*\*Status:\*\*/);
    });

    it("has resolved status value", () => {
      expect(content).toMatch(/\*\*Status:\*\* resolved/);
    });
  }
});

// ---------------------------------------------------------------------------
// research-plan.md structural checks (step0)
// ---------------------------------------------------------------------------

describe("Canonical format: research-plan.md structure", () => {
  const researchPlan = path.join(MOCK_ROOT, "step0/context/research-plan.md");

  it("research-plan.md exists", () => {
    expect(fs.existsSync(researchPlan)).toBe(true);
  });

  if (fs.existsSync(researchPlan)) {
    const content = readFile(researchPlan);

    it("has frontmatter with purpose", () => {
      expect(content).toMatch(/^---\n[\s\S]*?purpose:/m);
    });

    it("has frontmatter with dimensions_evaluated", () => {
      expect(content).toMatch(/^---\n[\s\S]*?dimensions_evaluated:/m);
    });

    it("has frontmatter with dimensions_selected", () => {
      expect(content).toMatch(/^---\n[\s\S]*?dimensions_selected:/m);
    });

    it("has ## Dimension Scores section", () => {
      expect(content).toMatch(/^## Dimension Scores/m);
    });

    it("has ## Selected Dimensions section", () => {
      expect(content).toMatch(/^## Selected Dimensions/m);
    });
  }
});

// ---------------------------------------------------------------------------
// answer-evaluation.json structural checks (gate mock)
// ---------------------------------------------------------------------------

describe("Canonical format: answer-evaluation.json structure", () => {
  const evalFile = path.join(
    MOCK_ROOT,
    "gate-answer-evaluator/answer-evaluation.json",
  );

  it("answer-evaluation.json exists", () => {
    expect(fs.existsSync(evalFile)).toBe(true);
  });

  if (fs.existsSync(evalFile)) {
    const raw = readFile(evalFile);

    it("is valid JSON", () => {
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    const data = JSON.parse(raw);

    it("has verdict field with valid value", () => {
      expect(data.verdict).toBeDefined();
      expect(["sufficient", "mixed", "insufficient"]).toContain(data.verdict);
    });

    it("has answered_count as number", () => {
      expect(typeof data.answered_count).toBe("number");
    });

    it("has empty_count as number", () => {
      expect(typeof data.empty_count).toBe("number");
    });

    it("has vague_count as number", () => {
      expect(typeof data.vague_count).toBe("number");
    });

    it("has total_count as number", () => {
      expect(typeof data.total_count).toBe("number");
    });

    it("has reasoning as string", () => {
      expect(typeof data.reasoning).toBe("string");
    });

    it("counts add up: answered + empty + vague + contradictory == total", () => {
      const contradictoryCount = typeof data.contradictory_count === "number"
        ? data.contradictory_count
        : 0;
      expect(data.answered_count + data.empty_count + data.vague_count + contradictoryCount).toBe(
        data.total_count,
      );
    });

    it("has per_question array", () => {
      expect(Array.isArray(data.per_question)).toBe(true);
    });

    it("per_question length matches total_count", () => {
      expect(data.per_question.length).toBe(data.total_count);
    });

    it("per_question entries have question_id and verdict", () => {
      for (const entry of data.per_question) {
        expect(entry.question_id).toMatch(/^(Q\d+|R\d+\.\d+[a-z]?)$/);
        expect(["clear", "needs_refinement", "not_answered", "vague", "contradictory"]).toContain(entry.verdict);
        if (entry.verdict === "vague") {
          expect(typeof entry.reason).toBe("string");
          expect(entry.reason.trim().length).toBeGreaterThan(0);
        } else if (entry.verdict === "contradictory") {
          expect(typeof entry.reason).toBe("string");
          expect(entry.reason.trim().length).toBeGreaterThan(0);
          expect(typeof entry.contradicts).toBe("string");
          expect(entry.contradicts).toMatch(/^(Q\d+|R\d+\.\d+[a-z]?)$/);
        } else {
          expect(entry.reason).toBeUndefined();
        }
      }
    });

    it("per_question verdict counts match aggregates", () => {
      const clear = data.per_question.filter(
        (e: { verdict: string }) => e.verdict === "clear",
      ).length;
      const needsRefinement = data.per_question.filter(
        (e: { verdict: string }) => e.verdict === "needs_refinement",
      ).length;
      const notAnswered = data.per_question.filter(
        (e: { verdict: string }) => e.verdict === "not_answered",
      ).length;
      const vague = data.per_question.filter(
        (e: { verdict: string }) => e.verdict === "vague",
      ).length;
      const contradictory = data.per_question.filter(
        (e: { verdict: string }) => e.verdict === "contradictory",
      ).length;
      expect(clear + needsRefinement).toBe(data.answered_count);
      expect(notAnswered).toBe(data.empty_count);
      expect(vague).toBe(data.vague_count);
      if (typeof data.contradictory_count === "number") {
        expect(contradictory).toBe(data.contradictory_count);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// user-context.md — generated at runtime by Rust (format_user_context)
// ---------------------------------------------------------------------------

// Note: user-context.md is generated at runtime by the Rust function
// `format_user_context` in workflow.rs. Its format is validated by Rust
// unit tests (`cargo test commands::workflow`). No mock template exists
// for this artifact.

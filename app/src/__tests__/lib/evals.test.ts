import { describe, it, expect } from "vitest";
import {
  EMPTY_TEST_CASE,
  addExpectation,
  applyExpectationChange,
  applyNameChange,
  buildEvalGenPrompt,
  buildRegenPrompt,
  iterationLabel,
  prepareForSave,
  removeExpectation,
  suggestEvalPlaceholder,
  toSlug,
  truncatePrompt,
  validateTestCaseForm,
} from "@/lib/evals";
import type { TestCase } from "@/lib/types";

// Helper: build a minimal valid eval
function makeCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 1,
    eval_name: "Customer returns",
    slug: "customer-returns",
    prompt: "Handle a return",
    files: [],
    expectations: ["Refund is issued"],
    ...overrides,
  };
}

// --- toSlug ---

describe("toSlug", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(toSlug("Customer Returns Workflow")).toBe("customer-returns-workflow");
  });

  it("collapses consecutive non-alphanumeric chars into one dash", () => {
    expect(toSlug("hello   world!")).toBe("hello-world");
  });

  it("trims leading and trailing dashes", () => {
    expect(toSlug("  hello  ")).toBe("hello");
  });

  it("handles special characters", () => {
    expect(toSlug("foo/bar & baz")).toBe("foo-bar-baz");
  });

  it("returns empty string for empty input", () => {
    expect(toSlug("")).toBe("");
  });

  it("preserves numbers", () => {
    expect(toSlug("Test Case 2")).toBe("test-case-2");
  });
});

// --- truncatePrompt ---

describe("truncatePrompt", () => {
  it("returns short strings unchanged", () => {
    expect(truncatePrompt("Short prompt")).toBe("Short prompt");
  });

  it("appends ellipsis when over default maxLen (60)", () => {
    const long = "a".repeat(61);
    const result = truncatePrompt(long);
    expect(result).toHaveLength(61); // 60 chars + ellipsis char
    expect(result.endsWith("…")).toBe(true);
  });

  it("does not truncate string exactly at maxLen", () => {
    const exact = "a".repeat(60);
    expect(truncatePrompt(exact)).toBe(exact);
  });

  it("respects custom maxLen", () => {
    const result = truncatePrompt("hello world", 5);
    expect(result).toBe("hello…");
  });

  it("returns empty string unchanged", () => {
    expect(truncatePrompt("")).toBe("");
  });
});

// --- applyNameChange ---

describe("applyNameChange", () => {
  it("updates eval_name and auto-generates slug on create (isEdit=false)", () => {
    const result = applyNameChange(makeCase(), "New Name", false);
    expect(result.eval_name).toBe("New Name");
    expect(result.slug).toBe("new-name");
  });

  it("updates eval_name but preserves existing slug on edit (isEdit=true)", () => {
    const tc = makeCase({ slug: "original-slug" });
    const result = applyNameChange(tc, "New Name", true);
    expect(result.eval_name).toBe("New Name");
    expect(result.slug).toBe("original-slug");
  });

  it("does not mutate the original form", () => {
    const original = makeCase();
    applyNameChange(original, "Changed", false);
    expect(original.eval_name).toBe("Customer returns");
  });
});

// --- applyExpectationChange ---

describe("applyExpectationChange", () => {
  it("updates the expectation at the given index", () => {
    const tc = makeCase({ expectations: ["first", "second", "third"] });
    const result = applyExpectationChange(tc, 1, "updated");
    expect(result.expectations).toEqual(["first", "updated", "third"]);
  });

  it("leaves other indices unchanged", () => {
    const tc = makeCase({ expectations: ["a", "b"] });
    const result = applyExpectationChange(tc, 0, "x");
    expect(result.expectations[1]).toBe("b");
  });

  it("does not mutate the original", () => {
    const tc = makeCase({ expectations: ["original"] });
    applyExpectationChange(tc, 0, "changed");
    expect(tc.expectations[0]).toBe("original");
  });
});

// --- addExpectation ---

describe("addExpectation", () => {
  it("appends an empty string to expectations", () => {
    const tc = makeCase({ expectations: ["first"] });
    const result = addExpectation(tc);
    expect(result.expectations).toEqual(["first", ""]);
  });

  it("does not mutate the original", () => {
    const tc = makeCase({ expectations: ["x"] });
    addExpectation(tc);
    expect(tc.expectations).toHaveLength(1);
  });
});

// --- removeExpectation ---

describe("removeExpectation", () => {
  it("removes the expectation at the given index", () => {
    const tc = makeCase({ expectations: ["a", "b", "c"] });
    const result = removeExpectation(tc, 1);
    expect(result.expectations).toEqual(["a", "c"]);
  });

  it("removes the first item correctly", () => {
    const tc = makeCase({ expectations: ["x", "y"] });
    expect(removeExpectation(tc, 0).expectations).toEqual(["y"]);
  });

  it("does not mutate the original", () => {
    const tc = makeCase({ expectations: ["a", "b"] });
    removeExpectation(tc, 0);
    expect(tc.expectations).toHaveLength(2);
  });
});

// --- validateTestCaseForm ---

describe("validateTestCaseForm", () => {
  it("returns null for a valid form", () => {
    expect(validateTestCaseForm(makeCase())).toBeNull();
  });

  it("returns error when eval_name is empty", () => {
    const tc = makeCase({ eval_name: "" });
    expect(validateTestCaseForm(tc)).toMatch(/name is required/i);
  });

  it("returns error when eval_name is whitespace only", () => {
    const tc = makeCase({ eval_name: "   " });
    expect(validateTestCaseForm(tc)).toMatch(/name is required/i);
  });

  it("returns error when all expectations are empty", () => {
    const tc = makeCase({ expectations: ["", "  "] });
    expect(validateTestCaseForm(tc)).toMatch(/expectation/i);
  });

  it("accepts a form with one non-empty expectation among blanks", () => {
    const tc = makeCase({ expectations: ["", "valid assertion", ""] });
    expect(validateTestCaseForm(tc)).toBeNull();
  });
});

// --- prepareForSave ---

describe("prepareForSave", () => {
  it("removes blank expectation rows", () => {
    const tc = makeCase({ expectations: ["valid", "", "  ", "also valid"] });
    const result = prepareForSave(tc);
    expect(result.expectations).toEqual(["valid", "also valid"]);
  });

  it("keeps all non-blank expectations", () => {
    const tc = makeCase({ expectations: ["a", "b"] });
    expect(prepareForSave(tc).expectations).toEqual(["a", "b"]);
  });

  it("does not mutate the original", () => {
    const tc = makeCase({ expectations: ["x", ""] });
    prepareForSave(tc);
    expect(tc.expectations).toHaveLength(2);
  });
});

// --- iterationLabel ---

describe("iterationLabel", () => {
  it("returns 'latest' for the highest iteration", () => {
    expect(iterationLabel(3, 3)).toBe("latest");
  });

  it("returns '#N' for non-latest iterations", () => {
    expect(iterationLabel(1, 3)).toBe("#1");
    expect(iterationLabel(2, 3)).toBe("#2");
  });
});

// --- EMPTY_TEST_CASE ---

describe("EMPTY_TEST_CASE", () => {
  it("has id 0 (new record sentinel)", () => {
    expect(EMPTY_TEST_CASE.id).toBe(0);
  });

  it("has one empty expectation row", () => {
    expect(EMPTY_TEST_CASE.expectations).toEqual([""]);
  });

  it("does not have expected_output field", () => {
    expect("expected_output" in EMPTY_TEST_CASE).toBe(false);
  });
});

// --- buildEvalGenPrompt ---

describe("buildEvalGenPrompt", () => {
  it("includes the skill name in the prompt", () => {
    const ctx = { skill_content: "# My Skill", existing_evals: [] };
    const result = buildEvalGenPrompt(ctx, "my-skill", "/skills", "test intent");
    expect(result).toContain("my-skill");
  });

  it("includes skill content in the prompt", () => {
    const ctx = { skill_content: "# Special Skill Content", existing_evals: [] };
    const result = buildEvalGenPrompt(ctx, "test-skill", "/skills", "test intent");
    expect(result).toContain("Special Skill Content");
  });

  it("lists existing eval names for deduplication", () => {
    const ctx = {
      skill_content: "",
      existing_evals: [makeCase({ eval_name: "Happy path" }), makeCase({ eval_name: "Edge case" })],
    };
    const result = buildEvalGenPrompt(ctx, "my-skill", "/skills", "test intent");
    expect(result).toContain("Happy path");
    expect(result).toContain("Edge case");
  });

  it("includes the output file path", () => {
    const ctx = { skill_content: "", existing_evals: [] };
    const result = buildEvalGenPrompt(ctx, "customer-returns", "/home/user/skills", "test intent");
    expect(result).toContain("/home/user/skills/customer-returns/evals/pending-eval.json");
  });

  it("uses fallback text when skill content is empty", () => {
    const ctx = { skill_content: "", existing_evals: [] };
    const result = buildEvalGenPrompt(ctx, "my-skill", "/skills", "test intent");
    expect(result).toContain("no SKILL.md found");
  });

  it("includes the user intent in the scenario section", () => {
    const ctx = { skill_content: "", existing_evals: [] };
    const result = buildEvalGenPrompt(ctx, "my-skill", "/skills", "SCD type 2 insert creates a new row");
    expect(result).toContain("SCD type 2 insert creates a new row");
  });
});

// --- buildRegenPrompt ---

describe("buildRegenPrompt", () => {
  it("includes the updated intent", () => {
    const result = buildRegenPrompt("handle a return request", "# Skill", "my-skill", "/skills");
    expect(result).toContain("handle a return request");
  });

  it("includes the skill name", () => {
    const result = buildRegenPrompt("some intent", "# Skill", "customer-returns", "/skills");
    expect(result).toContain("customer-returns");
  });

  it("includes the output file path", () => {
    const result = buildRegenPrompt("intent", "# Skill", "my-skill", "/home/user/skills");
    expect(result).toContain("/home/user/skills/my-skill/evals/pending-eval.json");
  });

  it("uses fallback text when skill content is empty", () => {
    const result = buildRegenPrompt("intent", "", "my-skill", "/skills");
    expect(result).toContain("no SKILL.md found");
  });

  it("includes skill content when provided", () => {
    const result = buildRegenPrompt("intent", "# Special Skill Content", "my-skill", "/skills");
    expect(result).toContain("Special Skill Content");
  });
});

// --- suggestEvalPlaceholder ---

describe("suggestEvalPlaceholder", () => {
  it("returns a skill-aware placeholder from frontmatter description", () => {
    const content = `---
name: my-skill
description: Transforms raw data into SCD type 2 snapshots for historical tracking
---

# My Skill
`;
    const result = suggestEvalPlaceholder(content);
    expect(result).toMatch(/^e\.g\./);
    expect(result).toContain("Transforms raw data");
  });

  it("truncates long descriptions to 80 chars", () => {
    const longDesc = "a".repeat(100);
    const content = `---\ndescription: ${longDesc}\n---\n`;
    const result = suggestEvalPlaceholder(content);
    // "e.g. " (5) + 80 chars + "…" = 86 chars
    expect(result.length).toBeLessThanOrEqual(86);
    expect(result.endsWith("…")).toBe(true);
  });

  it("splits on period and uses only the first clause", () => {
    const content = `---\ndescription: First clause. Second clause.\n---\n`;
    const result = suggestEvalPlaceholder(content);
    expect(result).toContain("First clause");
    expect(result).not.toContain("Second clause");
  });

  it("returns generic fallback when no frontmatter", () => {
    const result = suggestEvalPlaceholder("# No frontmatter here");
    expect(result).toBe("e.g. a user runs a typical workflow end-to-end");
  });

  it("returns generic fallback when frontmatter has no description", () => {
    const content = `---\nname: my-skill\nversion: 1.0\n---\n# Skill`;
    const result = suggestEvalPlaceholder(content);
    expect(result).toBe("e.g. a user runs a typical workflow end-to-end");
  });
});

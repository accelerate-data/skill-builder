import { describe, it, expect } from "vitest";
import {
  EMPTY_TEST_CASE,
  addExpectation,
  applyExpectationChange,
  applyNameChange,
  buildRefineMessage,
  iterationLabel,
  mergeQueuedEvals,
  pendingToTestCase,
  prepareForSave,
  removeExpectation,
  suggestEvalPlaceholder,
  toSlug,
  totalRunCount,
  truncatePrompt,
  validateTestCaseForm,
  workspaceSkillDir,
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

// --- workspaceSkillDir ---

describe("workspaceSkillDir", () => {
  it("uses flat layout for default plugin slug", () => {
    expect(workspaceSkillDir("/workspace", "skills", "my-skill")).toBe(
      "/workspace/skills/my-skill",
    );
  });

  it("uses plugin-prefixed layout for non-default plugin", () => {
    expect(workspaceSkillDir("/workspace", "my-plugin", "my-skill")).toBe(
      "/workspace/my-plugin/my-skill",
    );
  });
});

// --- mergeQueuedEvals ---

describe("mergeQueuedEvals", () => {
  it("appends queued evals to existing context", () => {
    const ctx = { skill_content: "# Skill", existing_evals: [makeCase({ id: 1 })] };
    const queue = [makeCase({ id: 0, eval_name: "Queued" })];
    const result = mergeQueuedEvals(ctx, queue);
    expect(result.existing_evals).toHaveLength(2);
    expect(result.existing_evals[1].eval_name).toBe("Queued");
  });

  it("does not mutate original context", () => {
    const ctx = { skill_content: "", existing_evals: [makeCase()] };
    mergeQueuedEvals(ctx, [makeCase({ id: 2 })]);
    expect(ctx.existing_evals).toHaveLength(1);
  });
});

// --- pendingToTestCase ---

describe("pendingToTestCase", () => {
  it("converts a PendingEval to TestCase with default id and files", () => {
    const pending = { eval_name: "Test", slug: "test", prompt: "Do X", expectations: ["Y"] };
    const result = pendingToTestCase(pending);
    expect(result.id).toBe(0);
    expect(result.files).toEqual([]);
    expect(result.eval_name).toBe("Test");
    expect(result.prompt).toBe("Do X");
  });
});

// --- totalRunCount ---

describe("totalRunCount", () => {
  it("returns evalCount * runsPerEval without comparison mode", () => {
    expect(totalRunCount(3, 2, undefined)).toBe(6);
  });

  it("doubles the count when comparison mode is set", () => {
    expect(totalRunCount(3, 2, "with-without")).toBe(12);
  });

  it("returns 0 when evalCount is 0", () => {
    expect(totalRunCount(0, 5, undefined)).toBe(0);
  });
});

// --- buildRefineMessage ---

describe("buildRefineMessage", () => {
  it("formats failed paths as eval lines with blank line between evals", () => {
    const failed = [
      { eval_name: "Scenario A", grading_paths: ["/path/a/run-0/grading.json", "/path/a/run-1/grading.json"] },
      { eval_name: "Scenario B", grading_paths: ["/path/b/run-0/grading.json"] },
    ];
    const result = buildRefineMessage(failed);
    expect(result).toContain("eval `Scenario A`: /path/a/run-0/grading.json");
    expect(result).toContain("eval `Scenario A`: /path/a/run-1/grading.json");
    expect(result).toContain("eval `Scenario B`: /path/b/run-0/grading.json");
    expect(result).toContain("\n\n");
  });

  it("returns empty string for empty array", () => {
    expect(buildRefineMessage([])).toBe("");
  });
});

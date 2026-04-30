import { describe, it, expect } from "vitest";
import { extractResultMarkdown } from "../lib/result-extraction.js";

// ---------------------------------------------------------------------------
// extractResultMarkdown
// ---------------------------------------------------------------------------

describe("extractResultMarkdown", () => {
  it("returns undefined for null input", () => {
    expect(extractResultMarkdown(null)).toBeUndefined();
  });

  it("returns undefined for non-object input", () => {
    expect(extractResultMarkdown("string")).toBeUndefined();
    expect(extractResultMarkdown(42)).toBeUndefined();
    expect(extractResultMarkdown(undefined)).toBeUndefined();
  });

  it("returns undefined when no *_markdown keys exist", () => {
    expect(extractResultMarkdown({ status: "ok", data: 123 })).toBeUndefined();
  });

  it("returns undefined when *_markdown value is empty string", () => {
    expect(extractResultMarkdown({ result_markdown: "" })).toBeUndefined();
  });

  it("returns undefined when *_markdown value is not a string", () => {
    expect(extractResultMarkdown({ result_markdown: 42 })).toBeUndefined();
    expect(extractResultMarkdown({ result_markdown: null })).toBeUndefined();
  });

  it("extracts a single _markdown field", () => {
    const result = extractResultMarkdown({ result_markdown: "# Hello" });
    expect(result).toBe("# Hello");
  });

  it("joins multiple _markdown fields with divider", () => {
    const result = extractResultMarkdown({
      summary_markdown: "Summary here",
      detail_markdown: "Detail here",
    });
    expect(result).toBe("Summary here\n\n---\n\nDetail here");
  });

  it("skips non-string and empty _markdown fields", () => {
    const result = extractResultMarkdown({
      valid_markdown: "Good",
      empty_markdown: "",
      number_markdown: 42,
      another_markdown: "Also good",
    });
    expect(result).toBe("Good\n\n---\n\nAlso good");
  });

  it("ignores keys that don't end in _markdown", () => {
    const result = extractResultMarkdown({
      markdown_result: "ignored",
      result_markdown: "included",
    });
    expect(result).toBe("included");
  });
});

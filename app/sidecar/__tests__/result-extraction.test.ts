import { describe, it, expect } from "vitest";
import { extractResultMarkdown, tryParseJsonFromText } from "../lib/result-extraction";

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

// ---------------------------------------------------------------------------
// tryParseJsonFromText
// ---------------------------------------------------------------------------

describe("tryParseJsonFromText", () => {
  it("parses valid JSON directly", () => {
    expect(tryParseJsonFromText('{"key": "value"}')).toEqual({ key: "value" });
  });

  it("parses JSON wrapped in code fences", () => {
    const text = "```json\n{\"key\": \"value\"}\n```";
    expect(tryParseJsonFromText(text)).toEqual({ key: "value" });
  });

  it("parses JSON wrapped in plain code fences (no language tag)", () => {
    const text = "```\n{\"key\": \"value\"}\n```";
    expect(tryParseJsonFromText(text)).toEqual({ key: "value" });
  });

  it("returns undefined for invalid JSON", () => {
    expect(tryParseJsonFromText("not json at all")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(tryParseJsonFromText("")).toBeUndefined();
  });

  it("parses JSON arrays", () => {
    expect(tryParseJsonFromText("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("handles whitespace around fences", () => {
    const text = "```json\n  { \"a\": 1 }  \n```  ";
    expect(tryParseJsonFromText(text)).toEqual({ a: 1 });
  });

  it("parses primitive JSON values", () => {
    expect(tryParseJsonFromText('"hello"')).toBe("hello");
    expect(tryParseJsonFromText("42")).toBe(42);
    expect(tryParseJsonFromText("true")).toBe(true);
    expect(tryParseJsonFromText("null")).toBeNull();
  });

  it("extracts JSON from text with preamble before code fence", () => {
    const text = 'Here is the result:\n\n```json\n{"status": "research_complete", "count": 3}\n```';
    expect(tryParseJsonFromText(text)).toEqual({ status: "research_complete", count: 3 });
  });

  it("extracts JSON from text with preamble and postamble around code fence", () => {
    const text = 'I completed the research.\n\n```json\n{"status": "done"}\n```\n\nLet me know if you need more.';
    expect(tryParseJsonFromText(text)).toEqual({ status: "done" });
  });

  it("extracts JSON object from plain text without code fences", () => {
    const text = 'Now I have all the outputs. Let me consolidate:\n\n{"status": "research_complete", "dimensions_selected": 3}';
    expect(tryParseJsonFromText(text)).toEqual({ status: "research_complete", dimensions_selected: 3 });
  });

  it("handles nested braces in brace-matching extraction", () => {
    const text = 'Result:\n{"outer": {"inner": "value"}, "count": 1}';
    expect(tryParseJsonFromText(text)).toEqual({ outer: { inner: "value" }, count: 1 });
  });

  it("handles strings with braces in brace-matching extraction", () => {
    const text = 'Output:\n{"message": "use {name} placeholder", "ok": true}';
    expect(tryParseJsonFromText(text)).toEqual({ message: "use {name} placeholder", ok: true });
  });

  it("returns undefined when no valid JSON exists anywhere", () => {
    expect(tryParseJsonFromText("Just some text with no JSON at all")).toBeUndefined();
  });

  it("returns undefined for malformed JSON in code fence", () => {
    const text = '```json\n{invalid json}\n```';
    expect(tryParseJsonFromText(text)).toBeUndefined();
  });
});

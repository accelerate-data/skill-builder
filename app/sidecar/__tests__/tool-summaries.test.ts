import { describe, it, expect } from "vitest";
import { truncate, computeToolSummary } from "../tool-summaries.js";

describe("truncate", () => {
  it("returns short strings unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates long strings with ellipsis", () => {
    expect(truncate("hello world", 5)).toBe("hello...");
  });

  it("handles exact-length strings", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });
});

describe("computeToolSummary", () => {
  it("returns tool name when no input", () => {
    expect(computeToolSummary("Read", undefined)).toBe("Read");
  });

  it("summarizes Read with file_path", () => {
    expect(computeToolSummary("Read", { file_path: "/home/user/foo.ts" })).toBe("Reading foo.ts");
  });

  it("summarizes Write with file_path", () => {
    expect(computeToolSummary("Write", { file_path: "/tmp/bar.json" })).toBe("Writing bar.json");
  });

  it("summarizes Edit with file_path", () => {
    expect(computeToolSummary("Edit", { file_path: "C:\\Users\\dev\\file.rs" })).toBe("Editing file.rs");
  });

  it("summarizes Bash with command", () => {
    expect(computeToolSummary("Bash", { command: "npm install" })).toBe("Running: npm install");
  });

  it("summarizes Grep with pattern", () => {
    expect(computeToolSummary("Grep", { pattern: "TODO" })).toBe('Grep: "TODO"');
  });

  it("summarizes Grep with pattern and path", () => {
    expect(computeToolSummary("Grep", { pattern: "TODO", path: "/src/lib" })).toBe('Grep: "TODO" in lib');
  });

  it("summarizes Glob with pattern", () => {
    expect(computeToolSummary("Glob", { pattern: "**/*.ts" })).toBe("Glob: **/*.ts");
  });

  it("summarizes WebSearch with query", () => {
    expect(computeToolSummary("WebSearch", { query: "rust async" })).toBe('Web search: "rust async"');
  });

  it("summarizes WebFetch with url", () => {
    expect(computeToolSummary("WebFetch", { url: "https://example.com" })).toBe("Fetching: https://example.com");
  });

  it("summarizes Task with description", () => {
    expect(computeToolSummary("Task", { description: "Analyze code" })).toBe("Agent: Analyze code");
  });

  it("summarizes Agent with description", () => {
    expect(computeToolSummary("Agent", { description: "Review PR" })).toBe("Agent: Review PR");
  });

  it("summarizes NotebookEdit with notebook_path", () => {
    expect(computeToolSummary("NotebookEdit", { notebook_path: "/nb/analysis.ipynb" })).toBe("Editing notebook analysis.ipynb");
  });

  it("summarizes LS with path", () => {
    expect(computeToolSummary("LS", { path: "/src" })).toBe("Listing /src");
  });

  it("falls back to name + first string value for unknown tools", () => {
    expect(computeToolSummary("CustomTool", { arg: "value" })).toBe("CustomTool: value");
  });

  it("falls back to name when input has no string values", () => {
    expect(computeToolSummary("CustomTool", { count: 42 })).toBe("CustomTool");
  });
});

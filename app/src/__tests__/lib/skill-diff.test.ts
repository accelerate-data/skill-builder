import { describe, it, expect } from "vitest";
import { computeLineDiff } from "@/lib/skill-diff";

describe("computeLineDiff", () => {
  it("returns all lines as unchanged when input is identical", () => {
    const text = "line one\nline two\nline three";
    const result = computeLineDiff(text, text);

    expect(result).toEqual([
      { type: "unchanged", content: "line one" },
      { type: "unchanged", content: "line two" },
      { type: "unchanged", content: "line three" },
    ]);
  });

  it("returns all lines as added when before is empty", () => {
    const result = computeLineDiff("", "hello\nworld");

    expect(result).toEqual([
      { type: "added", content: "hello" },
      { type: "added", content: "world" },
    ]);
  });

  it("returns all lines as removed when after is empty", () => {
    const result = computeLineDiff("hello\nworld", "");

    expect(result).toEqual([
      { type: "removed", content: "hello" },
      { type: "removed", content: "world" },
    ]);
  });

  it("handles mixed changes with added, removed, and unchanged lines", () => {
    const before = "alpha\nbeta\ngamma\ndelta";
    const after = "alpha\nbeta-v2\ngamma\nepsilon";
    const result = computeLineDiff(before, after);

    // alpha unchanged
    expect(result.find((l) => l.content === "alpha")?.type).toBe("unchanged");
    // gamma unchanged
    expect(result.find((l) => l.content === "gamma")?.type).toBe("unchanged");
    // beta removed, beta-v2 added
    expect(result.find((l) => l.content === "beta")?.type).toBe("removed");
    expect(result.find((l) => l.content === "beta-v2")?.type).toBe("added");
    // delta removed, epsilon added
    expect(result.find((l) => l.content === "delta")?.type).toBe("removed");
    expect(result.find((l) => l.content === "epsilon")?.type).toBe("added");
  });

  it("handles a single line change", () => {
    const result = computeLineDiff("foo", "bar");

    expect(result).toEqual([
      { type: "removed", content: "foo" },
      { type: "added", content: "bar" },
    ]);
  });
});

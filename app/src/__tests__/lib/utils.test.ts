import { describe, it, expect } from "vitest";
import {
  cn,
  isValidKebab,
  toKebabChars,
  buildIntakeJson,
  formatElapsed,
  normalizeDirectoryPickerPath,
} from "@/lib/utils";

describe("cn", () => {
  it("merges class names", () => {
    const result = cn("foo", "bar");
    expect(result).toBe("foo bar");
  });

  it("deduplicates conflicting tailwind utilities (last wins)", () => {
    const result = cn("p-2", "p-4");
    expect(result).toBe("p-4");
  });

  it("handles conditional classes (falsy values are excluded)", () => {
    const isActive = true;
    const isDisabled = false;
    const result = cn("base", isActive && "active", isDisabled && "disabled");
    expect(result).toBe("base active");
  });
});

describe("isValidKebab", () => {
  it("returns false for empty string", () => {
    expect(isValidKebab("")).toBe(false);
  });

  it("returns true for single valid word", () => {
    expect(isValidKebab("hello")).toBe(true);
  });

  it("returns true for valid kebab-case", () => {
    expect(isValidKebab("hello-world")).toBe(true);
  });

  it("returns true for kebab with numbers", () => {
    expect(isValidKebab("skill-2")).toBe(true);
  });

  it("returns false for leading hyphen", () => {
    expect(isValidKebab("-hello")).toBe(false);
  });

  it("returns false for trailing hyphen", () => {
    expect(isValidKebab("hello-")).toBe(false);
  });

  it("returns false for double hyphen", () => {
    expect(isValidKebab("hello--world")).toBe(false);
  });

  it("returns false for uppercase letters", () => {
    expect(isValidKebab("Hello")).toBe(false);
  });

  it("returns false for special characters", () => {
    expect(isValidKebab("hello@world")).toBe(false);
  });
});

describe("toKebabChars", () => {
  it("passes through already-valid kebab string unchanged", () => {
    expect(toKebabChars("hello-world")).toBe("hello-world");
  });

  it("lowercases uppercase letters", () => {
    expect(toKebabChars("HELLO")).toBe("hello");
  });

  it("strips spaces (not replaced with hyphen)", () => {
    // regex replaces [^a-z0-9-] with "" — spaces are stripped, not replaced
    expect(toKebabChars("hello world")).toBe("helloworld");
  });

  it("strips special characters", () => {
    expect(toKebabChars("hello@world!")).toBe("helloworld");
  });

  it("collapses multiple hyphens into one", () => {
    expect(toKebabChars("hello--world")).toBe("hello-world");
  });

  it("strips leading hyphens", () => {
    expect(toKebabChars("-hello")).toBe("hello");
  });

  it("handles mixed uppercase, spaces, and special chars", () => {
    // "Hello World!" → lowercase → "hello world!" → strip non [a-z0-9-] → "helloworld"
    expect(toKebabChars("Hello World!")).toBe("helloworld");
  });
});

describe("buildIntakeJson", () => {
  it("returns null when all fields are empty strings", () => {
    expect(buildIntakeJson({ name: "", description: "" })).toBeNull();
  });

  it("returns null when all fields are whitespace-only", () => {
    expect(buildIntakeJson({ name: "   ", description: "\t" })).toBeNull();
  });

  it("returns null for empty object", () => {
    expect(buildIntakeJson({})).toBeNull();
  });

  it("returns valid JSON string when one field has content", () => {
    const result = buildIntakeJson({ name: "my-skill", description: "" });
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ name: "my-skill" });
  });

  it("returns JSON with all non-empty fields", () => {
    const result = buildIntakeJson({ name: "my-skill", description: "a skill" });
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ name: "my-skill", description: "a skill" });
  });

  it("trims whitespace from field values", () => {
    const result = buildIntakeJson({ name: "  trimmed  " });
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ name: "trimmed" });
  });
});

describe("formatElapsed", () => {
  it("formats 0ms as '0s'", () => {
    expect(formatElapsed(0)).toBe("0s");
  });

  it("formats sub-second values as '0s' (floors to seconds)", () => {
    expect(formatElapsed(500)).toBe("0s");
  });

  it("formats exactly 1000ms as '1s'", () => {
    expect(formatElapsed(1000)).toBe("1s");
  });

  it("formats 5500ms as '5s'", () => {
    expect(formatElapsed(5500)).toBe("5s");
  });

  it("formats exactly 60000ms as '1m 0s'", () => {
    expect(formatElapsed(60000)).toBe("1m 0s");
  });

  it("formats 90000ms as '1m 30s'", () => {
    expect(formatElapsed(90000)).toBe("1m 30s");
  });

  it("formats large values correctly", () => {
    // 3661000ms = 61 minutes 1 second
    expect(formatElapsed(3661000)).toBe("61m 1s");
  });
});

describe("normalizeDirectoryPickerPath", () => {
  it("strips trailing slash from a macOS path", () => {
    expect(normalizeDirectoryPickerPath("/Users/me/Skills/")).toBe("/Users/me/Skills");
  });

  it("deduplicates the doubled last path segment on macOS", () => {
    expect(normalizeDirectoryPickerPath("/Users/me/My Skills/My Skills")).toBe("/Users/me/My Skills");
  });

  it("strips trailing backslash from a Windows path", () => {
    expect(normalizeDirectoryPickerPath("C:\\Users\\me\\My Skills\\")).toBe("C:\\Users\\me\\My Skills");
  });

  it("deduplicates the doubled last path segment on Windows", () => {
    expect(normalizeDirectoryPickerPath("C:\\Users\\me\\My Skills\\My Skills\\")).toBe("C:\\Users\\me\\My Skills");
  });

  it("preserves paths with spaces when there is no duplicate segment", () => {
    expect(normalizeDirectoryPickerPath("/Users/me/Skill Builder Workspace")).toBe("/Users/me/Skill Builder Workspace");
  });
});

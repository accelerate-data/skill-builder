import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("merges class names", () => {
    const result = cn("foo", "bar");
    expect(result).toBe("foo bar");
  });

  it("handles a single class name", () => {
    const result = cn("foo");
    expect(result).toBe("foo");
  });

  it("handles conditional classes (falsy values are excluded)", () => {
    const isActive = true;
    const isDisabled = false;
    const result = cn("base", isActive && "active", isDisabled && "disabled");
    expect(result).toBe("base active");
  });

  it("handles undefined and null values", () => {
    const result = cn("foo", undefined, null, "bar");
    expect(result).toBe("foo bar");
  });

  it("deduplicates tailwind classes (last wins)", () => {
    // twMerge resolves conflicting Tailwind classes - last value wins
    const result = cn("p-2 p-4");
    expect(result).toBe("p-4");
  });

  it("deduplicates conflicting tailwind utilities across arguments", () => {
    const result = cn("p-2", "p-4");
    expect(result).toBe("p-4");
  });

  it("merges non-conflicting tailwind classes", () => {
    const result = cn("p-2", "m-4");
    expect(result).toBe("p-2 m-4");
  });

  it("handles array inputs via clsx", () => {
    const result = cn(["foo", "bar"]);
    expect(result).toBe("foo bar");
  });

  it("handles object inputs via clsx", () => {
    const result = cn({ foo: true, bar: false, baz: true });
    expect(result).toBe("foo baz");
  });

  it("handles empty arguments", () => {
    const result = cn();
    expect(result).toBe("");
  });

  it("resolves conflicting tailwind colors", () => {
    const result = cn("text-red-500", "text-blue-500");
    expect(result).toBe("text-blue-500");
  });
});

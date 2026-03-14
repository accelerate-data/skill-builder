import { describe, it, expect } from "vitest";
import { joinPath } from "@/lib/path-utils";

describe("joinPath", () => {
  it("joins two segments with a forward slash", () => {
    expect(joinPath("/workspace", "skill-name")).toBe("/workspace/skill-name");
  });

  it("joins multiple segments", () => {
    expect(joinPath("/base", "subdir", "file.json")).toBe("/base/subdir/file.json");
  });

  it("removes trailing slashes from each segment before joining", () => {
    expect(joinPath("/workspace/", "skill-name/")).toBe("/workspace/skill-name");
  });

  it("filters out empty segments", () => {
    expect(joinPath("/workspace", "", "skill-name")).toBe("/workspace/skill-name");
  });

  it("handles a single segment", () => {
    expect(joinPath("/workspace")).toBe("/workspace");
  });

  it("joins two segments without leading slash on second", () => {
    expect(joinPath("/workspace", "my-skill")).toBe("/workspace/my-skill");
  });

  it("normalizes backslash trailing separators from Windows-style paths", () => {
    expect(joinPath("C:\\Users\\me\\workspace\\", "skill")).toBe("C:\\Users\\me\\workspace/skill");
  });
});

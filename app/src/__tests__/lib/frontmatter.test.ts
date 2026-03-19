import { describe, expect, it } from "vitest";
import { isSkillFile, parseFrontmatter } from "@/lib/frontmatter";

describe("parseFrontmatter", () => {
  it("parses standard frontmatter with all fields", () => {
    const content = [
      "---",
      "name: my-skill",
      "description: A useful skill",
      "domain: data-engineering",
      "type: automation",
      "tools: Bash, Read, Write",
      "model: sonnet",
      "version: 1.0.0",
      "author: hb",
      "---",
      "",
      "# Skill Body",
      "",
      "Some content here.",
    ].join("\n");

    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({
      name: "my-skill",
      description: "A useful skill",
      domain: "data-engineering",
      type: "automation",
      tools: "Bash, Read, Write",
      model: "sonnet",
      version: "1.0.0",
      author: "hb",
    });
    expect(result.body).toBe("# Skill Body\n\nSome content here.");
  });

  it("returns null frontmatter for content without frontmatter", () => {
    const content = "# Just Markdown\n\nNo frontmatter here.";
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(content);
  });

  it("handles partial fields (only some present)", () => {
    const content = [
      "---",
      "name: partial-skill",
      "version: 0.1.0",
      "---",
      "",
      "Body text.",
    ].join("\n");

    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({
      name: "partial-skill",
      version: "0.1.0",
    });
    expect(result.body).toBe("Body text.");
  });

  it("handles CRLF line endings", () => {
    const content =
      "---\r\nname: crlf-skill\r\ndescription: Works on Windows\r\nversion: 1.0.0\r\n---\r\n\r\n# Body\r\n";

    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({
      name: "crlf-skill",
      description: "Works on Windows",
      version: "1.0.0",
    });
    expect(result.body).toContain("# Body");
  });

  it("handles multi-line folded scalar (>)", () => {
    const content = [
      "---",
      "name: multi-line",
      "description: >",
      "  This is a long",
      "  description that spans",
      "  multiple lines",
      "version: 2.0.0",
      "---",
      "",
      "Body.",
    ].join("\n");

    const result = parseFrontmatter(content);
    expect(result.frontmatter?.description).toBe(
      "This is a long description that spans multiple lines",
    );
    expect(result.frontmatter?.version).toBe("2.0.0");
  });

  it("strips quoted values", () => {
    const content = [
      "---",
      'name: "quoted-name"',
      "description: 'single-quoted'",
      "---",
      "",
      "Body.",
    ].join("\n");

    const result = parseFrontmatter(content);
    expect(result.frontmatter?.name).toBe("quoted-name");
    expect(result.frontmatter?.description).toBe("single-quoted");
  });

  it("returns null frontmatter when closing --- is missing", () => {
    const content = "---\nname: broken\nNo closing marker";
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(content);
  });

  it("ignores empty values", () => {
    const content = ["---", "name: has-name", "description:", "version: 1.0", "---", "", "Body."].join("\n");

    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({
      name: "has-name",
      version: "1.0",
    });
    expect(result.frontmatter?.description).toBeUndefined();
  });

  it("converts hyphens in keys to underscores", () => {
    const content = [
      "---",
      "argument-hint: Use when testing",
      "user-invocable: true",
      "---",
      "",
      "Body.",
    ].join("\n");

    const result = parseFrontmatter(content);
    expect(result.frontmatter?.argument_hint).toBe("Use when testing");
    expect(result.frontmatter?.user_invocable).toBe("true");
  });
});

describe("isSkillFile", () => {
  it("matches SKILL.md exactly", () => {
    expect(isSkillFile("SKILL.md")).toBe(true);
  });

  it("matches path ending in /SKILL.md", () => {
    expect(isSkillFile("skills/my-skill/SKILL.md")).toBe(true);
  });

  it("handles backslash paths", () => {
    expect(isSkillFile("skills\\my-skill\\SKILL.md")).toBe(true);
  });

  it("does not match non-SKILL.md files", () => {
    expect(isSkillFile("README.md")).toBe(false);
    expect(isSkillFile("notes/SKILL.md.bak")).toBe(false);
    expect(isSkillFile("clarifications.json")).toBe(false);
  });
});

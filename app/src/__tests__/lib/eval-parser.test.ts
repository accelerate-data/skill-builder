import { describe, it, expect } from "vitest";
import {
  parseEvalLine,
  parseEvalOutput,
  evalDirectionIcon,
  evalIconColor,
  evalRowBg,
} from "@/lib/eval-parser";

describe("parseEvalLine", () => {
  it("detects up direction from arrow symbol", () => {
    expect(parseEvalLine("\u2191 **speed** \u2014 Plan A is faster")).toEqual({
      direction: "up",
      text: "**speed** \u2014 Plan A is faster",
    });
  });

  it("detects down direction from arrow symbol", () => {
    expect(parseEvalLine("\u2193 **accuracy** \u2014 Plan B is better")).toEqual({
      direction: "down",
      text: "**accuracy** \u2014 Plan B is better",
    });
  });

  it("detects neutral direction from arrow symbol", () => {
    expect(parseEvalLine("\u2192 **coverage** \u2014 Both similar")).toEqual({
      direction: "neutral",
      text: "**coverage** \u2014 Both similar",
    });
  });

  it("strips markdown bullet prefix before detecting direction", () => {
    expect(parseEvalLine("- \u2191 **speed** \u2014 faster")).toEqual({
      direction: "up",
      text: "**speed** \u2014 faster",
    });
    expect(parseEvalLine("* \u2193 **depth** \u2014 worse")).toEqual({
      direction: "down",
      text: "**depth** \u2014 worse",
    });
    expect(parseEvalLine("\u2022 \u2192 **scope** \u2014 tie")).toEqual({
      direction: "neutral",
      text: "**scope** \u2014 tie",
    });
  });

  it("returns null direction for plain text", () => {
    expect(parseEvalLine("Some plain line")).toEqual({
      direction: null,
      text: "Some plain line",
    });
  });

  it("returns empty text for blank lines", () => {
    expect(parseEvalLine("")).toEqual({ direction: null, text: "" });
    expect(parseEvalLine("   ")).toEqual({ direction: null, text: "" });
  });
});

describe("parseEvalOutput", () => {
  it("parses directional lines without recommendations", () => {
    const text = [
      "- \u2191 **speed** \u2014 Plan A is faster",
      "- \u2193 **accuracy** \u2014 Plan B wins",
      "- \u2192 **coverage** \u2014 both similar",
    ].join("\n");

    const result = parseEvalOutput(text);
    expect(result.lines).toHaveLength(3);
    expect(result.lines[0].direction).toBe("up");
    expect(result.lines[1].direction).toBe("down");
    expect(result.lines[2].direction).toBe("neutral");
    expect(result.recommendations).toBe("");
  });

  it("splits directional lines from recommendations section", () => {
    const text = [
      "- \u2191 **speed** \u2014 Plan A is faster",
      "- \u2193 **depth** \u2014 Plan B goes deeper",
      "",
      "## Recommendations",
      "1. Add more examples",
      "2. Improve error handling",
    ].join("\n");

    const result = parseEvalOutput(text);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].direction).toBe("up");
    expect(result.lines[1].direction).toBe("down");
    expect(result.recommendations).toContain("Add more examples");
    expect(result.recommendations).toContain("Improve error handling");
  });

  it("handles case-insensitive recommendations header", () => {
    const text = "- \u2191 **a** \u2014 better\n## RECOMMENDATIONS\nDo something";
    const result = parseEvalOutput(text);
    expect(result.lines).toHaveLength(1);
    expect(result.recommendations).toBe("Do something");
  });

  it("filters out empty lines", () => {
    const text = "\n\n- \u2191 **a** \u2014 better\n\n";
    const result = parseEvalOutput(text);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].direction).toBe("up");
  });
});

describe("evalDirectionIcon", () => {
  it("returns correct arrow symbols", () => {
    expect(evalDirectionIcon("up")).toBe("\u2191");
    expect(evalDirectionIcon("down")).toBe("\u2193");
    expect(evalDirectionIcon("neutral")).toBe("\u2192");
    expect(evalDirectionIcon(null)).toBe("\u2022");
  });
});

describe("evalIconColor", () => {
  it("returns seafoam for up", () => {
    expect(evalIconColor("up")).toContain("seafoam");
  });

  it("returns destructive for down", () => {
    expect(evalIconColor("down")).toContain("destructive");
  });

  it("returns muted for neutral", () => {
    expect(evalIconColor("neutral")).toContain("muted-foreground");
  });

  it("returns muted/50 for null", () => {
    expect(evalIconColor(null)).toContain("muted-foreground/50");
  });
});

describe("evalRowBg", () => {
  it("returns seafoam bg for up", () => {
    expect(evalRowBg("up")).toContain("seafoam");
  });

  it("returns destructive bg for down", () => {
    expect(evalRowBg("down")).toContain("destructive");
  });

  it("returns empty string for neutral and null", () => {
    expect(evalRowBg("neutral")).toBe("");
    expect(evalRowBg(null)).toBe("");
  });
});

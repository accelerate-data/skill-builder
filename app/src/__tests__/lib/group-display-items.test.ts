import { describe, it, expect, beforeEach } from "vitest";
import {
  groupDisplayItems,
  summarizeToolActivity,
} from "@/lib/group-display-items";
import type { DisplayItem } from "@/lib/display-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _id = 0;
function makeItem(overrides: Partial<DisplayItem> & Pick<DisplayItem, "type">): DisplayItem {
  _id += 1;
  return { id: `item-${_id}`, timestamp: Date.now(), ...overrides };
}

function resetIds() {
  _id = 0;
}

// ---------------------------------------------------------------------------
// groupDisplayItems
// ---------------------------------------------------------------------------

describe("groupDisplayItems", () => {
  beforeEach(resetIds);

  it("returns empty array for empty input", () => {
    expect(groupDisplayItems([])).toEqual([]);
  });

  it("wraps output items as bare-output groups", () => {
    const items = [makeItem({ type: "output", outputText: "Hello" })];
    const groups = groupDisplayItems(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("bare-output");
    if (groups[0].type === "bare-output") {
      expect(groups[0].item.outputText).toBe("Hello");
    }
  });

  it("passes through result, error, subagent, compact_boundary items", () => {
    const items = [
      makeItem({ type: "result", resultStatus: "success" }),
      makeItem({ type: "error", errorMessage: "boom" }),
      makeItem({ type: "subagent", subagentDescription: "sub" }),
      makeItem({ type: "compact_boundary" }),
    ];
    const groups = groupDisplayItems(items);
    expect(groups).toHaveLength(4);
    expect(groups.every((g) => g.type === "passthrough")).toBe(true);
  });

  it("groups consecutive tool_call items into a tool-activity group", () => {
    const items = [
      makeItem({ type: "tool_call", toolName: "Read" }),
      makeItem({ type: "tool_call", toolName: "Read" }),
      makeItem({ type: "tool_call", toolName: "Edit" }),
    ];
    const groups = groupDisplayItems(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("tool-activity");
    if (groups[0].type === "tool-activity") {
      expect(groups[0].items).toHaveLength(3);
    }
  });

  it("wraps even a single tool_call as tool-activity for key stability", () => {
    const items = [makeItem({ type: "tool_call", toolName: "Bash" })];
    const groups = groupDisplayItems(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("tool-activity");
  });

  it("groups thinking items with tool_call items", () => {
    const items = [
      makeItem({ type: "thinking", thinkingText: "hmm" }),
      makeItem({ type: "tool_call", toolName: "Read" }),
      makeItem({ type: "tool_call", toolName: "Grep" }),
    ];
    const groups = groupDisplayItems(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("tool-activity");
    if (groups[0].type === "tool-activity") {
      expect(groups[0].items).toHaveLength(3);
    }
  });

  it("creates separate groups split by output items", () => {
    const items = [
      makeItem({ type: "output", outputText: "Starting..." }),
      makeItem({ type: "tool_call", toolName: "Read" }),
      makeItem({ type: "tool_call", toolName: "Edit" }),
      makeItem({ type: "output", outputText: "Done!" }),
      makeItem({ type: "tool_call", toolName: "Bash" }),
      makeItem({ type: "tool_call", toolName: "Bash" }),
    ];
    const groups = groupDisplayItems(items);
    expect(groups).toHaveLength(4);
    expect(groups[0].type).toBe("bare-output");
    expect(groups[1].type).toBe("tool-activity");
    expect(groups[2].type).toBe("bare-output");
    expect(groups[3].type).toBe("tool-activity");
  });

  it("handles interleaved non-groupable items correctly", () => {
    const items = [
      makeItem({ type: "tool_call", toolName: "Read" }),
      makeItem({ type: "tool_call", toolName: "Read" }),
      makeItem({ type: "result", resultStatus: "success" }),
      makeItem({ type: "tool_call", toolName: "Bash" }),
    ];
    const groups = groupDisplayItems(items);
    expect(groups).toHaveLength(3);
    expect(groups[0].type).toBe("tool-activity");
    expect(groups[1].type).toBe("passthrough");
    expect(groups[2].type).toBe("tool-activity"); // single tool still wrapped for key stability
  });

  it("produces stable keys for groups", () => {
    const items = [
      makeItem({ type: "tool_call", toolName: "Read" }),
      makeItem({ type: "tool_call", toolName: "Edit" }),
    ];
    const groups = groupDisplayItems(items);
    expect(groups[0].key).toMatch(/^tool-group-/);
  });

  it("handles the typical agent turn pattern from the issue description", () => {
    const items = [
      makeItem({ type: "output", outputText: "I'll read the files and make changes..." }),
      makeItem({ type: "tool_call", toolName: "Read", toolSummary: "SKILL.md" }),
      makeItem({ type: "tool_call", toolName: "Read", toolSummary: "prompts/system.md" }),
      makeItem({ type: "tool_call", toolName: "Read", toolSummary: "tests/eval.md" }),
      makeItem({ type: "tool_call", toolName: "Edit", toolSummary: "SKILL.md" }),
      makeItem({ type: "tool_call", toolName: "Bash", toolSummary: "npm test" }),
      makeItem({ type: "output", outputText: "I've updated the skill definition..." }),
    ];
    const groups = groupDisplayItems(items);
    expect(groups).toHaveLength(3);
    expect(groups[0].type).toBe("bare-output");
    expect(groups[1].type).toBe("tool-activity");
    if (groups[1].type === "tool-activity") {
      expect(groups[1].items).toHaveLength(5);
    }
    expect(groups[2].type).toBe("bare-output");
  });
});

// ---------------------------------------------------------------------------
// summarizeToolActivity
// ---------------------------------------------------------------------------

describe("summarizeToolActivity", () => {
  beforeEach(resetIds);

  it("counts and breaks down tool types", () => {
    const items = [
      makeItem({ type: "tool_call", toolName: "Read", toolStatus: "ok" }),
      makeItem({ type: "tool_call", toolName: "Read", toolStatus: "ok" }),
      makeItem({ type: "tool_call", toolName: "Read", toolStatus: "ok" }),
      makeItem({ type: "tool_call", toolName: "Edit", toolStatus: "ok" }),
      makeItem({ type: "tool_call", toolName: "Bash", toolStatus: "ok" }),
    ];
    const summary = summarizeToolActivity(items);
    expect(summary.totalTools).toBe(5);
    expect(summary.breakdown).toBe("3 Read, 1 Edit, 1 Bash");
    expect(summary.aggregateStatus).toBe("ok");
  });

  it("excludes thinking items from tool count but includes them in the group", () => {
    const items = [
      makeItem({ type: "thinking", thinkingText: "hmm" }),
      makeItem({ type: "tool_call", toolName: "Read", toolStatus: "ok" }),
    ];
    const summary = summarizeToolActivity(items);
    expect(summary.totalTools).toBe(1);
    expect(summary.breakdown).toBe("1 Read");
  });

  it("shows 'thinking' breakdown when only thinking items", () => {
    const items = [
      makeItem({ type: "thinking", thinkingText: "deep thought" }),
      makeItem({ type: "thinking", thinkingText: "more thought" }),
    ];
    const summary = summarizeToolActivity(items);
    expect(summary.totalTools).toBe(0);
    expect(summary.breakdown).toBe("thinking");
    expect(summary.aggregateStatus).toBe("pending");
  });

  it("reports error status if any tool errored", () => {
    const items = [
      makeItem({ type: "tool_call", toolName: "Read", toolStatus: "ok" }),
      makeItem({ type: "tool_call", toolName: "Bash", toolStatus: "error" }),
      makeItem({ type: "tool_call", toolName: "Read", toolStatus: "ok" }),
    ];
    const summary = summarizeToolActivity(items);
    expect(summary.aggregateStatus).toBe("error");
  });

  it("reports pending status if any tool is pending (and none errored)", () => {
    const items = [
      makeItem({ type: "tool_call", toolName: "Read", toolStatus: "ok" }),
      makeItem({ type: "tool_call", toolName: "Bash", toolStatus: "pending" }),
    ];
    const summary = summarizeToolActivity(items);
    expect(summary.aggregateStatus).toBe("pending");
  });

  it("sums durations from tool_call items only", () => {
    const items = [
      makeItem({ type: "tool_call", toolName: "Read", toolDurationMs: 100, toolStatus: "ok" }),
      makeItem({ type: "tool_call", toolName: "Edit", toolDurationMs: 250, toolStatus: "ok" }),
      makeItem({ type: "thinking", thinkingText: "hmm" }),
    ];
    const summary = summarizeToolActivity(items);
    expect(summary.totalDurationMs).toBe(350);
  });

  it("sorts breakdown by count descending", () => {
    const items = [
      makeItem({ type: "tool_call", toolName: "Bash", toolStatus: "ok" }),
      makeItem({ type: "tool_call", toolName: "Read", toolStatus: "ok" }),
      makeItem({ type: "tool_call", toolName: "Read", toolStatus: "ok" }),
      makeItem({ type: "tool_call", toolName: "Read", toolStatus: "ok" }),
      makeItem({ type: "tool_call", toolName: "Edit", toolStatus: "ok" }),
      makeItem({ type: "tool_call", toolName: "Edit", toolStatus: "ok" }),
    ];
    const summary = summarizeToolActivity(items);
    expect(summary.breakdown).toBe("3 Read, 2 Edit, 1 Bash");
  });
});

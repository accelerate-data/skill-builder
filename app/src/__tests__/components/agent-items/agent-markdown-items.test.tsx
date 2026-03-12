import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OutputItem } from "@/components/agent-items/output-item";
import { ThinkingItem } from "@/components/agent-items/thinking-item";
import type { DisplayItem } from "@/lib/display-types";

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown-render">{children}</div>,
}));

vi.mock("remark-gfm", () => ({ default: () => {} }));

function makeItem(overrides: Partial<DisplayItem> & { type: DisplayItem["type"] }): DisplayItem {
  return {
    id: "di-1",
    timestamp: Date.now(),
    ...overrides,
  } as DisplayItem;
}

describe("agent markdown items", () => {
  it("renders output items with the left-panel agent markdown class", () => {
    render(
      <OutputItem
        item={makeItem({
          type: "output",
          outputText: "A long output with `references/dlt-patterns.md` inline code",
        })}
      />,
    );

    const markdown = screen.getByTestId("markdown-render").parentElement;
    expect(markdown).toHaveClass("markdown-body", "compact", "agent-markdown");
  });

  it("renders thinking items with the left-panel agent markdown class", () => {
    render(
      <ThinkingItem
        item={makeItem({
          type: "thinking",
          thinkingText: "Thinking through a long path like `references/dbt-modeling-best-practices.md`",
        })}
      />,
    );

    const markdown = screen.getByTestId("markdown-render").parentElement;
    expect(markdown).toHaveClass("markdown-body", "compact", "agent-markdown");
  });
});

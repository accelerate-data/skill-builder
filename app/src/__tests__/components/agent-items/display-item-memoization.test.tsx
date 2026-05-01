import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { DisplayItem } from "@/lib/display-types";

// Track render counts for each item component
const bareOutputRenderCount = vi.fn();
const thinkingRenderCount = vi.fn();
const toolRenderCount = vi.fn();
const toolActivityGroupRenderCount = vi.fn();

vi.mock("@/components/agent-items/bare-output", () => ({
  BareOutput: ({ item }: { item: DisplayItem }) => {
    bareOutputRenderCount(item.id);
    return <div data-testid={`output-${item.id}`}>output</div>;
  },
}));

vi.mock("@/components/agent-items/thinking-item", () => ({
  ThinkingItem: ({ item }: { item: DisplayItem }) => {
    thinkingRenderCount(item.id);
    return <div data-testid={`thinking-${item.id}`}>thinking</div>;
  },
}));

vi.mock("@/components/agent-items/tool-item", () => ({
  ToolItem: ({ item }: { item: DisplayItem }) => {
    toolRenderCount(item.id);
    return <div data-testid={`tool-${item.id}`}>tool</div>;
  },
}));

vi.mock("@/components/agent-items/tool-activity-group", () => ({
  ToolActivityGroupView: ({ items }: { items: DisplayItem[] }) => {
    toolActivityGroupRenderCount(items.map((i) => i.id).join(","));
    return <div data-testid="tool-group">group ({items.length})</div>;
  },
}));

// Must import DisplayItemList AFTER mocks are set up
const { DisplayItemList } = await import("@/components/agent-items/display-item-list");

function makeItem(
  overrides: Partial<DisplayItem> & { id: string; type: DisplayItem["type"] },
): DisplayItem {
  return { timestamp: Date.now(), ...overrides } as DisplayItem;
}

describe("DisplayItemList memoization", () => {
  it("does not re-render unchanged items when the list is re-rendered with the same items", () => {
    const items: DisplayItem[] = [
      makeItem({ id: "o-1", type: "output", outputText: "hello" }),
      makeItem({ id: "t-1", type: "thinking", thinkingText: "hmm" }),
      makeItem({ id: "tc-1", type: "tool_call", toolName: "Read" }),
    ];

    const { rerender } = render(<DisplayItemList items={items} />);

    // Output renders as bare-output; thinking+tool grouped into tool-activity
    expect(bareOutputRenderCount).toHaveBeenCalledTimes(1);
    expect(toolActivityGroupRenderCount).toHaveBeenCalledTimes(1);

    // Re-render with the same items array — memo should prevent child re-renders
    rerender(<DisplayItemList items={items} />);

    expect(bareOutputRenderCount).toHaveBeenCalledTimes(1);
    expect(toolActivityGroupRenderCount).toHaveBeenCalledTimes(1);
  });

  it("re-renders children when items array reference changes", () => {
    // When the items array is a new reference, groupDisplayItems recomputes
    // and produces new group wrappers, so children re-render
    const items: DisplayItem[] = [
      makeItem({ id: "o-1", type: "output", outputText: "hello" }),
      makeItem({ id: "o-2", type: "output", outputText: "world" }),
    ];

    bareOutputRenderCount.mockClear();

    const { rerender } = render(<DisplayItemList items={items} />);
    expect(bareOutputRenderCount).toHaveBeenCalledTimes(2);

    // New array reference (even with same content) triggers re-render
    rerender(<DisplayItemList items={[...items]} />);
    expect(bareOutputRenderCount).toHaveBeenCalledTimes(4);
  });

  it("renders only the newest 100 visual groups for large lists", () => {
    const items: DisplayItem[] = Array.from({ length: 125 }, (_, index) =>
      makeItem({
        id: `o-${index}`,
        type: "output",
        outputText: `output ${index}`,
      }),
    );

    bareOutputRenderCount.mockClear();

    const { getByTestId, queryByTestId } = render(<DisplayItemList items={items} />);

    expect(getByTestId("display-item-window-indicator")).toHaveTextContent(
      "25 older items hidden",
    );
    expect(queryByTestId("output-o-0")).not.toBeInTheDocument();
    expect(getByTestId("output-o-124")).toBeInTheDocument();
    expect(bareOutputRenderCount).toHaveBeenCalledTimes(100);
  });
});

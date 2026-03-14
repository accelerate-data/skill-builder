import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SubagentItem } from "@/components/agent-items/subagent-item";
import type { DisplayItem } from "@/lib/display-types";

const baseItemState = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
}));

vi.mock("@/components/agent-items/base-item", () => ({
  BaseItem: ({
    icon,
    label,
    summary,
    children,
    ...props
  }: {
    icon: React.ReactNode;
    label: string;
    summary?: string;
    children?: React.ReactNode;
  }) => {
    baseItemState.props = { label, summary, ...props };
    return (
      <div data-testid="subagent-base-item">
        <div data-testid="subagent-base-item-icon">{icon}</div>
        <div data-testid="subagent-base-item-label">{label}</div>
        <div data-testid="subagent-base-item-summary">{summary}</div>
        <div data-testid="subagent-base-item-children">{children}</div>
      </div>
    );
  },
}));

vi.mock("@/components/agent-items/display-item-list", () => ({
  DisplayItemList: ({
    items,
    depth,
  }: {
    items: DisplayItem[];
    depth: number;
  }) => (
    <div data-testid="display-item-list" data-count={items.length} data-depth={depth}>
      nested items
    </div>
  ),
}));

function createItem(overrides: Partial<DisplayItem> = {}): DisplayItem {
  return {
    id: "subagent-1",
    type: "subagent",
    timestamp: 1,
    ...overrides,
  };
}

function createChild(id: string): DisplayItem {
  return {
    id,
    type: "output",
    timestamp: 2,
    outputText: `child ${id}`,
  };
}

describe("SubagentItem", () => {
  beforeEach(() => {
    baseItemState.props = null;
  });

  it("renders fallback labels and no-output text when there are no child items", () => {
    render(<SubagentItem item={createItem()} />);

    expect(screen.getByTestId("subagent-base-item-label")).toHaveTextContent("Sub-agent");
    expect(screen.getByTestId("subagent-base-item-summary")).toHaveTextContent("Sub-agent");
    expect(screen.getByText("No output captured")).toBeInTheDocument();
    expect(screen.getByTestId("subagent-base-item-icon").querySelector(".lucide-bot")).toBeTruthy();
  });

  it("renders nested items one level deeper when depth is below the limit", () => {
    render(
      <SubagentItem
        item={createItem({
          subagentType: "Researcher",
          subagentDescription: "Collect evidence",
          subagentItems: [createChild("c1"), createChild("c2")],
          subagentMetrics: { outputTokens: 128, turns: 3 },
          subagentStatus: "complete",
        })}
        depth={1}
      />,
    );

    expect(screen.getByTestId("display-item-list")).toHaveAttribute("data-depth", "2");
    expect(screen.getByTestId("display-item-list")).toHaveAttribute("data-count", "2");
    expect(baseItemState.props).toMatchObject({
      label: "Researcher",
      summary: "Collect evidence",
      tokenCount: 128,
      status: "complete",
      defaultExpanded: false,
    });
  });

  it("shows a max-depth message when nested items exceed the supported depth", () => {
    render(
      <SubagentItem
        item={createItem({
          subagentItems: [createChild("c1"), createChild("c2"), createChild("c3")],
        })}
        depth={3}
      />,
    );

    expect(screen.getByText("3 nested items (max depth reached)")).toBeInTheDocument();
    expect(screen.queryByTestId("display-item-list")).not.toBeInTheDocument();
  });

  it("shows a running placeholder while a subagent is still active", () => {
    render(
      <SubagentItem
        item={createItem({
          subagentStatus: "running",
        })}
      />,
    );

    expect(screen.getByText("Running...")).toBeInTheDocument();
  });
});

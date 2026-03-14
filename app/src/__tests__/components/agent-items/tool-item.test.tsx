import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToolItem } from "@/components/agent-items/tool-item";
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
      <div data-testid="tool-base-item">
        <div data-testid="tool-base-item-icon">{icon}</div>
        <div data-testid="tool-base-item-label">{label}</div>
        <div data-testid="tool-base-item-summary">{summary}</div>
        {children ? <div data-testid="tool-base-item-children">{children}</div> : null}
      </div>
    );
  },
}));

vi.mock("@/components/agent-items/tool-viewers/default-viewer", () => ({
  DefaultViewer: ({ item }: { item: DisplayItem }) => (
    <div data-testid="default-viewer">{item.toolName}</div>
  ),
}));

vi.mock("@/components/agent-items/tool-viewers/edit-viewer", () => ({
  EditViewer: ({ item }: { item: DisplayItem }) => (
    <div data-testid="edit-viewer">{item.toolName}</div>
  ),
}));

vi.mock("@/components/agent-items/tool-viewers/read-viewer", () => ({
  ReadViewer: ({ item }: { item: DisplayItem }) => (
    <div data-testid="read-viewer">{item.toolName}</div>
  ),
}));

vi.mock("@/components/agent-items/tool-viewers/bash-viewer", () => ({
  BashViewer: ({ item }: { item: DisplayItem }) => (
    <div data-testid="bash-viewer">{item.toolName}</div>
  ),
}));

function createItem(overrides: Partial<DisplayItem> = {}): DisplayItem {
  return {
    id: "tool-1",
    type: "tool_call",
    timestamp: 1,
    ...overrides,
  };
}

describe("ToolItem", () => {
  beforeEach(() => {
    baseItemState.props = null;
  });

  it("falls back to unknown labels and omits viewer content when there is no payload", () => {
    render(<ToolItem item={createItem()} />);

    expect(screen.getByTestId("tool-base-item-label")).toHaveTextContent("unknown");
    expect(screen.getByTestId("tool-base-item-summary")).toHaveTextContent("unknown");
    expect(screen.queryByTestId("tool-base-item-children")).not.toBeInTheDocument();
    expect(screen.getByTestId("tool-base-item-icon").querySelector(".lucide-terminal")).toBeTruthy();
  });

  it("uses the edit viewer and edit icon for Edit tool calls", () => {
    render(
      <ToolItem
        item={createItem({
          toolName: "Edit",
          toolSummary: "Patched file",
          toolInput: { file_path: "app.tsx" },
        })}
      />,
    );

    expect(screen.getByTestId("edit-viewer")).toHaveTextContent("Edit");
    expect(screen.getByTestId("tool-base-item-summary")).toHaveTextContent("Patched file");
    expect(screen.getByTestId("tool-base-item-icon").querySelector(".lucide-pencil")).toBeTruthy();
  });

  it("uses the read viewer for Read tool calls", () => {
    render(
      <ToolItem
        item={createItem({
          toolName: "Read",
          toolInput: { file_path: "README.md" },
        })}
      />,
    );

    expect(screen.getByTestId("read-viewer")).toHaveTextContent("Read");
    expect(screen.getByTestId("tool-base-item-icon").querySelector(".lucide-file-text")).toBeTruthy();
  });

  it("uses the bash viewer for Bash tool calls", () => {
    render(
      <ToolItem
        item={createItem({
          toolName: "Bash",
          toolResult: { content: "ok", isError: false },
        })}
      />,
    );

    expect(screen.getByTestId("bash-viewer")).toHaveTextContent("Bash");
  });

  it("uses the default viewer and passes through status metadata for other tools", () => {
    render(
      <ToolItem
        item={createItem({
          toolName: "Task",
          toolResult: { content: "done", isError: false },
          tokenCount: 42,
          toolStatus: "ok",
          toolDurationMs: 375,
        })}
      />,
    );

    expect(screen.getByTestId("default-viewer")).toHaveTextContent("Task");
    expect(screen.getByTestId("tool-base-item-icon").querySelector(".lucide-git-branch")).toBeTruthy();
    expect(baseItemState.props).toMatchObject({
      labelMono: true,
      tokenCount: 42,
      status: "ok",
      durationMs: 375,
      defaultExpanded: false,
    });
  });
});

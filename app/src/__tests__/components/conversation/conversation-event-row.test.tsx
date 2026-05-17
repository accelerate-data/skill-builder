import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ConversationEventRow } from "@/components/conversation/conversation-event-row";
import type { DisplayNode } from "@/lib/display-types";

function makeNode(
  overrides: Partial<DisplayNode> & {
    id: string;
    kind: DisplayNode["kind"];
  },
): DisplayNode {
  return {
    id: overrides.id,
    kind: overrides.kind,
    status: "observed",
    createdAtMs: 1_000,
    ...overrides,
  };
}

describe("ConversationEventRow", () => {
  it("renders task rows as right-aligned narrative rows and agent updates as left-aligned prose", () => {
    const { rerender } = render(
      <ConversationEventRow
        node={makeNode({
          id: "evt-user",
          kind: "task_sent",
          status: "accepted",
          bodyText: "User message",
          sourceEventIds: ["evt-user"],
        })}
      />,
    );

    const userRow = screen.getByTestId("conversation-event-row");
    expect(userRow.className).toMatch(/\bml-auto\b/);
    expect(userRow.className).toMatch(/\bborder-primary\/20\b/);

    rerender(
      <ConversationEventRow
        node={makeNode({
          id: "evt-agent",
          kind: "agent_update",
          bodyText: "Agent reply",
          sourceEventIds: ["evt-agent"],
        })}
      />,
    );

    const agentRow = screen.getByTestId("conversation-event-row");
    expect(agentRow.className).toMatch(/\bmr-auto\b/);
    expect(agentRow.className).toMatch(/\bborder-border\b/);
  });

  it("renders grouped semantic activity with member summaries", () => {
    render(
      <ConversationEventRow
        node={makeNode({
          id: "evt-group",
          kind: "activity_trace",
          label: "Activity trace",
          sourceEventIds: ["evt-group-a", "evt-group-b"],
          traceItems: [
            {
              id: "member-1",
              kind: "terminal_activity",
              title: "Terminal activity",
              summary: "ls -la",
              sourceEventIds: ["evt-group-a", "evt-group-b"],
              drawerTitle: "Terminal activity",
              drawerSubtitle: "1 items",
              drawerSections: [
                { title: "Summary", body: "ls -la" },
                { title: "Item 1", body: "ls -la" },
              ],
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("Activity trace")).toBeInTheDocument();
    expect(screen.getByText("Terminal activity")).toBeInTheDocument();
    expect(screen.getByText("ls -la")).toBeInTheDocument();
  });

  it("opens a right-side inspector drawer when a trace item is clicked", () => {
    render(
      <ConversationEventRow
        node={makeNode({
          id: "evt-trace",
          kind: "activity_trace",
          label: "Activity trace",
          sourceEventIds: ["evt-a", "evt-b"],
          traceItems: [
            {
              id: "trace-1",
              kind: "file_activity",
              title: "File activity",
              summary: "Viewed schema file",
              sourceEventIds: ["evt-a", "evt-b"],
              drawerTitle: "File activity",
              drawerSubtitle: "2 items",
              drawerSections: [
                { title: "Summary", body: "Viewed schema file" },
                { title: "Item 1", body: "view path/to/file" },
              ],
            },
          ],
        })}
      />,
    );

    expect(screen.queryByTestId("activity-trace-drawer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /file activity/i }));

    const drawer = screen.getByTestId("activity-trace-drawer");
    expect(drawer).toBeInTheDocument();
    expect(within(drawer).getByText("File activity")).toBeInTheDocument();
    expect(within(drawer).getByText("2 items")).toBeInTheDocument();
    expect(within(drawer).getByText("Viewed schema file")).toBeInTheDocument();
  });

  it("distinguishes tool and subagent errors visually", () => {
    const { rerender } = render(
      <ConversationEventRow
        node={makeNode({
          id: "evt-tool-error",
          kind: "tool_error",
          status: "failed",
          bodyText: "Tool execution failed",
          sourceEventIds: ["evt-tool-error"],
        })}
      />,
    );

    expect(screen.getByTestId("conversation-event-row").className).toMatch(/\bborder-destructive\/40\b/);
    expect(screen.getByText("Tool error")).toBeInTheDocument();

    rerender(
      <ConversationEventRow
        node={makeNode({
          id: "evt-subagent-error",
          kind: "subagent_error",
          status: "failed",
          bodyText: "Subagent crashed",
          sourceEventIds: ["evt-subagent-error"],
        })}
      />,
    );

    expect(screen.getByText("Subagent error")).toBeInTheDocument();
  });
});

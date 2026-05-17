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
    const userBubble = userRow.querySelector("article");
    expect(userBubble).not.toBeNull();
    expect(userBubble?.className).toMatch(/\bml-auto\b/);
    expect(userBubble?.className).toContain("border-sky-200/70");
    expect(userBubble?.className).toContain("max-w-[56%]");
    expect(userRow.textContent).toMatch(/\d{1,2}:\d{2}\s?[AP]M/i);
    expect(userRow).toHaveTextContent("You");
    expect(screen.queryByText("Task sent")).not.toBeInTheDocument();
    expect(screen.queryByText("accepted")).not.toBeInTheDocument();
    expect(screen.queryByText("sending")).not.toBeInTheDocument();
    expect(screen.queryByText("observed")).not.toBeInTheDocument();

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
    const agentBubble = agentRow.querySelector("article");
    expect(agentBubble).not.toBeNull();
    expect(agentBubble?.className).toMatch(/\bmr-auto\b/);
    expect(agentBubble?.className).toContain("border-emerald-200/80");
    expect(agentBubble?.className).toContain("max-w-[56%]");
    expect(agentRow.textContent).toMatch(/\d{1,2}:\d{2}\s?[AP]M/i);
    expect(agentRow).toHaveTextContent("Agent");
    expect(screen.queryByText("Agent update")).not.toBeInTheDocument();
    expect(screen.queryByText("observed")).not.toBeInTheDocument();
  });

  it("shows a pending badge only while a task row is still sending", () => {
    render(
      <ConversationEventRow
        node={makeNode({
          id: "evt-user-pending",
          kind: "task_sent",
          status: "sending",
          bodyText: "Queued user message",
          sourceEventIds: ["evt-user-pending"],
        })}
      />,
    );

    expect(screen.getByText("sending")).toBeInTheDocument();
  });

  it("renders grouped semantic activity with member summaries", () => {
    render(
      <ConversationEventRow
        node={makeNode({
          id: "evt-group",
          kind: "activity_trace",
          label: "Activity trace",
          collapsedByDefault: true,
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

    const traceRow = screen.getByTestId("conversation-event-row");
    expect(traceRow).not.toHaveAttribute("open");
    expect(screen.getByText("Activity trace")).toBeInTheDocument();
    expect(screen.getAllByText("Terminal activity").length).toBeGreaterThan(0);
    expect(screen.getByText("ls -la")).toBeInTheDocument();
  });

  it("renders runtime setup on the same narrow column and uses the drawer for full prompt content", () => {
    render(
      <ConversationEventRow
        node={makeNode({
          id: "evt-runtime-setup",
          kind: "runtime_setup",
          label: "Runtime setup",
          bodyText: "You are OpenHands agent.\n\n# Instructions\n- Help the user.",
          sourceEventIds: ["evt-runtime-setup"],
        })}
      />,
    );

    const row = screen.getByTestId("conversation-event-row");
    expect(row.className).toContain("max-w-[56%]");
    expect(row).toHaveTextContent("Runtime setup");
    expect(row).toHaveTextContent("System prompt prepared.");
    expect(row).not.toHaveTextContent("You are OpenHands agent.");

    fireEvent.click(screen.getByRole("button", { name: /runtime setup/i }));

    const drawer = screen.getByTestId("activity-trace-drawer");
    expect(within(drawer).getByText("Runtime setup")).toBeInTheDocument();
    expect(drawer).toHaveTextContent("You are OpenHands agent.");
    expect(drawer).toHaveTextContent("# Instructions");
  });

  it("collapses long agent updates behind a compact preview", () => {
    render(
      <ConversationEventRow
        node={makeNode({
          id: "evt-agent-long",
          kind: "agent_update",
          bodyText:
            "This is the first sentence. This is the second sentence. This is the third sentence that should stay hidden until the card is expanded.\n\nThis paragraph should also stay hidden until expansion.",
          sourceEventIds: ["evt-agent-long"],
        })}
      />,
    );

    expect(screen.getByText(/This is the first sentence. This is the second sentence./)).toBeInTheDocument();
    expect(screen.queryByText(/This paragraph should also stay hidden/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show more/i }));

    expect(screen.getByText(/This paragraph should also stay hidden until expansion./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show less/i })).toBeInTheDocument();
  });

  it("keeps reasoning rows compact in the timeline while preserving full drawer detail", () => {
    render(
      <ConversationEventRow
        node={makeNode({
          id: "evt-reasoning",
          kind: "activity_trace",
          label: "Activity trace",
          collapsedByDefault: true,
          sourceEventIds: ["evt-r1"],
          traceItems: [
            {
              id: "reasoning-1",
              kind: "reasoning",
              title: "Reasoning",
              summary: "Let me analyze the current clarifications and the user's answers to determine what gaps remain.",
              sourceEventIds: ["evt-r1"],
              drawerTitle: "Reasoning",
              drawerSubtitle: "1 items",
              drawerSections: [
                {
                  title: "Summary",
                  body: "Let me analyze the current clarifications and the user's answers to determine what gaps remain.\n\n## Current Answers Summary:\n1. Weighted pipeline...",
                },
              ],
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("Let me analyze the current clarifications and the user's answers to determine what gaps remain.")).toBeInTheDocument();
    expect(screen.queryByText(/## Current Answers Summary:/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /reasoning/i }));

    expect(screen.getByTestId("activity-trace-drawer")).toHaveTextContent("## Current Answers Summary:");
  });

  it("opens a right-side inspector drawer when a trace item is clicked", () => {
    render(
      <ConversationEventRow
        node={makeNode({
          id: "evt-trace",
          kind: "activity_trace",
          label: "Activity trace",
          collapsedByDefault: true,
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

    fireEvent.click(screen.getByText("Activity trace"));
    fireEvent.click(screen.getByRole("button", { name: /file activity/i }));

    const drawer = screen.getByTestId("activity-trace-drawer");
    expect(drawer).toBeInTheDocument();
    expect(within(drawer).getByText("File activity")).toBeInTheDocument();
    expect(within(drawer).getByText("2 items")).toBeInTheDocument();
    expect(within(drawer).getByText("Viewed schema file")).toBeInTheDocument();
  });

  it("renders skill drawer content as markdown", () => {
    render(
      <ConversationEventRow
        node={makeNode({
          id: "evt-skill-trace",
          kind: "activity_trace",
          label: "Activity trace",
          collapsedByDefault: true,
          sourceEventIds: ["evt-skill-a"],
          traceItems: [
            {
              id: "skill-1",
              kind: "skill",
              title: "Skill invocation",
              summary: "Load skill-requirements research methodology",
              badgeLabel: "skill",
              sourceEventIds: ["evt-skill-a"],
              drawerTitle: "Skill invocation",
              drawerSubtitle: "1 items",
              drawerSections: [
                {
                  title: "Summary",
                  body: "# Researching Skill Requirements\n\n- Capture intent\n- Produce high-value clarification questions",
                },
              ],
            },
          ],
        })}
      />,
    );

    fireEvent.click(screen.getByText("Activity trace"));
    fireEvent.click(screen.getByRole("button", { name: /skill invocation/i }));

    const drawer = screen.getByTestId("activity-trace-drawer");
    expect(within(drawer).getByRole("heading", { name: "Researching Skill Requirements" })).toBeInTheDocument();
    expect(within(drawer).getByText("Capture intent")).toBeInTheDocument();
    expect(within(drawer).getByText("Produce high-value clarification questions")).toBeInTheDocument();
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

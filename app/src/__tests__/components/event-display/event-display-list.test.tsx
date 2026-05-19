import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EventDisplayList } from "@/components/event-display/event-display-list";
import type { DisplayNode } from "@/lib/display-types";

function makeNode(
  overrides: Partial<DisplayNode> & { id: string; kind: DisplayNode["kind"] },
): DisplayNode {
  return {
    id: overrides.id,
    kind: overrides.kind,
    status: "observed",
    createdAtMs: 1_000,
    sourceEventIds: [overrides.id],
    ...overrides,
  };
}

describe("EventDisplayList", () => {
  it("renders a task_sent node with Message label", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({ id: "n1", kind: "task_sent", bodyText: "Write a plan" }),
        ]}
      />,
    );
    expect(screen.getByText("Message")).toBeInTheDocument();
    expect(screen.getByText("Write a plan")).toBeInTheDocument();
  });

  it("renders an agent_update node with Output label", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({ id: "n1", kind: "agent_update", bodyText: "Here is the plan." }),
        ]}
      />,
    );
    expect(screen.getByText("Output")).toBeInTheDocument();
  });

  it("renders a reasoning node with Think label and italic summary", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({ id: "n1", kind: "reasoning", reasoningText: "Step by step..." }),
        ]}
      />,
    );
    expect(screen.getByText("Think")).toBeInTheDocument();
    const summary = screen.getByTestId("row-summary");
    expect(summary.className).toMatch(/italic/);
  });

  it("renders a tool_batch node with '1 tool' label for a single member", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({
            id: "n1",
            kind: "tool_batch",
            members: [
              {
                id: "m1",
                title: "read_file",
                toolName: "read_file",
                sourceEventIds: ["n1"],
              },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("1 tool")).toBeInTheDocument();
  });

  it("renders a tool_batch node with 'N tools' label for multiple members", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({
            id: "n1",
            kind: "tool_batch",
            members: [
              { id: "m1", title: "read_file", toolName: "read_file", sourceEventIds: ["n1"] },
              { id: "m2", title: "write_file", toolName: "write_file", sourceEventIds: ["n1"] },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("2 tools")).toBeInTheDocument();
  });

  it("renders tool names joined by · as summary", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({
            id: "n1",
            kind: "tool_batch",
            members: [
              { id: "m1", title: "read_file", toolName: "read_file", sourceEventIds: ["n1"] },
              { id: "m2", title: "write_file", toolName: "write_file", sourceEventIds: ["n1"] },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("read_file · write_file")).toBeInTheDocument();
  });

  it("inserts a turn divider when task_sent follows a turn_end marker", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({ id: "n1", kind: "task_sent", bodyText: "First message" }),
          makeNode({ id: "n2", kind: "agent_update", bodyText: "First reply" }),
          makeNode({ id: "n3", kind: "turn_end" }),
          makeNode({ id: "n4", kind: "task_sent", bodyText: "Second message" }),
        ]}
      />,
    );
    expect(screen.getByTestId("turn-divider")).toBeInTheDocument();
  });

  it("does not insert a turn divider when task_sent follows agent_update without turn_end", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({ id: "n1", kind: "task_sent", bodyText: "First message" }),
          makeNode({ id: "n2", kind: "agent_update", bodyText: "First reply" }),
          makeNode({ id: "n3", kind: "task_sent", bodyText: "Second message" }),
        ]}
      />,
    );
    expect(screen.queryByTestId("turn-divider")).not.toBeInTheDocument();
  });

  it("does not render the turn_end node as a row", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({ id: "n1", kind: "task_sent", bodyText: "First message" }),
          makeNode({ id: "n2", kind: "turn_end" }),
        ]}
      />,
    );
    expect(screen.queryByText(/turn end/i)).not.toBeInTheDocument();
  });

  it("does not insert a turn divider before the first task_sent", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({ id: "n1", kind: "task_sent", bodyText: "First message" }),
        ]}
      />,
    );
    expect(screen.queryByTestId("turn-divider")).not.toBeInTheDocument();
  });

  it("does not insert a turn divider when task_sent follows task_sent", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({ id: "n1", kind: "task_sent", bodyText: "First" }),
          makeNode({ id: "n2", kind: "task_sent", bodyText: "Second" }),
        ]}
      />,
    );
    expect(screen.queryByTestId("turn-divider")).not.toBeInTheDocument();
  });

  it("shows 'N older events hidden' when more than 100 nodes are provided", () => {
    const nodes = Array.from({ length: 105 }, (_, i) =>
      makeNode({ id: `n${i}`, kind: "task_sent", bodyText: `msg ${i}` }),
    );
    render(<EventDisplayList nodes={nodes} />);
    expect(screen.getByText("5 older events hidden")).toBeInTheDocument();
  });

  it("renders a runtime_setup node with 'Runtime setup' label", () => {
    render(
      <EventDisplayList
        nodes={[makeNode({ id: "n1", kind: "runtime_setup", bodyText: "System prompt" })]}
      />,
    );
    expect(screen.getByText("Runtime setup")).toBeInTheDocument();
  });

  it("renders an error node with 'Error' label", () => {
    render(
      <EventDisplayList
        nodes={[makeNode({ id: "n1", kind: "error", bodyText: "Something failed" })]}
      />,
    );
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("renders an unknown_event node with 'Unknown' label", () => {
    render(
      <EventDisplayList
        nodes={[makeNode({ id: "n1", kind: "unknown_event" })]}
      />,
    );
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("renders a tool_error node with 'Tool error' label", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({
            id: "n1",
            kind: "tool_error",
            actionText: "cat missing.txt",
            bodyText: "File not found",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Tool error")).toBeInTheDocument();
  });

  it("shows error text in tool_error T/A/O panel when expanded", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({
            id: "n1",
            kind: "tool_error",
            actionText: "cat missing.txt",
            bodyText: "File not found",
          }),
        ]}
      />,
    );
    expect(screen.getByText("ERROR")).toBeInTheDocument();
    // "File not found" appears in both the row summary and the ERROR panel body
    const matches = screen.getAllByText("File not found");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("shows reasoningText in Think row expansion", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({
            id: "n1",
            kind: "reasoning",
            reasoningText: "Let me think step by step",
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("row-header"));
    // Text appears in row summary and expansion body
    const matches = screen.getAllByText("Let me think step by step");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to thoughtText in Think row expansion when reasoningText is absent", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({
            id: "n1",
            kind: "reasoning",
            thoughtText: "Thought without reasoning",
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("row-header"));
    const matches = screen.getAllByText("Thought without reasoning");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("renders a skill node via ToolRow with tool label", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({
            id: "n1",
            kind: "skill",
            members: [
              { id: "m1", title: "invoke_skill", toolName: "invoke_skill", sourceEventIds: ["n1"] },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("1 tool")).toBeInTheDocument();
  });

  it("renders a subagent node via ToolRow with tool label", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({
            id: "n1",
            kind: "subagent",
            members: [
              { id: "m1", title: "task", toolName: "task", sourceEventIds: ["n1"] },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("1 tool")).toBeInTheDocument();
  });

  it("suppresses result nodes and renders nothing", () => {
    const { container } = render(
      <EventDisplayList
        nodes={[makeNode({ id: "n1", kind: "result", bodyText: "Conversation summary updated." })]}
      />,
    );
    expect(container.querySelector("[data-testid='row-header']")).toBeNull();
  });

  it("suppresses pause nodes and renders nothing", () => {
    const { container } = render(
      <EventDisplayList
        nodes={[makeNode({ id: "n1", kind: "pause", bodyText: "Conversation paused." })]}
      />,
    );
    expect(container.querySelector("[data-testid='row-header']")).toBeNull();
  });

  it("shows all member action texts in parallel tool batch T/A/O panel", () => {
    render(
      <EventDisplayList
        nodes={[
          makeNode({
            id: "n1",
            kind: "tool_batch",
            members: [
              {
                id: "m1",
                title: "read_file",
                toolName: "read_file",
                actionText: "path: README.md",
                observationText: "file content A",
                sourceEventIds: ["n1"],
              },
              {
                id: "m2",
                title: "write_file",
                toolName: "write_file",
                actionText: "path: out.txt",
                observationText: "file content B",
                sourceEventIds: ["n1"],
              },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("ACTION")).toBeInTheDocument();
    expect(screen.getByText(/path: README\.md/)).toBeInTheDocument();
    expect(screen.getByText(/path: out\.txt/)).toBeInTheDocument();
    expect(screen.getByText("OBSERVATION")).toBeInTheDocument();
  });
});

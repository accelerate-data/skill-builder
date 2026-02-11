import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore, type AgentMessage } from "@/stores/agent-store";

// Polyfill scrollIntoView for jsdom
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// Mock react-markdown to avoid ESM issues in tests
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

// Mock remark-gfm
vi.mock("remark-gfm", () => ({
  default: () => {},
}));

import {
  AgentOutputPanel,
  classifyMessage,
  categoryStyles,
  MessageItem,
  ToolCallGroup,
  TurnMarker,
  computeToolCallGroups,
  computeMessageGroups,
  spacingClasses,
  endsWithUserQuestion,
  type MessageCategory,
  type MessageSpacing,
} from "@/components/agent-output-panel";

describe("AgentOutputPanel", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
  });

  it("shows empty state when no run exists", () => {
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText("No agent output yet")).toBeInTheDocument();
  });

  it("renders Agent Output title when run exists", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText("Agent Output")).toBeInTheDocument();
  });

  it("shows Running status badge for running agent", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("shows model badge with friendly name", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText("Sonnet")).toBeInTheDocument();
  });

  it("shows Completed status badge for completed agent", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().completeRun("test-agent", true);
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("shows Error status badge for failed agent", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().completeRun("test-agent", false);
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("renders error message for error-type messages", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", {
      type: "error",
      content: "Something went wrong",
      raw: {},
      timestamp: Date.now(),
    });
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders result message for result-type messages", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", {
      type: "result",
      content: "Agent finished successfully",
      raw: {},
      timestamp: Date.now(),
    });
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(
      screen.getByText("Agent finished successfully")
    ).toBeInTheDocument();
  });

  it("renders assistant text messages", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", {
      type: "assistant",
      content: "Analyzing the domain...",
      raw: { message: { content: [{ type: "text", text: "Analyzing the domain..." }] } },
      timestamp: Date.now(),
    });
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText("Analyzing the domain...")).toBeInTheDocument();
  });

  it("renders tool use summary for tool_use messages", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", {
      type: "assistant",
      content: null as unknown as string,
      raw: {
        message: {
          content: [
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/foo/bar/test.md" },
            },
          ],
        },
      },
      timestamp: Date.now(),
    });
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText("Reading test.md")).toBeInTheDocument();
  });

  it("shows token usage when available", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", {
      type: "result",
      content: "Done",
      raw: {
        usage: { input_tokens: 1000, output_tokens: 500 },
        cost_usd: 0.05,
      },
      timestamp: Date.now(),
    });
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(screen.getByText("1,500 tokens")).toBeInTheDocument();
    expect(screen.getByText("$0.0500")).toBeInTheDocument();
  });

  it("does not render system messages", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", {
      type: "system",
      content: "System init message",
      raw: { subtype: "init" },
      timestamp: Date.now(),
    });
    render(<AgentOutputPanel agentId="test-agent" />);
    expect(
      screen.queryByText("System init message")
    ).not.toBeInTheDocument();
  });

  it("groups consecutive tool calls under a ToolCallGroup", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    // Add 3 consecutive tool call messages
    useAgentStore.getState().addMessage("test-agent", {
      type: "assistant",
      content: null as unknown as string,
      raw: { message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/a.ts" } }] } },
      timestamp: Date.now(),
    });
    useAgentStore.getState().addMessage("test-agent", {
      type: "assistant",
      content: null as unknown as string,
      raw: { message: { content: [{ type: "tool_use", name: "Grep", input: { pattern: "foo" } }] } },
      timestamp: Date.now(),
    });
    useAgentStore.getState().addMessage("test-agent", {
      type: "assistant",
      content: null as unknown as string,
      raw: { message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/b.ts" } }] } },
      timestamp: Date.now(),
    });

    render(<AgentOutputPanel agentId="test-agent" />);

    // Should render as a group with "3 tool calls" header
    expect(screen.getByText("3 tool calls")).toBeInTheDocument();
    expect(screen.getByTestId("tool-call-group")).toBeInTheDocument();
  });
});

function msg(overrides: Partial<AgentMessage>): AgentMessage {
  return { type: "assistant", content: "", raw: {}, timestamp: Date.now(), ...overrides };
}

describe("classifyMessage", () => {
  it("classifies system messages as status", () => {
    expect(classifyMessage(msg({ type: "system" }))).toBe("status");
  });

  it("classifies error messages as error", () => {
    expect(classifyMessage(msg({ type: "error", content: "fail" }))).toBe("error");
  });

  it("classifies result messages as result", () => {
    expect(classifyMessage(msg({ type: "result", content: "done" }))).toBe("result");
  });

  it("classifies assistant with tool_use as tool_call", () => {
    expect(
      classifyMessage(
        msg({
          type: "assistant",
          content: null as unknown as string,
          raw: { message: { content: [{ type: "tool_use", name: "Read" }] } },
        }),
      ),
    ).toBe("tool_call");
  });

  it("classifies assistant with follow-up questions as question", () => {
    expect(
      classifyMessage(
        msg({
          type: "assistant",
          content: "## Follow-up Questions\n1. What is the primary key?",
        }),
      ),
    ).toBe("question");
  });

  it("classifies assistant with gate_check text as question", () => {
    expect(
      classifyMessage(
        msg({
          type: "assistant",
          content: "Ready to proceed to the build step.",
        }),
      ),
    ).toBe("question");
  });

  it("classifies assistant with plain text as agent_response", () => {
    expect(
      classifyMessage(
        msg({ type: "assistant", content: "Analyzing the domain..." }),
      ),
    ).toBe("agent_response");
  });

  it("classifies unknown type as status (fallback)", () => {
    expect(
      classifyMessage(msg({ type: "unknown_type" as AgentMessage["type"] })),
    ).toBe("status");
  });

  it("classifies assistant with empty content as agent_response", () => {
    expect(classifyMessage(msg({ type: "assistant", content: "" }))).toBe("agent_response");
  });
});

describe("MessageItem visual treatments", () => {
  it("renders error message with CSS variable border styling", () => {
    const { container } = render(
      <MessageItem
        message={{
          type: "error",
          content: "Something broke",
          raw: {},
          timestamp: Date.now(),
        }}
      />,
    );
    const el = container.firstElementChild!;
    expect(el.className).toContain("border-l-[var(--chat-error-border)]");
    expect(el.className).toContain("bg-[var(--chat-error-bg)]");
    expect(el.textContent).toBe("Something broke");
  });

  it("renders result message with CSS variable border styling", () => {
    const { container } = render(
      <MessageItem
        message={{
          type: "result",
          content: "Agent finished successfully",
          raw: {},
          timestamp: Date.now(),
        }}
      />,
    );
    const el = container.firstElementChild!;
    expect(el.className).toContain("border-l-[var(--chat-result-border)]");
    expect(el.className).toContain("bg-[var(--chat-result-bg)]");
    expect(el.textContent).toContain("Agent finished successfully");
  });

  it("renders tool_call message as simple non-interactive summary", () => {
    const { container } = render(
      <MessageItem
        message={{
          type: "assistant",
          content: null as unknown as string,
          raw: {
            message: {
              content: [
                { type: "tool_use", name: "Read", input: { file_path: "/a/b.ts" } },
              ],
            },
          },
          timestamp: Date.now(),
        }}
      />,
    );
    // Tool call should render as simple non-interactive summary (no collapsible)
    const summary = container.querySelector("div");
    expect(summary).toBeInTheDocument();
    expect(summary!.textContent).toContain("Reading b.ts");

    // Should have muted foreground styling
    expect(summary!.className).toContain("text-muted-foreground");

    // Should NOT have a button (no expand/collapse)
    const button = container.querySelector("button");
    expect(button).not.toBeInTheDocument();
  });

  it("renders question message with CSS variable border styling and compact markdown", () => {
    const { container } = render(
      <MessageItem
        message={{
          type: "assistant",
          content: "## Follow-up Questions\n1. What about X?",
          raw: {},
          timestamp: Date.now(),
        }}
      />,
    );
    const el = container.firstElementChild!;
    expect(el.className).toContain("border-l-[var(--chat-question-border)]");
    expect(el.className).toContain("bg-[var(--chat-question-bg)]");
    // Question markdown body uses compact class
    const markdownBody = el.querySelector(".markdown-body");
    expect(markdownBody).toBeInTheDocument();
    expect(markdownBody!.className).toContain("compact");
  });

  it("renders agent_response with pl-3 and compact markdown", () => {
    const { container } = render(
      <MessageItem
        message={{
          type: "assistant",
          content: "Just plain text",
          raw: {},
          timestamp: Date.now(),
        }}
      />,
    );
    const el = container.firstElementChild!;
    expect(el.className).not.toContain("border-l-2");
    expect(el.className).toContain("pl-3");
    expect(el.className).toContain("markdown-body");
    expect(el.className).toContain("compact");
  });
});

describe("categoryStyles", () => {
  it("has entries for all message categories", () => {
    const categories: MessageCategory[] = [
      "agent_response", "tool_call", "question", "result", "error", "status",
    ];
    for (const cat of categories) {
      expect(categoryStyles).toHaveProperty(cat);
    }
  });

  it("has non-empty styles for decorated categories", () => {
    expect(categoryStyles.tool_call).toContain("border-l-2");
    expect(categoryStyles.question).toContain("border-l-2");
    expect(categoryStyles.result).toContain("border-l-2");
    expect(categoryStyles.error).toContain("border-l-2");
  });

  it("has expected styles for plain categories", () => {
    expect(categoryStyles.agent_response).toBe("pl-3");
    expect(categoryStyles.status).toBe("");
  });
});

describe("endsWithUserQuestion", () => {
  it("detects trailing question mark with question word", () => {
    expect(endsWithUserQuestion("Would you like me to proceed?")).toBe(true);
  });

  it("detects question after multi-line content", () => {
    expect(
      endsWithUserQuestion("Here is my analysis.\n\nDoes this approach work for you?"),
    ).toBe(true);
  });

  it("ignores trailing whitespace when detecting questions", () => {
    expect(endsWithUserQuestion("What do you think?\n  \n")).toBe(true);
  });

  it("does not flag text without trailing question mark", () => {
    expect(endsWithUserQuestion("Analyzing the domain...")).toBe(false);
  });

  it("does not flag empty string", () => {
    expect(endsWithUserQuestion("")).toBe(false);
  });

  it("does not flag a lone question mark", () => {
    expect(endsWithUserQuestion("?")).toBe(false);
  });

  it("does not flag short fragments ending in question mark", () => {
    expect(endsWithUserQuestion("null?")).toBe(false);
  });

  it("does not flag rhetorical or code-style questions without question words", () => {
    expect(endsWithUserQuestion("string | undefined?")).toBe(false);
  });

  it("detects questions with various question words", () => {
    expect(endsWithUserQuestion("How should we handle this edge case?")).toBe(true);
    expect(endsWithUserQuestion("Is this the correct approach?")).toBe(true);
    expect(endsWithUserQuestion("Can you confirm the data model?")).toBe(true);
    expect(endsWithUserQuestion("Where should the output be saved?")).toBe(true);
  });
});

describe("classifyMessage — question-ending detection", () => {
  it("classifies assistant message ending with a question as question", () => {
    expect(
      classifyMessage(
        msg({
          type: "assistant",
          content: "I've analyzed the data model.\n\nShould I continue with the build step?",
        }),
      ),
    ).toBe("question");
  });

  it("does not classify assistant message without question as question", () => {
    expect(
      classifyMessage(
        msg({
          type: "assistant",
          content: "I've analyzed the data model. Moving on.",
        }),
      ),
    ).toBe("agent_response");
  });
});

describe("MessageItem — Needs Response badge", () => {
  it("renders 'Needs Response' badge for follow_up question messages", () => {
    render(
      <MessageItem
        message={{
          type: "assistant",
          content: "## Follow-up Questions\n1. What is the primary key?",
          raw: {},
          timestamp: Date.now(),
        }}
      />,
    );
    expect(screen.getByText("Needs Response")).toBeInTheDocument();
  });

  it("renders 'Needs Response' badge for gate_check question messages", () => {
    render(
      <MessageItem
        message={{
          type: "assistant",
          content: "Ready to proceed to the build step.",
          raw: {},
          timestamp: Date.now(),
        }}
      />,
    );
    expect(screen.getByText("Needs Response")).toBeInTheDocument();
  });

  it("renders 'Needs Response' badge for question-ending messages", () => {
    render(
      <MessageItem
        message={{
          type: "assistant",
          content: "I found some issues.\n\nWould you like me to fix them?",
          raw: {},
          timestamp: Date.now(),
        }}
      />,
    );
    expect(screen.getByText("Needs Response")).toBeInTheDocument();
  });

  it("does NOT render 'Needs Response' badge for plain agent_response messages", () => {
    render(
      <MessageItem
        message={{
          type: "assistant",
          content: "Analyzing the domain...",
          raw: {},
          timestamp: Date.now(),
        }}
      />,
    );
    expect(screen.queryByText("Needs Response")).not.toBeInTheDocument();
  });

  it("does NOT render 'Needs Response' badge for error messages", () => {
    render(
      <MessageItem
        message={{
          type: "error",
          content: "Something went wrong",
          raw: {},
          timestamp: Date.now(),
        }}
      />,
    );
    expect(screen.queryByText("Needs Response")).not.toBeInTheDocument();
  });

  it("does NOT render 'Needs Response' badge for result messages", () => {
    render(
      <MessageItem
        message={{
          type: "result",
          content: "Agent completed",
          raw: {},
          timestamp: Date.now(),
        }}
      />,
    );
    expect(screen.queryByText("Needs Response")).not.toBeInTheDocument();
  });

  it("does NOT render 'Needs Response' badge for tool_call messages", () => {
    render(
      <MessageItem
        message={{
          type: "assistant",
          content: null as unknown as string,
          raw: {
            message: {
              content: [
                { type: "tool_use", name: "Read", input: { file_path: "/a/b.ts" } },
              ],
            },
          },
          timestamp: Date.now(),
        }}
      />,
    );
    expect(screen.queryByText("Needs Response")).not.toBeInTheDocument();
  });
});

// --- VD-370: Collapsible tool calls ---

function makeToolCallMsg(name: string, input: Record<string, unknown>): AgentMessage {
  return {
    type: "assistant",
    content: null as unknown as string,
    raw: { message: { content: [{ type: "tool_use", name, input }] } },
    timestamp: Date.now(),
  };
}

describe("ToolCallGroup", () => {
  const groupMessages = [
    makeToolCallMsg("Read", { file_path: "/a.ts" }),
    makeToolCallMsg("Grep", { pattern: "export" }),
    makeToolCallMsg("Read", { file_path: "/b.ts" }),
  ];

  it("renders group header with correct count", () => {
    render(<ToolCallGroup messages={groupMessages} />);
    expect(screen.getByText("3 tool calls")).toBeInTheDocument();
  });

  it("is collapsed by default", () => {
    render(<ToolCallGroup messages={groupMessages} />);
    const details = screen.getByTestId("tool-group-details");
    expect(details.className).toContain("max-h-0");
    expect(details.className).toContain("opacity-0");
  });

  it("expands to show individual tool summaries when clicked", () => {
    render(<ToolCallGroup messages={groupMessages} />);

    // Click group header button to expand
    fireEvent.click(screen.getAllByRole("button")[0]);

    const details = screen.getByTestId("tool-group-details");
    expect(details.className).toContain("opacity-100");

    // Individual tool summaries should be visible as plain text
    expect(screen.getByText("Reading a.ts")).toBeInTheDocument();
    expect(screen.getByText(/Grep:/)).toBeInTheDocument();
    expect(screen.getByText("Reading b.ts")).toBeInTheDocument();
  });

  it("has connecting left border when expanded", () => {
    const { container } = render(<ToolCallGroup messages={groupMessages} />);

    fireEvent.click(screen.getAllByRole("button")[0]);

    const borderDiv = container.querySelector(".border-l-2.border-l-\\[var\\(--chat-tool-border\\)\\]");
    expect(borderDiv).toBeInTheDocument();
  });

  it("shows correct count for 2 tool calls", () => {
    render(<ToolCallGroup messages={groupMessages.slice(0, 2)} />);
    expect(screen.getByText("2 tool calls")).toBeInTheDocument();
  });

  it("has animation classes on details container", () => {
    render(<ToolCallGroup messages={groupMessages} />);
    const details = screen.getByTestId("tool-group-details");
    expect(details.className).toContain("transition-all");
    expect(details.className).toContain("duration-200");
    expect(details.className).toContain("ease-out");
  });
});

describe("computeToolCallGroups", () => {
  function makeAssistant(content = "text"): AgentMessage {
    return { type: "assistant", content, raw: {}, timestamp: Date.now() };
  }

  it("returns empty maps for no messages", () => {
    const result = computeToolCallGroups([]);
    expect(result.groups.size).toBe(0);
    expect(result.memberOf.size).toBe(0);
  });

  it("does not group a single tool call", () => {
    const messages = [makeToolCallMsg("Read", { file_path: "/a.ts" })];
    const result = computeToolCallGroups(messages);
    expect(result.groups.size).toBe(0);
    expect(result.memberOf.size).toBe(0);
  });

  it("groups 2 consecutive tool calls", () => {
    const messages = [
      makeToolCallMsg("Read", { file_path: "/a.ts" }),
      makeToolCallMsg("Grep", { pattern: "foo" }),
    ];
    const result = computeToolCallGroups(messages);
    expect(result.groups.size).toBe(1);
    expect(result.groups.get(0)).toEqual([0, 1]);
    expect(result.memberOf.get(0)).toBe(0);
    expect(result.memberOf.get(1)).toBe(0);
  });

  it("groups 3 consecutive tool calls", () => {
    const messages = [
      makeToolCallMsg("Read", { file_path: "/a.ts" }),
      makeToolCallMsg("Grep", { pattern: "foo" }),
      makeToolCallMsg("Read", { file_path: "/b.ts" }),
    ];
    const result = computeToolCallGroups(messages);
    expect(result.groups.get(0)).toEqual([0, 1, 2]);
  });

  it("breaks groups at non-tool-call messages", () => {
    const messages = [
      makeToolCallMsg("Read", { file_path: "/a.ts" }),
      makeToolCallMsg("Grep", { pattern: "foo" }),
      makeAssistant("thinking..."),
      makeToolCallMsg("Read", { file_path: "/b.ts" }),
      makeToolCallMsg("Read", { file_path: "/c.ts" }),
    ];
    const result = computeToolCallGroups(messages);
    expect(result.groups.size).toBe(2);
    expect(result.groups.get(0)).toEqual([0, 1]);
    expect(result.groups.get(3)).toEqual([3, 4]);
  });

  it("does not group tool calls separated by non-tool messages", () => {
    const messages = [
      makeToolCallMsg("Read", { file_path: "/a.ts" }),
      makeAssistant("thinking..."),
      makeToolCallMsg("Grep", { pattern: "foo" }),
    ];
    const result = computeToolCallGroups(messages);
    expect(result.groups.size).toBe(0);
  });

  it("handles multiple small groups in sequence", () => {
    const messages = [
      makeToolCallMsg("Read", { file_path: "/a.ts" }),
      makeToolCallMsg("Read", { file_path: "/b.ts" }),
      makeAssistant("thinking"),
      makeToolCallMsg("Grep", { pattern: "foo" }),
      makeToolCallMsg("Grep", { pattern: "bar" }),
      makeAssistant("more thinking"),
      makeToolCallMsg("Read", { file_path: "/c.ts" }),
      makeToolCallMsg("Read", { file_path: "/d.ts" }),
    ];
    const result = computeToolCallGroups(messages);
    expect(result.groups.size).toBe(3);
    expect(result.groups.get(0)).toEqual([0, 1]);
    expect(result.groups.get(3)).toEqual([3, 4]);
    expect(result.groups.get(6)).toEqual([6, 7]);
  });

  it("handles tool calls at the end of messages", () => {
    const messages = [
      makeAssistant("analysis"),
      makeToolCallMsg("Read", { file_path: "/a.ts" }),
      makeToolCallMsg("Grep", { pattern: "foo" }),
    ];
    const result = computeToolCallGroups(messages);
    expect(result.groups.size).toBe(1);
    expect(result.groups.get(1)).toEqual([1, 2]);
  });

  it("returns stable indices when messages are appended", () => {
    const messages = [
      makeToolCallMsg("Read", { file_path: "/a.ts" }),
      makeToolCallMsg("Read", { file_path: "/b.ts" }),
    ];
    const result1 = computeToolCallGroups(messages);
    expect(result1.groups.get(0)).toEqual([0, 1]);

    // Simulate appending more messages (new array)
    const extended = [
      ...messages,
      makeAssistant("new message"),
      makeToolCallMsg("Grep", { pattern: "bar" }),
    ];
    const result2 = computeToolCallGroups(extended);
    // Original group remains at same indices
    expect(result2.groups.get(0)).toEqual([0, 1]);
    // Single tool call at end is not grouped
    expect(result2.groups.has(3)).toBe(false);
  });
});

// --- VD-371: TurnMarker and message grouping ---

function makeStatusMsg(): AgentMessage {
  return { type: "system", content: "status", raw: {}, timestamp: Date.now() };
}

function makeErrorMsg(): AgentMessage {
  return { type: "error", content: "something broke", raw: {}, timestamp: Date.now() };
}

function makeResultMsg(): AgentMessage {
  return { type: "result", content: "done", raw: {}, timestamp: Date.now() };
}

function buildTurnMap(messages: AgentMessage[]): Map<number, number> {
  const map = new Map<number, number>();
  let turn = 0;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].type === "assistant") {
      turn++;
      map.set(i, turn);
    }
  }
  return map;
}

describe("TurnMarker", () => {
  it("renders with badge styling", () => {
    const { container } = render(<TurnMarker turn={3} />);
    expect(screen.getByText("Turn 3")).toBeInTheDocument();

    const dividers = container.querySelectorAll(".bg-border");
    expect(dividers).toHaveLength(1);
  });
});

describe("computeMessageGroups", () => {
  it("returns empty array for empty messages", () => {
    expect(computeMessageGroups([], new Map())).toEqual([]);
  });

  it("first visible message gets 'none' spacing", () => {
    const messages = [msg({ type: "assistant", content: "Hello" })];
    const turnMap = buildTurnMap(messages);
    expect(computeMessageGroups(messages, turnMap)[0]).toBe("none");
  });

  it("consecutive assistant messages in same group get 'continuation'", () => {
    const messages = [
      msg({ type: "assistant", content: "first" }),
      makeToolCallMsg("Read", { file_path: "/test.ts" }),
      msg({ type: "assistant", content: "third" }),
    ];
    const turnMap = new Map<number, number>([[0, 1]]);
    expect(computeMessageGroups(messages, turnMap)).toEqual(["none", "continuation", "continuation"]);
  });

  it("turn markers break groups — next message gets 'group-start'", () => {
    const messages = [
      msg({ type: "assistant", content: "turn 1" }),
      makeToolCallMsg("Read", { file_path: "/test.ts" }),
      msg({ type: "assistant", content: "turn 2" }),
    ];
    const turnMap = new Map<number, number>([[0, 1], [2, 2]]);
    const groups = computeMessageGroups(messages, turnMap);
    expect(groups[0]).toBe("none");
    expect(groups[1]).toBe("continuation");
    expect(groups[2]).toBe("group-start");
  });

  it("status messages always get 'none' and don't affect grouping", () => {
    const messages = [
      msg({ type: "assistant", content: "first" }),
      makeStatusMsg(),
      makeToolCallMsg("Read", { file_path: "/test.ts" }),
    ];
    const turnMap = new Map<number, number>([[0, 1]]);
    const groups = computeMessageGroups(messages, turnMap);
    expect(groups[0]).toBe("none");
    expect(groups[1]).toBe("none");
    expect(groups[2]).toBe("continuation");
  });

  it("different sender types start new groups", () => {
    const messages = [
      msg({ type: "assistant", content: "hi" }),
      makeErrorMsg(),
      msg({ type: "assistant", content: "continues" }),
    ];
    const turnMap = new Map<number, number>([[0, 1], [2, 2]]);
    const groups = computeMessageGroups(messages, turnMap);
    expect(groups[0]).toBe("none");
    expect(groups[1]).toBe("group-start");
    expect(groups[2]).toBe("group-start");
  });

  it("handles a realistic message sequence", () => {
    const messages = [
      msg({ type: "assistant", content: "thinking..." }),
      makeToolCallMsg("Read", { file_path: "/a.ts" }),
      makeToolCallMsg("Grep", { pattern: "foo" }),
      msg({ type: "assistant", content: "found it" }),
      makeToolCallMsg("Read", { file_path: "/b.ts" }),
      makeResultMsg(),
    ];
    const turnMap = new Map<number, number>([[0, 1], [3, 2]]);
    const expected: MessageSpacing[] = [
      "none", "continuation", "continuation", "group-start", "continuation", "group-start",
    ];
    expect(computeMessageGroups(messages, turnMap)).toEqual(expected);
  });

  it("leading status messages don't count as first visible", () => {
    const messages = [makeStatusMsg(), makeStatusMsg(), msg({ type: "assistant", content: "first real" })];
    const turnMap = new Map<number, number>([[2, 1]]);
    const groups = computeMessageGroups(messages, turnMap);
    expect(groups[0]).toBe("none");
    expect(groups[1]).toBe("none");
    expect(groups[2]).toBe("none");
  });
});

describe("spacingClasses", () => {
  it("maps all spacing types to string classes", () => {
    expect(spacingClasses.none).toBe("");
    expect(spacingClasses["group-start"]).toBe("mt-3");
    expect(spacingClasses.continuation).toBe("mt-0.5");
  });
});

// --- VD-373: Typography hierarchy and message type icons ---

describe("VD-373: Typography hierarchy", () => {
  it("agent prose uses compact markdown with pl-3", () => {
    const { container } = render(
      <MessageItem
        message={{
          type: "assistant",
          content: "Analyzing the domain model...",
          raw: {},
          timestamp: Date.now(),
        }}
      />,
    );
    const el = container.firstElementChild!;
    expect(el.className).toContain("pl-3");
    expect(el.className).toContain("markdown-body");
    expect(el.className).toContain("compact");
  });

  it("turn markers use Badge with font-medium", () => {
    render(<TurnMarker turn={5} />);
    const badge = screen.getByText("Turn 5");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("font-medium");
  });

  it("question messages use compact markdown", () => {
    const { container } = render(
      <MessageItem
        message={{
          type: "assistant",
          content: "## Follow-up Questions\n1. What is the primary key?",
          raw: {},
          timestamp: Date.now(),
        }}
      />,
    );
    const markdownBody = container.querySelector(".markdown-body")!;
    expect(markdownBody).toBeInTheDocument();
    expect(markdownBody.className).toContain("compact");
  });
});

describe("VD-373: Message type icons", () => {
  it("error messages render XCircle icon", () => {
    const { container } = render(
      <MessageItem
        message={{
          type: "error",
          content: "Something went wrong",
          raw: {},
          timestamp: Date.now(),
        }}
      />,
    );
    // XCircle renders as an SVG inside the error wrapper
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("result messages render CheckCircle2 icon", () => {
    const { container } = render(
      <MessageItem
        message={{
          type: "result",
          content: "Agent finished successfully",
          raw: {},
          timestamp: Date.now(),
        }}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("question messages render MessageCircleQuestion icon", () => {
    const { container } = render(
      <MessageItem
        message={{
          type: "assistant",
          content: "## Follow-up Questions\n1. What is the primary key?",
          raw: {},
          timestamp: Date.now(),
        }}
      />,
    );
    // Question wrapper has an icon in the header row
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });

  it("agent prose responses do NOT render message-type icons", () => {
    const { container } = render(
      <MessageItem
        message={{
          type: "assistant",
          content: "Analyzing the domain...",
          raw: {},
          timestamp: Date.now(),
        }}
      />,
    );
    // Agent prose should have no SVG icons
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(0);
  });

  it("tool call messages do NOT render message-type icons (only tool icons)", () => {
    const { container } = render(
      <MessageItem
        message={makeToolCallMsg("Read", { file_path: "/src/app.ts" })}
      />,
    );
    // Tool calls have tool-specific icons (e.g. FileText for Read) but not
    // message-type icons (XCircle, CheckCircle2, MessageCircleQuestion).
    // The tool icon is size-3.5, while message-type icons are size-4.
    const svgs = container.querySelectorAll("svg");
    // Should have exactly tool icons (chevron + tool icon), no size-4 message-type icons
    for (const svg of svgs) {
      expect(svg.classList.contains("size-4")).toBe(false);
    }
  });
});

// --- Tool call rendering: standalone vs grouped ---

describe("Tool call rendering: standalone vs grouped", () => {
  it("standalone tool call has no chevron button", () => {
    const { container } = render(
      <MessageItem
        message={makeToolCallMsg("Read", { file_path: "/src/app.ts" })}
      />,
    );
    // Should not have any button element
    expect(container.querySelector("button")).not.toBeInTheDocument();
    // Should not have any chevron icons
    expect(screen.queryByTestId("chevron-right")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chevron-down")).not.toBeInTheDocument();
  });

  it("standalone tool call shows tool icon and summary text", () => {
    const { container } = render(
      <MessageItem
        message={makeToolCallMsg("Read", { file_path: "/src/app.ts" })}
      />,
    );
    // Should show the summary text
    expect(screen.getByText("Reading app.ts")).toBeInTheDocument();
    // Should have a tool icon (FileText for Read)
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(1);
    expect(svgs[0].classList.contains("size-3.5")).toBe(true);
  });

  it("standalone tool call is plain text (no interactive elements)", () => {
    const { container } = render(
      <MessageItem
        message={makeToolCallMsg("Grep", { pattern: "TODO" })}
      />,
    );
    // Should have no interactive elements
    expect(container.querySelector("button")).not.toBeInTheDocument();
    // Should be a simple div with icon + text
    const wrapper = container.firstElementChild!;
    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper.querySelector("button")).not.toBeInTheDocument();
  });

  it("ToolCallGroup has exactly one chevron in header", () => {
    const groupMessages = [
      makeToolCallMsg("Read", { file_path: "/a.ts" }),
      makeToolCallMsg("Grep", { pattern: "export" }),
      makeToolCallMsg("Read", { file_path: "/b.ts" }),
    ];
    const { container } = render(<ToolCallGroup messages={groupMessages} />);

    // Should have exactly one button (the group header)
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(1);

    // Button should contain a chevron (ChevronRight in collapsed state)
    const button = buttons[0];
    // ChevronRight + Terminal icon = 2 icons, but we care that there's exactly one button
    expect(button).toBeInTheDocument();
  });

  it("ToolCallGroup expanded members are plain text (no buttons)", () => {
    const groupMessages = [
      makeToolCallMsg("Read", { file_path: "/a.ts" }),
      makeToolCallMsg("Grep", { pattern: "export" }),
      makeToolCallMsg("Read", { file_path: "/b.ts" }),
    ];
    render(<ToolCallGroup messages={groupMessages} />);

    // Click to expand
    fireEvent.click(screen.getAllByRole("button")[0]);

    // Should show the three tool summaries as text
    expect(screen.getByText("Reading a.ts")).toBeInTheDocument();
    expect(screen.getByText(/Grep:/)).toBeInTheDocument();
    expect(screen.getByText("Reading b.ts")).toBeInTheDocument();

    // Expanded members should NOT have buttons
    // (The only button is the group header, which we already clicked)
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
  });

  it("ToolCallGroup expanded members have no chevrons", () => {
    const groupMessages = [
      makeToolCallMsg("Read", { file_path: "/a.ts" }),
      makeToolCallMsg("Grep", { pattern: "export" }),
    ];
    render(<ToolCallGroup messages={groupMessages} />);

    // Expand the group
    fireEvent.click(screen.getAllByRole("button")[0]);

    // The details container should have no buttons inside it
    const details = screen.getByTestId("tool-group-details");
    expect(details.querySelector("button")).not.toBeInTheDocument();

    // Each member should be a simple div with no interactive elements
    const members = details.querySelectorAll("div.flex.items-center");
    expect(members).toHaveLength(2);
    for (const member of members) {
      expect(member.querySelector("button")).not.toBeInTheDocument();
    }
  });

  it("ToolCallGroup expanded members show icon and text only", () => {
    const groupMessages = [
      makeToolCallMsg("Read", { file_path: "/test.ts" }),
      makeToolCallMsg("Write", { file_path: "/output.ts" }),
    ];
    render(<ToolCallGroup messages={groupMessages} />);

    // Expand
    fireEvent.click(screen.getAllByRole("button")[0]);

    // Find the details container
    const details = screen.getByTestId("tool-group-details");
    const memberDivs = details.querySelectorAll("div.flex.items-center");

    // Should have 2 member divs
    expect(memberDivs).toHaveLength(2);

    // Each member div should have icon + text, no button
    for (const div of memberDivs) {
      expect(div.querySelector("button")).not.toBeInTheDocument();
      expect(div.querySelector("svg.size-3\\.5")).toBeInTheDocument();
      expect(div.querySelector("span")).toBeInTheDocument();
    }
  });
});

// --- VD-374: Message transitions and animations ---

describe("VD-374: Message transitions and animations", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
  });

  it("message wrappers have animate-message-in class", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", {
      type: "assistant",
      content: "Analyzing the domain...",
      raw: { message: { content: [{ type: "text", text: "Analyzing the domain..." }] } },
      timestamp: Date.now(),
    });
    const { container } = render(<AgentOutputPanel agentId="test-agent" />);
    const animatedDivs = container.querySelectorAll(".animate-message-in");
    expect(animatedDivs.length).toBeGreaterThanOrEqual(1);
  });

  it("ToolCallGroup details have transition animation", () => {
    const groupMessages = [
      makeToolCallMsg("Read", { file_path: "/a.ts" }),
      makeToolCallMsg("Grep", { pattern: "export" }),
      makeToolCallMsg("Read", { file_path: "/b.ts" }),
    ];
    render(<ToolCallGroup messages={groupMessages} />);
    const details = screen.getByTestId("tool-group-details");
    expect(details.className).toContain("transition-all");
    expect(details.className).toContain("duration-200");
    expect(details.className).toContain("ease-out");
  });

  it("multiple messages each get animate-message-in", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", {
      type: "assistant",
      content: "First message",
      raw: { message: { content: [{ type: "text", text: "First message" }] } },
      timestamp: Date.now(),
    });
    useAgentStore.getState().addMessage("test-agent", {
      type: "assistant",
      content: "Second message",
      raw: { message: { content: [{ type: "text", text: "Second message" }] } },
      timestamp: Date.now() + 1,
    });
    const { container } = render(<AgentOutputPanel agentId="test-agent" />);
    const animatedDivs = container.querySelectorAll(".animate-message-in");
    expect(animatedDivs.length).toBe(2);
  });

  it("tool call groups also get animate-message-in wrapper", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", {
      type: "assistant",
      content: null as unknown as string,
      raw: { message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/a.ts" } }] } },
      timestamp: Date.now(),
    });
    useAgentStore.getState().addMessage("test-agent", {
      type: "assistant",
      content: null as unknown as string,
      raw: { message: { content: [{ type: "tool_use", name: "Grep", input: { pattern: "foo" } }] } },
      timestamp: Date.now() + 1,
    });
    const { container } = render(<AgentOutputPanel agentId="test-agent" />);
    const animatedDivs = container.querySelectorAll(".animate-message-in");
    expect(animatedDivs.length).toBeGreaterThanOrEqual(1);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  MessageItem,
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
});

describe("classifyMessage", () => {
  const msg = (overrides: Partial<AgentMessage>) =>
    ({
      type: "assistant",
      content: "",
      raw: {},
      timestamp: Date.now(),
      ...overrides,
    }) as AgentMessage;

  it("classifies system message as status", () => {
    expect(classifyMessage(msg({ type: "system" }))).toBe("status");
  });

  it("classifies error message as error", () => {
    expect(classifyMessage(msg({ type: "error", content: "fail" }))).toBe("error");
  });

  it("classifies result message as result", () => {
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
});

describe("MessageItem visual treatments", () => {
  it("renders error message with destructive styling", () => {
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
    expect(el.className).toContain("border-destructive");
    expect(el.className).toContain("bg-destructive");
    expect(el.textContent).toBe("Something broke");
  });

  it("renders result message with green border/bg styling", () => {
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
    expect(el.className).toContain("border-green-500");
    expect(el.className).toContain("bg-green-500");
    expect(el.textContent).toContain("Agent finished successfully");
  });

  it("renders tool_call message with muted foreground styling", () => {
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
    const el = container.firstElementChild!;
    expect(el.className).toContain("text-muted-foreground");
    expect(el.textContent).toContain("Reading b.ts");
  });
});

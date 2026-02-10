import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/stores/agent-store";

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
  type MessageCategory,
} from "@/components/agent-output-panel";
import type { AgentMessage } from "@/stores/agent-store";

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
          raw: { message: { content: [{ type: "tool_use", name: "Read", input: {} }] } },
        }),
      ),
    ).toBe("tool_call");
  });

  it("classifies assistant with follow-up questions as question", () => {
    expect(
      classifyMessage(
        msg({ type: "assistant", content: "## Follow-up Questions\n1. What is X?" }),
      ),
    ).toBe("question");
  });

  it("classifies assistant with gate_check text as question", () => {
    expect(
      classifyMessage(
        msg({ type: "assistant", content: "Everything looks good. Ready to proceed to the build step." }),
      ),
    ).toBe("question");
  });

  it("classifies assistant with plain text as agent_response", () => {
    expect(
      classifyMessage(msg({ type: "assistant", content: "Analyzing the domain..." })),
    ).toBe("agent_response");
  });

  it("classifies unknown type as status (fallback)", () => {
    expect(classifyMessage(msg({ type: "unknown" }))).toBe("status");
  });

  it("classifies assistant with empty content as agent_response", () => {
    expect(classifyMessage(msg({ type: "assistant", content: "" }))).toBe("agent_response");
  });
});

describe("MessageItem visual treatments", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
  });

  it("applies error styles to error messages", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", msg({ type: "error", content: "Oops" }));
    const { container } = render(<AgentOutputPanel agentId="test-agent" />);
    const errorDiv = container.querySelector(".border-l-\\[var\\(--chat-error-border\\)\\]");
    expect(errorDiv).toBeInTheDocument();
  });

  it("applies result styles to result messages", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", msg({ type: "result", content: "Done" }));
    const { container } = render(<AgentOutputPanel agentId="test-agent" />);
    const resultDiv = container.querySelector(".border-l-\\[var\\(--chat-result-border\\)\\]");
    expect(resultDiv).toBeInTheDocument();
  });

  it("applies tool_call styles to tool use messages", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", msg({
      type: "assistant",
      raw: { message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/test.md" } }] } },
    }));
    const { container } = render(<AgentOutputPanel agentId="test-agent" />);
    const toolDiv = container.querySelector(".border-l-\\[var\\(--chat-tool-border\\)\\]");
    expect(toolDiv).toBeInTheDocument();
  });

  it("applies question styles to follow-up messages", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", msg({
      type: "assistant",
      content: "## Follow-up Questions\n1. What about X?",
    }));
    const { container } = render(<AgentOutputPanel agentId="test-agent" />);
    const questionDiv = container.querySelector(".border-l-\\[var\\(--chat-question-border\\)\\]");
    expect(questionDiv).toBeInTheDocument();
  });

  it("renders agent_response without border styling", () => {
    useAgentStore.getState().startRun("test-agent", "sonnet");
    useAgentStore.getState().addMessage("test-agent", msg({
      type: "assistant",
      content: "Just plain text",
    }));
    const { container } = render(<AgentOutputPanel agentId="test-agent" />);
    expect(container.querySelector(".border-l-2")).not.toBeInTheDocument();
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

  it("has empty styles for plain categories", () => {
    expect(categoryStyles.agent_response).toBe("");
    expect(categoryStyles.status).toBe("");
  });
});

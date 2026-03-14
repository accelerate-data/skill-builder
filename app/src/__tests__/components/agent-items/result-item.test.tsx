import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultItem } from "@/components/agent-items/result-item";
import type { DisplayItem } from "@/lib/display-types";

const markdownState = vi.hoisted(() => ({
  shouldThrow: false,
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => {
    if (markdownState.shouldThrow) {
      throw new Error("markdown render failed");
    }
    return <div data-testid="result-markdown">{children}</div>;
  },
}));

vi.mock("remark-gfm", () => ({
  default: () => undefined,
}));

vi.mock("rehype-sanitize", () => ({
  default: () => undefined,
}));

vi.mock("@/components/markdown-link", () => ({
  markdownComponents: {},
}));

function createItem(overrides: Partial<DisplayItem> = {}): DisplayItem {
  return {
    id: "result-1",
    type: "result",
    timestamp: 1,
    ...overrides,
  };
}

describe("ResultItem", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    markdownState.shouldThrow = false;
  });

  afterEach(() => {
    consoleError.mockClear();
  });

  it("renders a success result with the default message", () => {
    render(<ResultItem item={createItem()} />);

    expect(screen.getByText("Result:")).toBeInTheDocument();
    expect(screen.getByText("Agent completed")).toBeInTheDocument();
  });

  it("renders an error result with the provided text", () => {
    render(
      <ResultItem
        item={createItem({
          resultStatus: "error",
          outputText_result: "Command failed",
        })}
      />,
    );

    expect(screen.getByText("Command failed")).toBeInTheDocument();
    expect(screen.queryByText("Result:")).not.toBeInTheDocument();
  });

  it("renders the refusal copy instead of the result text", () => {
    render(
      <ResultItem
        item={createItem({
          resultStatus: "refusal",
          outputText_result: "ignored text",
        })}
      />,
    );

    expect(
      screen.getByText(
        "Agent declined this request due to safety constraints. Please revise your prompt.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("ignored text")).not.toBeInTheDocument();
  });

  it("renders result markdown when markdown output is available", () => {
    render(
      <ResultItem
        item={createItem({
          resultMarkdown: "## Summary\n- item",
        })}
      />,
    );

    expect(screen.getByTestId("result-markdown")).toHaveTextContent("## Summary");
    expect(screen.getByTestId("result-markdown")).toHaveTextContent("- item");
  });

  it("falls back to a pre block when markdown rendering throws", () => {
    markdownState.shouldThrow = true;

    render(
      <ResultItem
        item={createItem({
          resultMarkdown: "### broken markdown",
        })}
      />,
    );

    expect(screen.getByText("### broken markdown")).toBeInTheDocument();
    expect(screen.queryByTestId("result-markdown")).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
  });
});

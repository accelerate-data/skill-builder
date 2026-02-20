import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "@/components/markdown-link";

// Mock @tauri-apps/plugin-opener
const mockOpenUrl = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => mockOpenUrl(...args),
}));

beforeEach(() => {
  mockOpenUrl.mockClear();
});

describe("markdownComponents", () => {
  it("renders links with an anchor tag", () => {
    render(
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {"Visit [Example](https://example.com) for more info."}
      </ReactMarkdown>,
    );
    const link = screen.getByText("Example");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "https://example.com");
  });

  it("opens link in system browser via openUrl on click", () => {
    render(
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {"[Click me](https://example.com/docs)"}
      </ReactMarkdown>,
    );
    const link = screen.getByText("Click me");
    fireEvent.click(link);
    expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("prevents default navigation on click", () => {
    render(
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {"[Link](https://example.com)"}
      </ReactMarkdown>,
    );
    const link = screen.getByText("Link");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    const prevented = !link.dispatchEvent(event);
    expect(prevented).toBe(true);
  });

  it("renders plain text when link has no href", () => {
    // Directly test the component object with no href
    const AnchorComponent = markdownComponents.a! as React.FC<{
      href?: string;
      children?: React.ReactNode;
    }>;
    render(<AnchorComponent>plain text</AnchorComponent>);
    expect(screen.getByText("plain text")).toBeInTheDocument();
    // Should not be wrapped in an anchor
    expect(screen.getByText("plain text").tagName).not.toBe("A");
  });

  it("does not call openUrl when link has no href", () => {
    const AnchorComponent = markdownComponents.a! as React.FC<{
      href?: string;
      children?: React.ReactNode;
    }>;
    render(<AnchorComponent>no link</AnchorComponent>);
    fireEvent.click(screen.getByText("no link"));
    expect(mockOpenUrl).not.toHaveBeenCalled();
  });
});

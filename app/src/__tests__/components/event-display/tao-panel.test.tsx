import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaoPanel } from "@/components/event-display/tao-panel";

describe("TaoPanel", () => {
  it("renders thought section when thought is provided", () => {
    render(<TaoPanel thought="I should read the file first" />);
    expect(screen.getByText("THOUGHT")).toBeInTheDocument();
    expect(screen.getByText("I should read the file first")).toBeInTheDocument();
  });

  it("omits thought section when thought is absent", () => {
    render(<TaoPanel action="cat README.md" />);
    expect(screen.queryByText("THOUGHT")).not.toBeInTheDocument();
  });

  it("renders action section when action is provided", () => {
    render(<TaoPanel action="cat README.md" />);
    expect(screen.getByText("ACTION")).toBeInTheDocument();
    expect(screen.getByText("cat README.md")).toBeInTheDocument();
  });

  it("omits action section when action is absent", () => {
    render(<TaoPanel thought="thinking" />);
    expect(screen.queryByText("ACTION")).not.toBeInTheDocument();
  });

  it("renders observation section when observation is provided", () => {
    render(<TaoPanel action="cat README.md" observation="# README content" />);
    expect(screen.getByText("OBSERVATION")).toBeInTheDocument();
    expect(screen.getByText("# README content")).toBeInTheDocument();
  });

  it("omits observation section when observation is absent", () => {
    render(<TaoPanel action="cat README.md" />);
    expect(screen.queryByText("OBSERVATION")).not.toBeInTheDocument();
  });

  it("renders error section when error is provided", () => {
    render(<TaoPanel action="cat missing.txt" error="File not found" />);
    expect(screen.getByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("File not found")).toBeInTheDocument();
  });

  it("omits error section when error is absent", () => {
    render(<TaoPanel action="cat README.md" observation="content" />);
    expect(screen.queryByText("ERROR")).not.toBeInTheDocument();
  });

  it("renders all three sections when all are provided", () => {
    render(
      <TaoPanel
        thought="Reasoning text"
        action="cat README.md"
        observation="file content"
      />,
    );
    expect(screen.getByText("THOUGHT")).toBeInTheDocument();
    expect(screen.getByText("ACTION")).toBeInTheDocument();
    expect(screen.getByText("OBSERVATION")).toBeInTheDocument();
  });

  it("renders nothing when no props are provided", () => {
    const { container } = render(<TaoPanel />);
    expect(container.firstChild).toBeNull();
  });
});

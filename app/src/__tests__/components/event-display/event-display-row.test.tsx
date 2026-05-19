import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EventDisplayRow } from "@/components/event-display/event-display-row";

const BG = "var(--chat-tool-bg)";
const LABEL_COLOR = "var(--chat-tool-border)";

describe("EventDisplayRow", () => {
  it("renders label and summary text", () => {
    render(
      <EventDisplayRow bg={BG} labelColor={LABEL_COLOR} label="Tool" summary="read_file">
        <div>content</div>
      </EventDisplayRow>,
    );
    expect(screen.getByText("Tool")).toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("does not render a chevron when no children are provided", () => {
    render(
      <EventDisplayRow bg={BG} labelColor={LABEL_COLOR} label="Message" summary="hello" />,
    );
    expect(screen.queryByTestId("row-chevron")).not.toBeInTheDocument();
  });

  it("renders a chevron when children are provided", () => {
    render(
      <EventDisplayRow bg={BG} labelColor={LABEL_COLOR} label="Tool" summary="run_cmd">
        <div>inner</div>
      </EventDisplayRow>,
    );
    expect(screen.getByTestId("row-chevron")).toBeInTheDocument();
  });

  it("starts expanded by default when children present and defaultExpanded not set to false", () => {
    render(
      <EventDisplayRow bg={BG} labelColor={LABEL_COLOR} label="Tool" summary="run_cmd">
        <div>inner content</div>
      </EventDisplayRow>,
    );
    expect(screen.getByText("inner content")).toBeInTheDocument();
  });

  it("starts collapsed when defaultExpanded is false", () => {
    render(
      <EventDisplayRow
        bg={BG}
        labelColor={LABEL_COLOR}
        label="Setup"
        summary="system prompt"
        defaultExpanded={false}
      >
        <div>inner content</div>
      </EventDisplayRow>,
    );
    expect(screen.queryByText("inner content")).not.toBeInTheDocument();
  });

  it("toggles expansion when the row is clicked", () => {
    render(
      <EventDisplayRow bg={BG} labelColor={LABEL_COLOR} label="Tool" summary="run_cmd">
        <div>inner content</div>
      </EventDisplayRow>,
    );
    expect(screen.getByText("inner content")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("row-header"));
    expect(screen.queryByText("inner content")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("row-header"));
    expect(screen.getByText("inner content")).toBeInTheDocument();
  });

  it("shows token badge when tokenCount is provided", () => {
    render(
      <EventDisplayRow
        bg={BG}
        labelColor={LABEL_COLOR}
        label="Think"
        summary="reasoning"
        tokenCount={42}
      />,
    );
    expect(screen.getByText("42 tok")).toBeInTheDocument();
  });

  it("does not show token badge when tokenCount is absent", () => {
    render(
      <EventDisplayRow bg={BG} labelColor={LABEL_COLOR} label="Message" summary="hello" />,
    );
    expect(screen.queryByText(/tok/)).not.toBeInTheDocument();
  });

  it("shows duration when durationMs is greater than 0", () => {
    render(
      <EventDisplayRow
        bg={BG}
        labelColor={LABEL_COLOR}
        label="Tool"
        summary="run_cmd"
        durationMs={2500}
      />,
    );
    expect(screen.getByTestId("row-duration")).toBeInTheDocument();
  });

  it("does not show duration when durationMs is 0 or absent", () => {
    render(
      <EventDisplayRow
        bg={BG}
        labelColor={LABEL_COLOR}
        label="Tool"
        summary="run_cmd"
        durationMs={0}
      />,
    );
    expect(screen.queryByTestId("row-duration")).not.toBeInTheDocument();
  });

  it("applies italic class to summary when italic prop is true", () => {
    render(
      <EventDisplayRow
        bg={BG}
        labelColor={LABEL_COLOR}
        label="Think"
        summary="the agent thought about it"
        italic
      />,
    );
    const summary = screen.getByTestId("row-summary");
    expect(summary.className).toMatch(/italic/);
  });

  it("shows done status dot when status is done", () => {
    render(
      <EventDisplayRow
        bg={BG}
        labelColor={LABEL_COLOR}
        label="Tool"
        summary="done"
        status="done"
      />,
    );
    expect(screen.getByTestId("status-dot")).toBeInTheDocument();
  });

  it("shows error status dot when status is error", () => {
    render(
      <EventDisplayRow
        bg={BG}
        labelColor={LABEL_COLOR}
        label="Error"
        summary="failed"
        status="error"
      />,
    );
    const dot = screen.getByTestId("status-dot");
    expect(dot.className).toMatch(/destructive/);
  });
});

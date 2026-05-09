import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunStatusFooter } from "@/components/run-status-footer";

describe("RunStatusFooter", () => {
  it("shows 'stopping…' label when status is stopping", () => {
    render(<RunStatusFooter status="stopping" model="test-model" />);
    expect(screen.getByText("stopping…")).toBeInTheDocument();
  });

  it("shows pulsing dot for stopping status", () => {
    const { container } = render(<RunStatusFooter status="stopping" />);
    const dot = container.querySelector(".size-\\[5px\\]");
    expect(dot).toHaveClass("animate-pulse");
  });

  it("uses amber color for stopping dot", () => {
    const { container } = render(<RunStatusFooter status="stopping" />);
    const dot = container.querySelector(".size-\\[5px\\]");
    expect(dot).toHaveStyle({ background: "var(--color-amber)" });
  });

  it("shows 'running…' label when status is running", () => {
    render(<RunStatusFooter status="running" model="test-model" />);
    expect(screen.getByText("running…")).toBeInTheDocument();
  });

  it("shows 'ready' label when status is idle", () => {
    render(<RunStatusFooter status="idle" />);
    expect(screen.getByText("ready")).toBeInTheDocument();
  });
});

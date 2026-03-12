import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RuntimeErrorDialog } from "@/components/runtime-error-dialog";

describe("RuntimeErrorDialog", () => {
  it("classifies node errors as compatibility issues", () => {
    render(
      <RuntimeErrorDialog
        error={{
          error_type: "node_incompatible",
          message: "Node.js v16.0.0 is not compatible.",
          fix_hint: "Install Node.js 18+ from https://nodejs.org",
        }}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText("Compatibility issue")).toBeInTheDocument();
    expect(
      screen.getByText(/requires installing or updating Node\.js/i)
    ).toBeInTheDocument();
  });

  it("classifies spawn failures as transient startup issues", () => {
    render(
      <RuntimeErrorDialog
        error={{
          error_type: "spawn_failed",
          message: "Failed to start agent runtime: permission denied",
          fix_hint: "Check file permissions and rebuild the sidecar.",
        }}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText("Transient startup issue")).toBeInTheDocument();
    expect(screen.getByText(/usually temporary/i)).toBeInTheDocument();
  });

  it("shows nodejs.org link for node compatibility errors", () => {
    render(
      <RuntimeErrorDialog
        error={{
          error_type: "node_missing",
          message: "Node.js is not installed or not in PATH.",
          fix_hint: "Install Node.js 18+ from https://nodejs.org",
        }}
        onDismiss={vi.fn()}
      />
    );

    const nodeLink = screen.getByRole("link", { name: /nodejs\.org/i });
    expect(nodeLink).toHaveAttribute("href", "https://nodejs.org");
  });

  it("calls onDismiss when Dismiss is clicked", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <RuntimeErrorDialog
        error={{
          error_type: "spawn_failed",
          message: "Failed to start agent runtime",
          fix_hint: "Try rebuilding the sidecar.",
        }}
        onDismiss={onDismiss}
      />
    );

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not render when error is null", () => {
    const { container } = render(
      <RuntimeErrorDialog error={null} onDismiss={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

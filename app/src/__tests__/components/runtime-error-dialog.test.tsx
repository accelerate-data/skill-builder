import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RuntimeErrorDialog } from "@/components/runtime-error-dialog";

describe("RuntimeErrorDialog", () => {
  it("classifies spawn failures as transient startup issues", () => {
    render(
      <RuntimeErrorDialog
        error={{
          error_type: "spawn_failed",
          message: "Failed to start agent runtime: permission denied",
          fix_hint: "Check file permissions and rebuild the runtime.",
        }}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText("Transient startup issue")).toBeInTheDocument();
    expect(screen.getByText(/usually temporary/i)).toBeInTheDocument();
  });

  it("calls onDismiss when Dismiss is clicked", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <RuntimeErrorDialog
        error={{
          error_type: "spawn_failed",
          message: "Failed to start agent runtime",
          fix_hint: "Try rebuilding the runtime.",
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

  it("shows API key error for AuthenticationFailed", () => {
    render(
      <RuntimeErrorDialog
        error={{
          error_type: "AuthenticationFailed",
          message: "Invalid API key",
          fix_hint: "Update your API key in Settings.",
        }}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText("API key error")).toBeInTheDocument();
    expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument();
  });
});

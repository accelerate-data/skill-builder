import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "@/components/error-boundary";

function StableChild() {
  return <div>Healthy child</div>;
}

describe("ErrorBoundary", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders children when no error is thrown", () => {
    render(
      <ErrorBoundary>
        <StableChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Healthy child")).toBeInTheDocument();
  });

  it("renders a custom fallback when provided", () => {
    function ThrowingChild(): never {
      throw new Error("Boom");
    }

    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Custom fallback")).toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("shows the default fallback and recovers after retry", async () => {
    const user = userEvent.setup({ delay: null });
    let shouldThrow = true;

    function MaybeThrowingChild() {
      if (shouldThrow) {
        throw new Error("Exploded");
      }

      return <div>Recovered child</div>;
    }

    render(
      <ErrorBoundary>
        <MaybeThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Exploded")).toBeInTheDocument();

    shouldThrow = false;
    await user.click(screen.getByRole("button", { name: /Try Again/i }));

    expect(screen.getByText("Recovered child")).toBeInTheDocument();
  });
});

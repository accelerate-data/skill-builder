import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorItem } from "@/components/agent-items/error-item";
import type { DisplayItem } from "@/lib/display-types";

function createItem(overrides: Partial<DisplayItem> = {}): DisplayItem {
  return {
    id: "error-1",
    type: "error",
    timestamp: 1,
    ...overrides,
  };
}

describe("ErrorItem", () => {
  it("renders the provided error message", () => {
    render(
      <ErrorItem
        item={createItem({
          errorMessage: "Network timeout",
        })}
      />,
    );

    expect(screen.getByText("Network timeout")).toBeInTheDocument();
  });

  it("falls back to the default error message", () => {
    render(<ErrorItem item={createItem()} />);

    expect(screen.getByText("Unknown error")).toBeInTheDocument();
  });
});

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  LifecycleChipView,
  type LifecycleStatus,
} from "@/components/refine/lifecycle-chip";

describe("LifecycleChipView", () => {
  it("renders nothing when status is undefined", () => {
    const { container } = render(<LifecycleChipView status={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  const cases: Array<{ status: LifecycleStatus; label: string; pulse: boolean }> = [
    { status: "starting", label: "Starting", pulse: false },
    { status: "running", label: "Running", pulse: true },
    { status: "completed", label: "Completed", pulse: false },
    { status: "error", label: "Error", pulse: false },
    { status: "cancelled", label: "Cancelled", pulse: false },
    { status: "shutdown", label: "Cancelled", pulse: false },
  ];

  for (const { status, label, pulse } of cases) {
    it(`renders ${status} as "${label}" (pulse=${pulse})`, () => {
      render(<LifecycleChipView status={status} />);
      const chip = screen.getByTestId("refine-lifecycle-chip");
      expect(chip).toHaveTextContent(label);
      expect(chip).toHaveAttribute("data-status", status as string);
      const dot = chip.querySelector("span[aria-hidden]");
      expect(dot).not.toBeNull();
      if (pulse) {
        expect(dot?.className).toContain("animate-pulse");
      } else {
        expect(dot?.className).not.toContain("animate-pulse");
      }
    });
  }
});

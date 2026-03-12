import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BaseItem } from "@/components/agent-items/base-item";

describe("BaseItem", () => {
  it("uses a horizontally clipped content container to avoid shifting the chat viewport", () => {
    const { container } = render(
      <BaseItem
        icon={<span>i</span>}
        label="Output"
        borderColor="var(--color-pacific)"
        defaultExpanded
      >
        <div>child content</div>
      </BaseItem>,
    );

    expect(screen.getByTestId("base-item")).toBeInTheDocument();
    const clipped = container.querySelector(".overflow-x-hidden");
    expect(clipped).toBeTruthy();
  });
});

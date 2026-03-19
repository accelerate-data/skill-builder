import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BaseItem } from "@/components/agent-items/base-item";

describe("BaseItem lazy mounting", () => {
  it("does not mount children when defaultExpanded is false", () => {
    render(
      <BaseItem icon={<span>i</span>} label="Test" borderColor="red" defaultExpanded={false}>
        <div data-testid="child-content">expensive content</div>
      </BaseItem>,
    );

    expect(screen.queryByTestId("child-content")).not.toBeInTheDocument();
  });

  it("mounts children immediately when defaultExpanded is true", () => {
    render(
      <BaseItem icon={<span>i</span>} label="Test" borderColor="red" defaultExpanded={true}>
        <div data-testid="child-content">expensive content</div>
      </BaseItem>,
    );

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });

  it("mounts children on first expand and keeps them mounted after collapse", async () => {
    const user = userEvent.setup();
    render(
      <BaseItem icon={<span>i</span>} label="Test" borderColor="red" defaultExpanded={false}>
        <div data-testid="child-content">expensive content</div>
      </BaseItem>,
    );

    // Initially not mounted
    expect(screen.queryByTestId("child-content")).not.toBeInTheDocument();

    // Expand
    await user.click(screen.getByRole("button"));
    expect(screen.getByTestId("child-content")).toBeInTheDocument();

    // Collapse — children stay mounted (hidden via CSS)
    await user.click(screen.getByRole("button"));
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });
});

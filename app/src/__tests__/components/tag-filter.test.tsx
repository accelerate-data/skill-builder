import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TagFilter from "@/components/tag-filter";

describe("TagFilter", () => {
  it("renders Tags button", () => {
    render(
      <TagFilter
        availableTags={["alpha", "beta"]}
        selectedTags={[]}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /Tags/i })).toBeInTheDocument();
  });

  it("returns null when no tags available", () => {
    const { container } = render(
      <TagFilter
        availableTags={[]}
        selectedTags={[]}
        onChange={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows available tags in dropdown", async () => {
    const user = userEvent.setup();
    render(
      <TagFilter
        availableTags={["alpha", "beta", "gamma"]}
        selectedTags={[]}
        onChange={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Tags/i }));

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
  });

  it("calls onChange when a tag is toggled on", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TagFilter
        availableTags={["alpha", "beta"]}
        selectedTags={[]}
        onChange={onChange}
      />
    );

    await user.click(screen.getByRole("button", { name: /Tags/i }));
    await user.click(screen.getByText("alpha"));

    expect(onChange).toHaveBeenCalledWith(["alpha"]);
  });

  it("shows count badge when tags are selected", () => {
    render(
      <TagFilter
        availableTags={["alpha", "beta", "gamma"]}
        selectedTags={["alpha", "beta"]}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows Clear all link when tags are selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TagFilter
        availableTags={["alpha", "beta"]}
        selectedTags={["alpha"]}
        onChange={onChange}
      />
    );

    await user.click(screen.getByRole("button", { name: /Tags/i }));

    const clearAll = screen.getByText("Clear all");
    expect(clearAll).toBeInTheDocument();

    await user.click(clearAll);
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

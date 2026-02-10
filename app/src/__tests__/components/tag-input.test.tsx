import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TagInput from "@/components/tag-input";

describe("TagInput", () => {
  it("renders existing tags as badges", () => {
    render(<TagInput tags={["alpha", "beta"]} onChange={vi.fn()} />);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("adds a tag on Enter key", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagInput tags={[]} onChange={onChange} />);

    const input = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(input, "new-tag{Enter}");

    expect(onChange).toHaveBeenCalledWith(["new-tag"]);
  });

  it("adds a tag on comma key", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagInput tags={[]} onChange={onChange} />);

    const input = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(input, "my-tag,");

    expect(onChange).toHaveBeenCalledWith(["my-tag"]);
  });

  it("normalizes tags to lowercase and trims whitespace", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagInput tags={[]} onChange={onChange} />);

    const input = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(input, "  Analytics {Enter}");

    expect(onChange).toHaveBeenCalledWith(["analytics"]);
  });

  it("deduplicates tags", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagInput tags={["existing"]} onChange={onChange} />);

    const input = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(input, "existing{Enter}");

    // onChange should NOT be called because tag already exists
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a tag when X button is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagInput tags={["alpha", "beta"]} onChange={onChange} />);

    const removeButton = screen.getByRole("button", { name: /remove alpha/i });
    await user.click(removeButton);

    expect(onChange).toHaveBeenCalledWith(["beta"]);
  });

  it("removes last tag on Backspace when input is empty", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagInput tags={["alpha", "beta"]} onChange={onChange} />);

    const input = screen.getByRole("textbox", { name: /tag input/i });
    await user.click(input);
    await user.keyboard("{Backspace}");

    expect(onChange).toHaveBeenCalledWith(["alpha"]);
  });

  it("shows suggestions that match input", async () => {
    const user = userEvent.setup();
    render(
      <TagInput
        tags={[]}
        onChange={vi.fn()}
        suggestions={["analytics", "salesforce", "workday"]}
      />
    );

    const input = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(input, "ana");

    expect(screen.getByText("analytics")).toBeInTheDocument();
    // salesforce and workday don't match "ana"
    expect(screen.queryByText("salesforce")).not.toBeInTheDocument();
  });

  it("disables input when disabled prop is true", () => {
    render(<TagInput tags={["alpha"]} onChange={vi.fn()} disabled />);

    const input = screen.getByRole("textbox", { name: /tag input/i });
    expect(input).toBeDisabled();
    // No remove button when disabled
    expect(screen.queryByRole("button", { name: /remove alpha/i })).not.toBeInTheDocument();
  });

  it("ArrowDown highlights first suggestion", async () => {
    const user = userEvent.setup();
    render(
      <TagInput
        tags={[]}
        onChange={vi.fn()}
        suggestions={["analytics", "anomaly"]}
      />
    );

    const input = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(input, "an");

    await user.keyboard("{ArrowDown}");

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
  });

  it("ArrowUp wraps around suggestion list", async () => {
    const user = userEvent.setup();
    render(
      <TagInput
        tags={[]}
        onChange={vi.fn()}
        suggestions={["analytics", "anomaly"]}
      />
    );

    const input = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(input, "an");

    // ArrowUp from -1 wraps to last item
    await user.keyboard("{ArrowUp}");

    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
  });

  it("Enter selects highlighted suggestion", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TagInput
        tags={[]}
        onChange={onChange}
        suggestions={["analytics", "anomaly"]}
      />
    );

    const input = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(input, "an");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith(["analytics"]);
  });

  it("Enter with no highlight adds typed text as tag", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TagInput
        tags={[]}
        onChange={onChange}
        suggestions={["analytics", "anomaly"]}
      />
    );

    const input = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(input, "custom-tag{Enter}");

    expect(onChange).toHaveBeenCalledWith(["custom-tag"]);
  });

  it("Escape dismisses suggestion dropdown", async () => {
    const user = userEvent.setup();
    render(
      <TagInput
        tags={[]}
        onChange={vi.fn()}
        suggestions={["analytics", "anomaly"]}
      />
    );

    const input = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(input, "an");

    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("blur dismisses suggestions with delay", () => {
    vi.useFakeTimers();
    render(
      <TagInput
        tags={[]}
        onChange={vi.fn()}
        suggestions={["analytics", "anomaly"]}
      />
    );

    const input = screen.getByRole("textbox", { name: /tag input/i });

    // Use fireEvent to avoid userEvent timing issues with fake timers
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "an" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.blur(input);
    // Suggestions still visible immediately after blur
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // After 150ms delay, suggestions should be hidden
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("matches suggestions case-insensitively", async () => {
    const user = userEvent.setup();
    render(
      <TagInput
        tags={[]}
        onChange={vi.fn()}
        suggestions={["Analytics", "Salesforce"]}
      />
    );

    const input = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(input, "ANA");

    expect(screen.getByText("Analytics")).toBeInTheDocument();
    expect(screen.queryByText("Salesforce")).not.toBeInTheDocument();
  });

  it("excludes already-added tags from suggestions case-insensitively", async () => {
    const user = userEvent.setup();
    render(
      <TagInput
        tags={["analytics"]}
        onChange={vi.fn()}
        suggestions={["Analytics", "Anomaly"]}
      />
    );

    const input = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(input, "an");

    // "Analytics" should be excluded because "analytics" is already in tags
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Anomaly");
  });
});

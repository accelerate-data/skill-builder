import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SkillPicker } from "@/components/refine/skill-picker";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SkillSummary } from "@/lib/types";

// cmdk uses scrollIntoView which jsdom doesn't implement
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const makeSkill = (name: string, purpose: SkillSummary["purpose"] = null): SkillSummary => ({
  name,
  current_step: "Step 1",
  status: "in_progress",
  last_modified: new Date().toISOString(),
  tags: [],
  purpose,
  author_login: null,
  author_avatar: null,
  intake_json: null,
});

const skills: SkillSummary[] = [
  makeSkill("sales-pipeline", "platform"),
  makeSkill("hr-analytics", "domain"),
  makeSkill("etl-patterns", "data-engineering"),
];

const defaultProps = {
  skills,
  selected: null as SkillSummary | null,
  isLoading: false,
  onSelect: vi.fn(),
};

function renderPicker(
  overrides: Partial<typeof defaultProps & { lockedSkills?: Set<string>; disabled?: boolean }> = {}
) {
  const props = { ...defaultProps, ...overrides };
  // SkillPicker uses Tooltip for locked skills, which requires TooltipProvider context
  return render(
    <TooltipProvider>
      <SkillPicker {...props} />
    </TooltipProvider>
  );
}

describe("SkillPicker", () => {
  // --- Loading state ---

  it("shows a skeleton while loading", () => {
    const { container } = renderPicker({ isLoading: true });
    // shadcn Skeleton renders with animate-pulse
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("does not render the trigger button while loading", () => {
    renderPicker({ isLoading: true });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // --- Basic rendering ---

  it("renders trigger button with placeholder when no skill is selected", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: /Select a skill/i })).toBeInTheDocument();
  });

  it("renders selected skill name in trigger button", () => {
    renderPicker({ selected: skills[0] });
    expect(screen.getByRole("button", { name: /sales-pipeline/i })).toBeInTheDocument();
  });

  it("opens popover and shows all skills when trigger is clicked", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
      expect(screen.getByText("hr-analytics")).toBeInTheDocument();
      expect(screen.getByText("etl-patterns")).toBeInTheDocument();
    });
  });

  it("calls onSelect and closes popover when an unlocked skill is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderPicker({ onSelect });

    await user.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    await user.click(screen.getByText("sales-pipeline"));

    expect(onSelect).toHaveBeenCalledWith(skills[0]);
    // Popover should close after selection
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  it("disables the trigger button when disabled prop is true", () => {
    renderPicker({ disabled: true });
    expect(screen.getByRole("button")).toBeDisabled();
  });

  // --- Locked skill behaviour ---

  it("renders a lock icon next to a locked skill", async () => {
    const user = userEvent.setup();
    renderPicker({ lockedSkills: new Set(["hr-analytics"]) });

    await user.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByText("hr-analytics")).toBeInTheDocument();
    });

    // The Lock icon is rendered as an SVG alongside the locked skill row.
    // The CommandItem for hr-analytics gets opacity-50 + cursor-not-allowed.
    const hrItem = screen.getByText("hr-analytics").closest("[cmdk-item]");
    expect(hrItem).toHaveAttribute("aria-disabled", "true");
  });

  it("does not call onSelect when a locked skill is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderPicker({ onSelect, lockedSkills: new Set(["hr-analytics"]) });

    await user.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByText("hr-analytics")).toBeInTheDocument();
    });

    await user.click(screen.getByText("hr-analytics"));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not disable unlocked skills when some skills are locked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderPicker({ onSelect, lockedSkills: new Set(["hr-analytics"]) });

    await user.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    });

    // sales-pipeline is not locked — clicking it should call onSelect
    await user.click(screen.getByText("sales-pipeline"));
    expect(onSelect).toHaveBeenCalledWith(skills[0]);
  });

  it("wraps a locked skill in a Tooltip with 'Being edited in another window' content", async () => {
    const user = userEvent.setup();
    renderPicker({ lockedSkills: new Set(["etl-patterns"]) });

    await user.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByText("etl-patterns")).toBeInTheDocument();
    });

    // Hover over the locked skill to show the tooltip
    await user.hover(screen.getByText("etl-patterns"));

    // Radix renders the tooltip text inside a role="tooltip" element
    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "Being edited in another window"
      );
    });
  });

  it("shows no skills message when search yields no results", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search skills...")).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText("Search skills..."), "nonexistent-skill-xyz");

    await waitFor(() => {
      expect(screen.getByText("No skills found")).toBeInTheDocument();
    });
  });
});

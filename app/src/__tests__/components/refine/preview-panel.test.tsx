import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRefineStore } from "@/stores/refine-store";
import type { SkillFile } from "@/stores/refine-store";
import { PreviewPanel } from "@/components/refine/preview-panel";

// Mock react-markdown to avoid jsdom issues with ESM/markdown parsing
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown-preview">{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));
vi.mock("rehype-highlight", () => ({ default: () => {} }));

// cmdk uses scrollIntoView which jsdom doesn't implement
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const SKILL_FILES: SkillFile[] = [
  { filename: "SKILL.md", content: "# My Skill\n\nSome content here." },
  { filename: "references/glossary.md", content: "# Glossary\n\nTerms go here." },
];

const BASELINE_FILES: SkillFile[] = [
  { filename: "SKILL.md", content: "# My Skill\n\nOld content." },
  { filename: "references/glossary.md", content: "# Glossary\n\nOld terms." },
];

function setStoreState(overrides: Partial<ReturnType<typeof useRefineStore.getState>>) {
  useRefineStore.setState(overrides);
}

describe("PreviewPanel", () => {
  beforeEach(() => {
    useRefineStore.setState({
      skillFiles: [],
      isLoadingFiles: false,
      activeFileTab: "SKILL.md",
      diffMode: false,
      baselineFiles: [],
    });
  });

  // --- Empty state ---

  it("shows empty state when no skill files are loaded", () => {
    render(<PreviewPanel />);

    expect(screen.getByTestId("refine-preview-empty")).toBeInTheDocument();
    expect(screen.getByText("Select a skill to preview its files")).toBeInTheDocument();
  });

  // --- Loading state ---

  it("shows skeleton loading state when files are loading", () => {
    setStoreState({ isLoadingFiles: true });
    render(<PreviewPanel />);

    expect(screen.queryByTestId("refine-preview-empty")).not.toBeInTheDocument();
  });

  // --- File content rendering ---

  it("renders the active file content as markdown", () => {
    setStoreState({ skillFiles: SKILL_FILES, activeFileTab: "SKILL.md" });
    render(<PreviewPanel />);

    expect(screen.getByTestId("markdown-preview")).toHaveTextContent("# My Skill");
  });

  it("renders the correct file when activeFileTab changes", () => {
    setStoreState({ skillFiles: SKILL_FILES, activeFileTab: "references/glossary.md" });
    render(<PreviewPanel />);

    expect(screen.getByTestId("markdown-preview")).toHaveTextContent("# Glossary");
  });

  // --- File tab switching ---

  it("shows active file name in the file picker button", () => {
    setStoreState({ skillFiles: SKILL_FILES, activeFileTab: "SKILL.md" });
    render(<PreviewPanel />);

    const pickerBtn = screen.getByTestId("refine-file-picker");
    expect(pickerBtn).toHaveTextContent("SKILL.md");
  });

  it("switches file tab when a different file is selected from picker", async () => {
    const user = userEvent.setup();
    setStoreState({ skillFiles: SKILL_FILES, activeFileTab: "SKILL.md" });
    render(<PreviewPanel />);

    await user.click(screen.getByTestId("refine-file-picker"));

    await waitFor(() => {
      expect(screen.getByText("references/glossary.md")).toBeInTheDocument();
    });

    await user.click(screen.getByText("references/glossary.md"));

    expect(useRefineStore.getState().activeFileTab).toBe("references/glossary.md");
  });

  // --- Diff toggle ---

  it("disables diff toggle when no baseline exists", () => {
    setStoreState({ skillFiles: SKILL_FILES, baselineFiles: [] });
    render(<PreviewPanel />);

    const diffBtn = screen.getByTestId("refine-diff-toggle");
    expect(diffBtn).toBeDisabled();
  });

  it("enables diff toggle when baseline exists", () => {
    setStoreState({ skillFiles: SKILL_FILES, baselineFiles: BASELINE_FILES });
    render(<PreviewPanel />);

    const diffBtn = screen.getByTestId("refine-diff-toggle");
    expect(diffBtn).toBeEnabled();
  });

  it("shows 'Diff' label when not in diff mode", () => {
    setStoreState({ skillFiles: SKILL_FILES, baselineFiles: BASELINE_FILES, diffMode: false });
    render(<PreviewPanel />);

    expect(screen.getByTestId("refine-diff-toggle")).toHaveTextContent("Diff");
  });

  it("shows 'Preview' label when in diff mode", () => {
    setStoreState({ skillFiles: SKILL_FILES, baselineFiles: BASELINE_FILES, diffMode: true });
    render(<PreviewPanel />);

    expect(screen.getByTestId("refine-diff-toggle")).toHaveTextContent("Preview");
  });

  it("toggles diff mode when button is clicked", async () => {
    const user = userEvent.setup();
    setStoreState({ skillFiles: SKILL_FILES, baselineFiles: BASELINE_FILES, diffMode: false });
    render(<PreviewPanel />);

    await user.click(screen.getByTestId("refine-diff-toggle"));

    expect(useRefineStore.getState().diffMode).toBe(true);
  });

  it("renders DiffView instead of markdown when diff mode is on", () => {
    setStoreState({
      skillFiles: SKILL_FILES,
      baselineFiles: BASELINE_FILES,
      diffMode: true,
      activeFileTab: "SKILL.md",
    });
    const { container } = render(<PreviewPanel />);

    // DiffView renders a <pre>; markdown preview should NOT be shown
    expect(screen.queryByTestId("markdown-preview")).not.toBeInTheDocument();
    // DiffView should render diff rows inside a <pre>
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    // Should contain removed "Old content." from baseline
    const rows = Array.from(pre!.querySelectorAll<HTMLDivElement>(":scope > div"));
    const hasRemoved = rows.some((r) => r.className.includes("bg-red"));
    const hasAdded = rows.some((r) => r.className.includes("bg-green"));
    expect(hasRemoved).toBe(true);
    expect(hasAdded).toBe(true);
  });
});

import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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

const SKILL_FILES_WITH_CONTEXT: SkillFile[] = [
  ...SKILL_FILES,
  { filename: "context/agent-validation-log.md", content: "# Validation\n\nAll good." },
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
      gitDiff: null,
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

  it("reloads the file picker list when new files are added after render", async () => {
    const user = userEvent.setup();
    setStoreState({ skillFiles: SKILL_FILES, activeFileTab: "SKILL.md" });
    render(<PreviewPanel />);

    await act(async () => {
      useRefineStore.getState().updateSkillFiles([
        ...SKILL_FILES,
        { filename: "references/new-guide.md", content: "# New guide" },
      ]);
    });

    await user.click(screen.getByTestId("refine-file-picker"));

    await waitFor(() => {
      expect(screen.getAllByText("references/new-guide.md").length).toBeGreaterThan(0);
    });
  });

  it("does not show context artifacts in the file picker", async () => {
    const user = userEvent.setup();
    setStoreState({ skillFiles: SKILL_FILES_WITH_CONTEXT, activeFileTab: "SKILL.md" });
    render(<PreviewPanel />);

    await user.click(screen.getByTestId("refine-file-picker"));

    await waitFor(() => {
      expect(screen.getByText("references/glossary.md")).toBeInTheDocument();
    });

    expect(screen.queryByText("context/agent-validation-log.md")).not.toBeInTheDocument();
  });

  // --- Diff toggle ---

  it("disables diff toggle when no git diff exists", () => {
    setStoreState({ skillFiles: SKILL_FILES, gitDiff: null });
    render(<PreviewPanel />);

    const diffBtn = screen.getByTestId("refine-diff-toggle");
    expect(diffBtn).toBeDisabled();
  });

  it("enables diff toggle when git diff exists", () => {
    setStoreState({
      skillFiles: SKILL_FILES,
      gitDiff: {
        stat: "1 file changed",
        files: [{ path: "my-skill/SKILL.md", status: "modified", diff: "@@ -1 +1 @@\n-old\n+new\n" }],
      },
    });
    render(<PreviewPanel />);

    expect(screen.getByTestId("refine-diff-toggle")).toBeEnabled();
  });

  it("shows 'Diff' label when not in diff mode", () => {
    setStoreState({
      skillFiles: SKILL_FILES,
      diffMode: false,
      gitDiff: {
        stat: "1 file changed",
        files: [{ path: "my-skill/SKILL.md", status: "modified", diff: "@@ -1 +1 @@\n-old\n+new\n" }],
      },
    });
    render(<PreviewPanel />);

    expect(screen.getByTestId("refine-diff-toggle")).toHaveTextContent("Diff");
  });

  it("shows 'Preview' label when in diff mode", () => {
    setStoreState({
      skillFiles: SKILL_FILES,
      diffMode: true,
      gitDiff: {
        stat: "1 file changed",
        files: [{ path: "my-skill/SKILL.md", status: "modified", diff: "@@ -1 +1 @@\n-old\n+new\n" }],
      },
    });
    render(<PreviewPanel />);

    expect(screen.getByTestId("refine-diff-toggle")).toHaveTextContent("Preview");
  });

  it("toggles diff mode when button is clicked", async () => {
    const user = userEvent.setup();
    setStoreState({
      skillFiles: SKILL_FILES,
      diffMode: false,
      gitDiff: {
        stat: "1 file changed",
        files: [{ path: "my-skill/SKILL.md", status: "modified", diff: "@@ -1 +1 @@\n-old\n+new\n" }],
      },
    });
    render(<PreviewPanel />);

    await user.click(screen.getByTestId("refine-diff-toggle"));

    expect(useRefineStore.getState().diffMode).toBe(true);
  });

  it("shows an empty state when diff mode is on and the active file has no git patch", () => {
    setStoreState({
      skillFiles: SKILL_FILES,
      diffMode: true,
      activeFileTab: "SKILL.md",
      gitDiff: {
        stat: "1 file changed",
        files: [{ path: "my-skill/references/glossary.md", status: "modified", diff: "@@ -1 +1 @@\n-old\n+new\n" }],
      },
    });
    render(<PreviewPanel />);

    expect(screen.getByTestId("git-patch-empty")).toHaveTextContent("No git diff is available for this file.");
    expect(screen.queryByTestId("markdown-preview")).not.toBeInTheDocument();
  });

  it("renders styled git patch lines when git-backed diff exists for the active file", () => {
    setStoreState({
      skillFiles: SKILL_FILES,
      diffMode: true,
      activeFileTab: "SKILL.md",
      gitDiff: {
        stat: "1 file changed",
        files: [{
          path: "my-skill/SKILL.md",
          status: "modified",
          diff: "diff --git a/SKILL.md b/SKILL.md\n--- a/SKILL.md\n+++ b/SKILL.md\n@@ -1 +1 @@\n-old\n+new\n unchanged\n",
        }],
      },
    });

    render(<PreviewPanel />);

    expect(screen.getByTestId("git-patch-view")).toHaveTextContent("diff --git a/SKILL.md b/SKILL.md");
    expect(screen.getAllByTestId("git-patch-line-meta").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("git-patch-line-hunk").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("git-patch-line-added").some((node) => node.textContent?.includes("+new"))).toBe(true);
    expect(screen.getAllByTestId("git-patch-line-removed").some((node) => node.textContent?.includes("-old"))).toBe(true);
    expect(screen.getAllByTestId("git-patch-line-context").some((node) => node.textContent?.includes("unchanged"))).toBe(true);
    expect(screen.queryByTestId("markdown-preview")).not.toBeInTheDocument();
  });

  it("shows deleted authored files in the picker when they only exist in the git diff", async () => {
    const user = userEvent.setup();
    setStoreState({
      skillFiles: SKILL_FILES,
      activeFileTab: "SKILL.md",
      gitDiff: {
        stat: "2 files changed",
        files: [
          { path: "my-skill/SKILL.md", status: "modified", diff: "@@ -1 +1 @@\n-old\n+new\n" },
          { path: "my-skill/references/deleted.md", status: "deleted", diff: "diff --git a/references/deleted.md b/references/deleted.md\n--- a/references/deleted.md\n+++ /dev/null\n@@ -1 +0,0 @@\n-removed\n" },
        ],
      },
    });
    render(<PreviewPanel />);

    await user.click(screen.getByTestId("refine-file-picker"));

    await waitFor(() => {
      expect(screen.getByText("references/deleted.md")).toBeInTheDocument();
    });
  });
});

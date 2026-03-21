import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRefineStore } from "@/stores/refine-store";
import type { SkillFile } from "@/stores/refine-store";
import { PreviewPanel } from "@/components/refine/preview-panel";

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown-preview">{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));
vi.mock("rehype-highlight", () => ({ default: () => {} }));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const SKILL_FILES: SkillFile[] = [
  { filename: "SKILL.md", content: "# My Skill\n\nSome content here." },
  { filename: "references/glossary.md", content: "# Glossary\n\nTerms go here." },
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
      selectedModifiedFile: null,
      diffMode: false,
      gitDiff: null,
    });
  });

  it("shows a prompt when no modified file is selected", () => {
    render(<PreviewPanel />);

    expect(screen.getByTestId("refine-file-view-empty")).toBeInTheDocument();
    expect(screen.getByText("Select a modified file to view it here")).toBeInTheDocument();
  });

  it("shows loading state while files are loading", () => {
    setStoreState({ isLoadingFiles: true });

    render(<PreviewPanel />);

    expect(screen.queryByTestId("refine-file-view-empty")).not.toBeInTheDocument();
  });

  it("renders the selected file content as markdown", () => {
    setStoreState({
      skillFiles: SKILL_FILES,
      activeFileTab: "SKILL.md",
      selectedModifiedFile: "SKILL.md",
    });

    render(<PreviewPanel />);

    expect(screen.getByTestId("refine-file-view-title")).toHaveTextContent("SKILL.md");
    expect(screen.getByTestId("markdown-preview")).toHaveTextContent("# My Skill");
  });

  it("returns to chat mode when the back button is clicked", async () => {
    const user = userEvent.setup();
    setStoreState({
      skillFiles: SKILL_FILES,
      activeFileTab: "SKILL.md",
      selectedModifiedFile: "SKILL.md",
    });

    render(<PreviewPanel />);

    await user.click(screen.getByTestId("refine-file-view-back"));

    expect(useRefineStore.getState().selectedModifiedFile).toBeNull();
  });

  it("disables the diff toggle when the selected file has no diff", () => {
    setStoreState({
      skillFiles: SKILL_FILES,
      activeFileTab: "SKILL.md",
      selectedModifiedFile: "SKILL.md",
      gitDiff: {
        stat: "1 file changed",
        files: [{ path: "my-skill/references/glossary.md", status: "modified", diff: "@@ -1 +1 @@\n-old\n+new\n" }],
      },
    });

    render(<PreviewPanel />);

    expect(screen.getByTestId("refine-diff-toggle")).toBeDisabled();
  });

  it("toggles diff mode for the selected file when a diff exists", async () => {
    const user = userEvent.setup();
    setStoreState({
      skillFiles: SKILL_FILES,
      activeFileTab: "SKILL.md",
      selectedModifiedFile: "SKILL.md",
      gitDiff: {
        stat: "1 file changed",
        files: [{ path: "my-skill/SKILL.md", status: "modified", diff: "@@ -1 +1 @@\n-old\n+new\n" }],
      },
    });

    render(<PreviewPanel />);

    await user.click(screen.getByTestId("refine-diff-toggle"));

    expect(useRefineStore.getState().diffMode).toBe(true);
    expect(screen.getByTestId("refine-diff-toggle")).toHaveTextContent("Preview");
  });

  it("shows a patch-empty state when diff mode is enabled for a file without a patch", () => {
    setStoreState({
      skillFiles: SKILL_FILES,
      activeFileTab: "SKILL.md",
      selectedModifiedFile: "SKILL.md",
      diffMode: true,
      gitDiff: {
        stat: "1 file changed",
        files: [{ path: "my-skill/references/glossary.md", status: "modified", diff: "@@ -1 +1 @@\n-old\n+new\n" }],
      },
    });

    render(<PreviewPanel />);

    expect(screen.getByTestId("git-patch-empty")).toHaveTextContent("No git diff is available for this file.");
  });

  it("renders a git patch when diff mode is enabled for the selected file", () => {
    setStoreState({
      skillFiles: SKILL_FILES,
      activeFileTab: "SKILL.md",
      selectedModifiedFile: "SKILL.md",
      diffMode: true,
      gitDiff: {
        stat: "1 file changed",
        files: [{
          path: "my-skill/SKILL.md",
          status: "modified",
          diff: "diff --git a/SKILL.md b/SKILL.md\n--- a/SKILL.md\n+++ b/SKILL.md\n@@ -1 +1 @@\n-old\n+new\n",
        }],
      },
    });

    render(<PreviewPanel />);

    expect(screen.getByTestId("git-patch-view")).toHaveTextContent("diff --git a/SKILL.md b/SKILL.md");
  });

  it("shows a missing-file state for diff-only files in preview mode", () => {
    setStoreState({
      skillFiles: SKILL_FILES,
      activeFileTab: "references/deleted.md",
      selectedModifiedFile: "references/deleted.md",
      gitDiff: {
        stat: "1 file changed",
        files: [{
          path: "my-skill/references/deleted.md",
          status: "deleted",
          diff: "diff --git a/references/deleted.md b/references/deleted.md\n--- a/references/deleted.md\n+++ /dev/null\n@@ -1 +0,0 @@\n-removed\n",
        }],
      },
    });

    render(<PreviewPanel />);

    expect(screen.getByTestId("refine-preview-missing-file")).toHaveTextContent("This file is only available in the git diff.");
  });
});

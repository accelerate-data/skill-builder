import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GitPatchView } from "@/components/refine/git-patch-view";

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="scroll-area" className={className}>
      {children}
    </div>
  ),
}));

describe("GitPatchView", () => {
  it("classifies patch lines by type and preserves line numbers", () => {
    const patch = [
      "diff --git a/file.txt b/file.txt",
      "index 1111111..2222222 100644",
      "--- a/file.txt",
      "+++ b/file.txt",
      "@@ -1,2 +1,3 @@",
      "-old line",
      "+new line",
      " unchanged line",
      "",
    ].join("\n");

    render(<GitPatchView patch={patch} />);

    expect(screen.getByTestId("git-patch-view")).toBeInTheDocument();
    expect(screen.getAllByTestId("git-patch-line-meta")).toHaveLength(4);
    expect(screen.getAllByTestId("git-patch-line-hunk")).toHaveLength(1);
    expect(screen.getAllByTestId("git-patch-line-removed")).toHaveLength(1);
    expect(screen.getAllByTestId("git-patch-line-added")).toHaveLength(1);
    expect(screen.getAllByTestId("git-patch-line-context")).toHaveLength(2);

    const metaLines = screen.getAllByTestId("git-patch-line-meta");
    expect(metaLines[0].querySelector("span")?.textContent).toBe("  1");
    expect(metaLines[3].querySelector("span")?.textContent).toBe("  4");

    const contextLines = screen.getAllByTestId("git-patch-line-context");
    expect(contextLines[0]).toHaveTextContent(" unchanged line");
    expect(contextLines[1]).toHaveTextContent("9");
  });

  it("treats file header lines as meta rather than added or removed content", () => {
    render(
      <GitPatchView
        patch={[
          "--- a/old.txt",
          "+++ b/new.txt",
          "-removed content",
          "+added content",
        ].join("\n")}
      />,
    );

    expect(screen.getAllByTestId("git-patch-line-meta")).toHaveLength(2);
    expect(screen.getAllByTestId("git-patch-line-removed")).toHaveLength(1);
    expect(screen.getAllByTestId("git-patch-line-added")).toHaveLength(1);
  });
});

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DiffView } from "@/components/refine/diff-view";

/** Helper: get all diff row elements from the rendered <pre>. */
function getDiffRows(container: HTMLElement) {
  const pre = container.querySelector("pre")!;
  return Array.from(pre.querySelectorAll<HTMLDivElement>(":scope > div"));
}

describe("DiffView", () => {
  it("renders unchanged lines with correct styling and prefix", () => {
    const { container } = render(<DiffView before="hello" after="hello" />);
    const rows = getDiffRows(container);

    expect(rows).toHaveLength(1);
    expect(rows[0].className).toContain("text-muted-foreground");
    expect(rows[0].textContent).toContain("  hello");
  });

  it("renders added lines with green styling and + prefix", () => {
    const { container } = render(<DiffView before="" after="new line" />);
    const rows = getDiffRows(container);

    expect(rows).toHaveLength(1);
    expect(rows[0].className).toMatch(/bg-green/);
    expect(rows[0].textContent).toContain("+ new line");
  });

  it("renders removed lines with red styling and - prefix", () => {
    const { container } = render(<DiffView before="old line" after="" />);
    const rows = getDiffRows(container);

    expect(rows).toHaveLength(1);
    expect(rows[0].className).toMatch(/bg-red/);
    expect(rows[0].textContent).toContain("- old line");
  });

  it("renders a mixed diff with added, removed, and unchanged lines", () => {
    const before = "line one\nline two\nline three";
    const after = "line one\nline TWO\nline three";

    const { container } = render(<DiffView before={before} after={after} />);
    const rows = getDiffRows(container);

    // unchanged "line one" + removed "line two" + added "line TWO" + unchanged "line three"
    expect(rows.length).toBeGreaterThanOrEqual(4);

    const classNames = rows.map((r) => r.className);
    expect(classNames.some((c) => c.includes("bg-red"))).toBe(true);
    expect(classNames.some((c) => c.includes("bg-green"))).toBe(true);
    expect(classNames.some((c) => c.includes("text-muted-foreground"))).toBe(true);
  });

  it("shows line numbers starting at 1", () => {
    // Use a diff that produces multiple rows (added lines guarantee separate rows)
    const { container } = render(<DiffView before="" after={"alpha\nbeta"} />);
    const rows = getDiffRows(container);

    expect(rows).toHaveLength(2);
    // First child span of each row is the line number gutter
    const lineNum1 = rows[0].children[0] as HTMLSpanElement;
    const lineNum2 = rows[1].children[0] as HTMLSpanElement;
    expect(lineNum1.textContent?.trim()).toBe("1");
    expect(lineNum2.textContent?.trim()).toBe("2");
  });
});

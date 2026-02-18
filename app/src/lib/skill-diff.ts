import { diffLines, type Change } from "diff";

export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  content: string;
}

function changeToDiffType(change: Change): DiffLine["type"] {
  if (change.added) return "added";
  if (change.removed) return "removed";
  return "unchanged";
}

export function computeLineDiff(before: string, after: string): DiffLine[] {
  const changes: Change[] = diffLines(before, after);
  const result: DiffLine[] = [];

  for (const change of changes) {
    const lines = change.value.split("\n");
    // diffLines includes trailing empty string for final newline
    const trimmed = lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
    const type = changeToDiffType(change);

    for (const line of trimmed) {
      result.push({ type, content: line });
    }
  }

  return result;
}

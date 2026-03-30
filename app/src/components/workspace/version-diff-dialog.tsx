import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getSkillFilesAtSha } from "@/lib/tauri";
import type { SkillFileContent } from "@/lib/types";

interface VersionDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillName: string;
  workspacePath: string;
  shaA: string;
  shaB: string;
  labelA: string;
  labelB: string;
}

interface DiffLine {
  type: "added" | "removed" | "unchanged";
  content: string;
}

function computeLineDiff(aLines: string[], bLines: string[]): DiffLine[] {
  const m = aLines.length;
  const n = bLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && aLines[i] === bLines[j]) {
      result.push({ type: "unchanged", content: aLines[i] });
      i++;
      j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ type: "added", content: bLines[j] });
      j++;
    } else {
      result.push({ type: "removed", content: aLines[i] });
      i++;
    }
  }
  return result;
}

function FileDiff({ linesA, linesB }: { linesA: string[] | null; linesB: string[] | null }) {
  if (!linesA && !linesB) return null;

  if (!linesA) {
    return (
      <div className="font-mono text-xs leading-5">
        {(linesB ?? []).map((line, idx) => (
          <div
            key={idx}
            className="px-3 whitespace-pre-wrap break-all"
            style={{
              color: "var(--color-seafoam)",
              background: "color-mix(in oklch, var(--color-seafoam), transparent 85%)",
            }}
          >
            {`+ ${line}`}
          </div>
        ))}
      </div>
    );
  }

  if (!linesB) {
    return (
      <div className="font-mono text-xs leading-5">
        {(linesA ?? []).map((line, idx) => (
          <div
            key={idx}
            className="px-3 text-destructive whitespace-pre-wrap break-all"
            style={{ background: "color-mix(in oklch, hsl(var(--destructive)), transparent 88%)" }}
          >
            {`- ${line}`}
          </div>
        ))}
      </div>
    );
  }

  const diff = computeLineDiff(linesA, linesB);

  if (diff.every((l) => l.type === "unchanged")) {
    return (
      <p className="text-xs text-muted-foreground px-3 py-4">No differences between these versions.</p>
    );
  }

  return (
    <div className="font-mono text-xs leading-5">
      {diff.map((line, idx) => {
        if (line.type === "unchanged") {
          return (
            <div key={idx} className="px-3 text-muted-foreground whitespace-pre-wrap break-all">
              {`  ${line.content}`}
            </div>
          );
        }
        if (line.type === "added") {
          return (
            <div
              key={idx}
              className="px-3 whitespace-pre-wrap break-all"
              style={{
                color: "var(--color-seafoam)",
                background: "color-mix(in oklch, var(--color-seafoam), transparent 85%)",
              }}
            >
              {`+ ${line.content}`}
            </div>
          );
        }
        return (
          <div
            key={idx}
            className="px-3 text-destructive whitespace-pre-wrap break-all"
            style={{ background: "color-mix(in oklch, hsl(var(--destructive)), transparent 88%)" }}
          >
            {`- ${line.content}`}
          </div>
        );
      })}
    </div>
  );
}

export function VersionDiffDialog({
  open,
  onOpenChange,
  skillName,
  workspacePath,
  shaA,
  shaB,
  labelA,
  labelB,
}: VersionDiffDialogProps) {
  const [filesA, setFilesA] = useState<SkillFileContent[] | null>(null);
  const [filesB, setFilesB] = useState<SkillFileContent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSelectedPath(null);
    Promise.all([
      getSkillFilesAtSha(workspacePath, skillName, shaA),
      getSkillFilesAtSha(workspacePath, skillName, shaB),
    ])
      .then(([a, b]) => {
        setFilesA(a);
        setFilesB(b);
      })
      .catch((err) => {
        console.error("event=diff_fetch_failed skill=%s error=%s", skillName, err);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [open, workspacePath, skillName, shaA, shaB]);

  const allPaths = Array.from(
    new Set([...(filesA ?? []).map((f) => f.path), ...(filesB ?? []).map((f) => f.path)]),
  ).sort((a, b) => {
    if (a === "SKILL.md") return -1;
    if (b === "SKILL.md") return 1;
    return a.localeCompare(b);
  });

  const activePath = selectedPath ?? allPaths[0] ?? null;

  const fileA = activePath ? (filesA?.find((f) => f.path === activePath) ?? null) : null;
  const fileB = activePath ? (filesB?.find((f) => f.path === activePath) ?? null) : null;
  const linesA = fileA ? fileA.content.split("\n") : null;
  const linesB = fileB ? fileB.content.split("\n") : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] w-[900px] h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-5 pb-0 shrink-0">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              Compare
              <span
                className="rounded-full text-xs font-medium px-2 py-0.5"
                style={{
                  color: "var(--color-seafoam)",
                  background: "color-mix(in oklch, var(--color-seafoam), transparent 85%)",
                }}
              >
                {labelA}
              </span>
              <span className="text-muted-foreground">→</span>
              <span
                className="rounded-full text-xs font-medium px-2 py-0.5"
                style={{
                  color: "var(--color-pacific)",
                  background: "color-mix(in oklch, var(--color-pacific), transparent 85%)",
                }}
              >
                {labelB}
              </span>
            </DialogTitle>

            {allPaths.length > 0 && (
              <Select
                value={activePath ?? undefined}
                onValueChange={setSelectedPath}
              >
                <SelectTrigger className="w-56 h-7 text-xs shrink-0">
                  <SelectValue placeholder="Select file" />
                </SelectTrigger>
                <SelectContent>
                  {allPaths.map((path) => (
                    <SelectItem key={path} value={path} className="text-xs font-mono">
                      {path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden mt-4">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Loading diff…
            </div>
          ) : error ? (
            <div className="px-6 py-4 text-sm text-destructive">{error}</div>
          ) : allPaths.length === 0 ? (
            <div className="px-6 py-4 text-sm text-muted-foreground">No files found</div>
          ) : (
            <ScrollArea className="h-full">
              <div className="pb-6">
                <FileDiff linesA={linesA} linesB={linesB} />
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  // Myers diff via DP LCS
  const m = aLines.length;
  const n = bLines.length;

  // Build LCS length table
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
            className="px-2"
            style={{ background: "color-mix(in oklch, var(--color-seafoam), transparent 85%)", color: "var(--color-seafoam)" }}
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
            className="px-2 text-destructive"
            style={{ background: "var(--destructive-foreground, hsl(var(--destructive) / 0.1))" }}
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
      <p className="text-xs text-muted-foreground px-2 py-4">No differences</p>
    );
  }

  return (
    <div className="font-mono text-xs leading-5">
      {diff.map((line, idx) => {
        if (line.type === "unchanged") {
          return (
            <div key={idx} className="px-2 text-muted-foreground">
              {`  ${line.content}`}
            </div>
          );
        }
        if (line.type === "added") {
          return (
            <div
              key={idx}
              className="px-2"
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
            className="px-2 text-destructive"
            style={{ background: "color-mix(in oklch, hsl(var(--destructive)), transparent 85%)" }}
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

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
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

  // Collect all unique file paths across both versions
  const allPaths = Array.from(
    new Set([...(filesA ?? []).map((f) => f.path), ...(filesB ?? []).map((f) => f.path)]),
  ).sort((a, b) => {
    if (a === "SKILL.md") return -1;
    if (b === "SKILL.md") return 1;
    return a.localeCompare(b);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle>
            Compare{" "}
            <span
              className="rounded-full text-xs font-medium px-2 py-0.5"
              style={{
                color: "var(--color-seafoam)",
                background: "color-mix(in oklch, var(--color-seafoam), transparent 85%)",
              }}
            >
              {labelA}
            </span>{" "}
            →{" "}
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
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              Loading diff…
            </div>
          ) : error ? (
            <div className="px-6 py-4 text-sm text-destructive">{error}</div>
          ) : allPaths.length === 0 ? (
            <div className="px-6 py-4 text-sm text-muted-foreground">No files found</div>
          ) : (
            <Tabs defaultValue={allPaths[0]} className="flex flex-col h-full">
              <TabsList variant="line" className="shrink-0 border-b px-4">
                {allPaths.map((path) => (
                  <TabsTrigger key={path} value={path} className="text-xs max-w-[160px] truncate">
                    {path.replace("references/", "")}
                  </TabsTrigger>
                ))}
              </TabsList>
              {allPaths.map((path) => {
                const fileA = filesA?.find((f) => f.path === path);
                const fileB = filesB?.find((f) => f.path === path);
                const linesA = fileA ? fileA.content.split("\n") : null;
                const linesB = fileB ? fileB.content.split("\n") : null;
                return (
                  <TabsContent key={path} value={path} className="flex-1 min-h-0 mt-0">
                    <ScrollArea className="h-full">
                      <div className="py-2">
                        <FileDiff linesA={linesA} linesB={linesB} />
                      </div>
                    </ScrollArea>
                  </TabsContent>
                );
              })}
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

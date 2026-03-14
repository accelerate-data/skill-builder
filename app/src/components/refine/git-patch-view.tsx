import { ScrollArea } from "@/components/ui/scroll-area";

type PatchLineType = "meta" | "hunk" | "added" | "removed" | "context";

const PATCH_LINE_STYLES: Record<PatchLineType, string> = {
  meta: "bg-muted/40 text-muted-foreground",
  hunk: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  added: "bg-[color-mix(in_oklch,var(--color-seafoam),transparent_88%)] text-[var(--color-seafoam)]",
  removed: "bg-destructive/10 text-destructive",
  context: "",
};

function getPatchLineType(line: string): PatchLineType {
  if (line.startsWith("@@")) return "hunk";
  if (
    line.startsWith("diff --git")
    || line.startsWith("index ")
    || line.startsWith("--- ")
    || line.startsWith("+++ ")
  ) {
    return "meta";
  }
  if (line.startsWith("+") && !line.startsWith("+++")) return "added";
  if (line.startsWith("-") && !line.startsWith("---")) return "removed";
  return "context";
}

interface GitPatchViewProps {
  patch: string;
}

export function GitPatchView({ patch }: GitPatchViewProps) {
  const lines = patch.split(/\r?\n/);

  return (
    <ScrollArea className="h-full">
      <pre data-testid="git-patch-view" className="font-mono text-sm">
        {lines.map((line, index) => {
          const type = getPatchLineType(line);
          const lineNumber = String(index + 1).padStart(3, " ");
          return (
            <div
              key={`${index}:${line}`}
              data-testid={`git-patch-line-${type}`}
              className={`flex whitespace-pre-wrap break-all ${PATCH_LINE_STYLES[type]}`}
            >
              <span className="w-12 shrink-0 select-none border-r border-border/60 pr-3 text-right text-muted-foreground/60">
                {lineNumber}
              </span>
              <span className="min-w-0 flex-1 px-3 py-0.5">{line || " "}</span>
            </div>
          );
        })}
      </pre>
    </ScrollArea>
  );
}

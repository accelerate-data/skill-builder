import { Loader2 } from "lucide-react";

export function WorkspaceLoadingSkeleton() {
  return (
    <div
      data-testid="workspace-loading-skeleton"
      className="flex h-full flex-col animate-in fade-in duration-150"
    >
      <div className="flex items-center gap-1 border-b px-3 py-1 opacity-40 select-none">
        {["Overview", "Refine", "Evals"].map((label) => (
          <div
            key={label}
            className="rounded px-3 py-1.5 text-sm text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" style={{ color: "var(--color-pacific)" }} />
        Loading session…
      </div>
    </div>
  );
}

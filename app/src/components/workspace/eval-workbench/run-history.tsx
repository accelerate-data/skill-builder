import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { EvalRun } from "@/lib/eval-workbench";
import { summarizeRun } from "@/lib/eval-workbench";

interface RunHistoryProps {
  runs: EvalRun[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
}

export function RunHistory({
  runs,
  selectedRunId,
  onSelectRun,
}: RunHistoryProps) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">Run history</h2>
        <p className="text-xs text-muted-foreground">
          Review the latest app-owned workbench runs.
        </p>
      </div>

      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runs yet.</p>
      ) : (
        <div className="space-y-2">
          {runs.map((run, index) => {
            const summary = summarizeRun(run);
            return (
              <div
                key={run.id}
                className="flex items-center justify-between gap-3 rounded-md border bg-background/70 p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{run.id}</p>
                    <Badge variant="outline">{run.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {summary.passed}/{summary.total} passed
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={selectedRunId === run.id ? "secondary" : "outline"}
                  onClick={() => onSelectRun(run.id)}
                >
                  {index === 0 ? "View latest run" : "View run"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

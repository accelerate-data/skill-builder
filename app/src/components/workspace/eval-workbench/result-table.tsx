import type { EvalRun, EvalWorkbenchMode } from "@/lib/eval-workbench";

interface ResultTableProps {
  mode: EvalWorkbenchMode;
  run: EvalRun | null;
  candidateLabelById?: Record<string, string>;
}

export function ResultTable({
  mode,
  run,
  candidateLabelById,
}: ResultTableProps) {
  if (!run) {
    return (
      <p className="text-sm text-muted-foreground">
        Select a run to inspect its case results.
      </p>
    );
  }

  if (run.results.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This run has no recorded case results yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Case</th>
            <th className="py-2 pr-4 font-medium">
              {mode === "performance" ? "Target" : "Candidate"}
            </th>
            <th className="py-2 pr-4 font-medium">Score</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {run.results.map((result) => (
            <tr key={result.id} className="border-b last:border-b-0">
              <td className="py-2 pr-4 font-mono text-xs">{result.caseId}</td>
              <td className="py-2 pr-4 font-mono text-xs">
                {candidateLabelById?.[result.candidateId] ?? result.candidateId}
              </td>
              <td className="py-2 pr-4 font-mono text-xs">
                {result.score.toFixed(2)}
              </td>
              <td className="py-2 pr-4 text-xs">
                {result.passed ? "passed" : "failed"}
              </td>
              <td className="py-2 text-xs text-muted-foreground">
                {result.reason ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

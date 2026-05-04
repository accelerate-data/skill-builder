import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CURRENT_SKILL_CANDIDATE_ID,
  type DescriptionCandidate,
  type TriggerComparisonEntry,
} from "@/lib/eval-workbench";

interface CandidateCardsProps {
  entries: TriggerComparisonEntry[];
  recommendedCandidateId?: string | null;
  onApply: (candidate: DescriptionCandidate) => void;
}

export function CandidateCards({
  entries,
  recommendedCandidateId,
  onApply,
}: CandidateCardsProps) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No generated candidates yet.
      </p>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {entries.map(({ candidate, isBaseline, metrics }) => {
        const isRecommended = candidate.id === recommendedCandidateId;
        return (
          <div
            key={candidate.id}
            className="rounded-lg border bg-card p-4"
            data-testid={`candidate-card-${candidate.id}`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{candidate.label}</h3>
                {isBaseline ? <Badge variant="outline">Baseline</Badge> : null}
                {isRecommended ? <Badge>Recommended</Badge> : null}
              </div>
              {candidate.rank && !isBaseline ? (
                <span className="text-xs text-muted-foreground">
                  Rank {candidate.rank}
                </span>
              ) : null}
            </div>
            <p className="text-sm">{candidate.description}</p>
            {candidate.rationale ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {candidate.rationale}
              </p>
            ) : null}
            {metrics ? (
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                <p data-testid={`candidate-pass-summary-${candidate.id}`}>
                  {metrics.passed}/{metrics.total} passed
                </p>
                {metrics.triggerRecall !== null ? (
                  <p>Trigger recall {Math.round(metrics.triggerRecall * 100)}%</p>
                ) : null}
                {metrics.falseTriggerRate !== null ? (
                  <p>
                    False triggers {Math.round(metrics.falseTriggerRate * 100)}%
                  </p>
                ) : null}
              </div>
            ) : null}
            {candidate.id !== CURRENT_SKILL_CANDIDATE_ID ? (
              <Button
                className="mt-4"
                size="sm"
                variant={isRecommended ? "default" : "outline"}
                onClick={() => onApply(candidate)}
              >
                Apply {candidate.label}
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

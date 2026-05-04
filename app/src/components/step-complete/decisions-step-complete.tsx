import { Loader2, AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DecisionsSummaryCard } from "@/components/decisions-summary-card";
import { AgentStatsBar } from "@/components/agent-stats-bar";
import { useDecisions } from "@/lib/queries/decisions";
import { StepActionBar } from "./step-action-bar";
import type { StepCompleteBaseProps } from "./step-complete-types";
import type { DecisionsDto, DecisionsOutput, DecisionStatus } from "@/generated/contracts";

function decisionsDtoToString(dto: DecisionsDto): string {
  const output: DecisionsOutput = {
    version: dto.version,
    metadata: {
      decision_count: dto.decision_count,
      conflicts_resolved: dto.conflicts_resolved,
      round: dto.round,
    },
    decisions: dto.items.map((item) => ({
      id: item.decision_id,
      title: item.title,
      original_question: item.original_question,
      decision: item.decision,
      implication: item.implication,
      status: item.status as DecisionStatus,
    })),
  };
  return JSON.stringify(output);
}

type Props = StepCompleteBaseProps & {
  skillName?: string;
  workspacePath?: string;
};

export function DecisionsStepComplete(props: Props) {
  const {
    stepName, skillName, agentRuns, reviewMode, duration,
    isLastStep, nextStepBlocked, nextStepLabel, onNextStep, onClose, onEval, onResetStep,
  } = props;

  const { data: decisionsDto, isLoading, isError } = useDecisions(skillName ?? null);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !decisionsDto) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
        <AlertTriangle className="size-8 text-destructive/50" />
        <div className="text-center">
          <p className="font-medium text-destructive">{stepName} step completed but decisions not found in database</p>
          <p className="mt-1 text-sm">The decisions output could not be loaded.</p>
        </div>
        {onResetStep && (
          <Button size="sm" variant="outline" onClick={onResetStep}>
            <RotateCcw className="size-3.5" />
            Re-run Step
          </Button>
        )}
      </div>
    );
  }

  const decisionsContent = decisionsDtoToString(decisionsDto);

  const dbDuration = agentRuns.length > 0
    ? agentRuns.reduce((sum, r) => sum + r.duration_ms, 0)
    : undefined;

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      {reviewMode && agentRuns.length > 0 && (
        <div className="shrink-0"><AgentStatsBar runs={agentRuns} /></div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pr-4">
        <DecisionsSummaryCard
          decisionsContent={decisionsContent}
          duration={reviewMode ? dbDuration : duration}
          allowEdit={false}
          onDecisionsChange={() => {}}
        />
      </div>
      <StepActionBar isLastStep={isLastStep} nextStepBlocked={nextStepBlocked} nextStepLabel={nextStepLabel} reviewMode={reviewMode} onEval={onEval} onClose={onClose} onNextStep={onNextStep} />
    </div>
  );
}

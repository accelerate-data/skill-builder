import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DecisionsSummaryCard } from "@/components/decisions-summary-card";
import { AgentStatsBar } from "@/components/agent-stats-bar";
import { StepActionBar } from "./step-action-bar";
import type { StepCompleteBaseProps, StepFileProps } from "./step-complete-types";

type Props = StepCompleteBaseProps & Pick<StepFileProps, "fileContents"> & {
  skillName?: string;
  workspacePath?: string;
};

export function DecisionsStepComplete(props: Props) {
  const {
    stepName, fileContents, agentRuns, reviewMode, duration,
    isLastStep, nextStepBlocked, nextStepLabel, onNextStep, onClose, onEval, onResetStep,
  } = props;

  const decisionsContent = fileContents.get("context/decisions.json");


  // Missing decisions.json
  if (!decisionsContent || decisionsContent === "__NOT_FOUND__") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
        <AlertTriangle className="size-8 text-destructive/50" />
        <div className="text-center">
          <p className="font-medium text-destructive">{stepName} step completed but output files are missing</p>
          <p className="mt-1 text-sm">Expected <code className="text-xs">context/decisions.json</code> but it was not found.</p>
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

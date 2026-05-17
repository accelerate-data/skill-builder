import { Loader2, AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DecisionsSummaryCard, parseDecisions } from "@/components/decisions-summary-card";
import { AgentStatsBar } from "@/components/agent-stats-bar";
import { useDecisions, useSaveDecisionsEdit } from "@/lib/queries/decisions";
import { StepActionBar } from "./step-action-bar";
import type { StepCompleteBaseProps } from "./step-complete-types";
import type { DecisionsDto, DecisionsOutput, DecisionStatus, ContradictoryInputs } from "@/generated/contracts";
import { getDisabledSteps } from "@/lib/tauri";
import { useWorkflowStore } from "@/stores/workflow-store";

function decisionsDtoToString(dto: DecisionsDto): string {
  const contradictoryInputs: ContradictoryInputs | undefined =
    dto.contradictory_inputs_state === "active" ? true :
    dto.contradictory_inputs_state === "inactive" ? false :
    dto.contradictory_inputs_state ?? undefined;

  const output: DecisionsOutput = {
    version: dto.version,
    metadata: {
      decision_count: dto.decision_count,
      conflicts_resolved: dto.conflicts_resolved,
      round: dto.round,
      contradictory_inputs: contradictoryInputs,
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
  skillId?: number | null;
  skillName?: string;
};

export function DecisionsStepComplete(props: Props) {
  const {
    stepName, skillId, conversationRuns, reviewMode, duration,
    isLastStep, nextStepBlocked, nextStepLabel, onNextStep, onClose, onEval, onResetStep,
  } = props;

  const skillIdKey = skillId != null ? String(skillId) : null;
  const { data: decisionsDto, isLoading, isError } = useDecisions(skillIdKey);
  const saveEdit = useSaveDecisionsEdit(skillIdKey);
  const setDisabledSteps = useWorkflowStore((s) => s.setDisabledSteps);

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

  const dbDuration = conversationRuns.length > 0
    ? conversationRuns.reduce((sum, r) => sum + r.duration_ms, 0)
    : undefined;

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      {reviewMode && conversationRuns.length > 0 && (
        <div className="shrink-0"><AgentStatsBar runs={conversationRuns} /></div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pr-4">
        <DecisionsSummaryCard
          decisionsContent={decisionsContent}
          duration={reviewMode ? dbDuration : duration}
          allowEdit={!reviewMode}
          onDecisionsChange={(serialized) => {
            const decisions = parseDecisions(serialized);
            saveEdit.mutate(decisions, {
              onSuccess: () => {
                if (skillId != null) {
                  getDisabledSteps(skillId)
                    .then((disabled) => setDisabledSteps(disabled))
                    .catch(() => { /* non-fatal */ });
                }
              },
            });
          }}
        />
      </div>
      <StepActionBar isLastStep={isLastStep} nextStepBlocked={nextStepBlocked} nextStepLabel={nextStepLabel} reviewMode={reviewMode} onEval={onEval} onClose={onClose} onNextStep={onNextStep} />
    </div>
  );
}

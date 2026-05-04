import { Loader2, AlertTriangle } from "lucide-react";
import { ClarificationsEditor } from "@/components/clarifications-editor";
import { AgentStatsBar } from "@/components/agent-stats-bar";
import { clarificationsDtoToFile } from "@/lib/clarifications-types";
import { useClarifications } from "@/lib/queries/clarifications";
import { StepActionBar } from "./step-action-bar";
import type { StepCompleteBaseProps, ClarificationsEditableProps } from "./step-complete-types";

type Props = StepCompleteBaseProps & ClarificationsEditableProps & {
  skillName?: string;
};

export function DetailedResearchStepComplete(props: Props) {
  const {
    skillName, agentRuns, reviewMode,
    isLastStep, nextStepBlocked, nextStepLabel, onNextStep, onClose, onEval,
    clarificationsEditable, clarificationsData: controlledClarData,
    onClarificationsChange, onClarificationsContinue, onReset, saveStatus, evaluating,
  } = props;

  const { data: clarDto, isLoading, isError } = useClarifications(skillName ?? null);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !clarDto) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
        <AlertTriangle className="size-8 text-destructive/50" />
        <div className="text-center">
          <p className="font-medium text-destructive">Clarifications not found in database</p>
          <p className="mt-1 text-sm">Re-run the Detailed Research step to regenerate.</p>
        </div>
      </div>
    );
  }

  const clarData = clarificationsDtoToFile(clarDto);

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      {reviewMode && agentRuns.length > 0 && (
        <div className="shrink-0"><AgentStatsBar runs={agentRuns} /></div>
      )}
      {clarificationsEditable ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <ClarificationsEditor
            data={controlledClarData ?? clarData}
            onChange={onClarificationsChange ?? (() => {})}
            onContinue={onClarificationsContinue}
            onReset={onReset}
            saveStatus={saveStatus}
            evaluating={evaluating}
          />
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border shadow-sm">
            <ClarificationsEditor data={clarData} onChange={() => {}} readOnly />
          </div>
          <StepActionBar isLastStep={isLastStep} nextStepBlocked={nextStepBlocked} nextStepLabel={nextStepLabel} reviewMode={reviewMode} onEval={onEval} onClose={onClose} onNextStep={onNextStep} />
        </>
      )}
    </div>
  );
}

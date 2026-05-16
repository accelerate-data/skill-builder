import { Loader2, AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResearchSummaryCard } from "@/components/research-summary-card";
import { clarificationsDtoToFile } from "@/lib/clarifications-types";
import { useClarifications } from "@/lib/queries/clarifications";
import { AgentStatsBar } from "@/components/agent-stats-bar";
import { StepActionBar } from "./step-action-bar";
import type { StepCompleteBaseProps, ClarificationsEditableProps } from "./step-complete-types";

type Props = StepCompleteBaseProps & ClarificationsEditableProps & {
  skillId?: string | null;
};

export function ResearchStepComplete(props: Props) {
  const {
    skillId, conversationRuns, reviewMode, duration,
    isLastStep, nextStepBlocked, nextStepLabel, onNextStep, onClose, onEval, onResetStep,
    clarificationsEditable, clarificationsData: controlledClarData,
    onClarificationsChange, onClarificationsContinue, onReset, saveStatus, evaluating,
  } = props;

  const { data: clarDto, isLoading, isError } = useClarifications(skillId ?? null);

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
          <div className="mt-2 text-sm">
            <p>The research step output could not be loaded from the database.</p>
          </div>
        </div>
        {onResetStep && (
          <Button size="sm" variant="outline" onClick={onResetStep}>
            <RotateCcw className="size-3.5" />
            Reset Step
          </Button>
        )}
      </div>
    );
  }

  const clarData = clarificationsDtoToFile(clarDto);

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      {reviewMode && conversationRuns.length > 0 && (
        <div className="shrink-0"><AgentStatsBar runs={conversationRuns} /></div>
      )}
      {clarificationsEditable ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ResearchSummaryCard
            clarificationsData={controlledClarData ?? clarData}
            duration={!reviewMode ? duration : undefined}
            editable
            onClarificationsChange={onClarificationsChange}
            onClarificationsContinue={onClarificationsContinue}
            onReset={onReset}
            saveStatus={saveStatus}
            evaluating={evaluating}
          />
        </div>
      ) : (
        <>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex min-h-full min-w-0 flex-col pr-4">
              <ResearchSummaryCard
                clarificationsData={clarData}
                duration={!reviewMode ? duration : undefined}
              />
            </div>
          </ScrollArea>
          <StepActionBar isLastStep={isLastStep} nextStepBlocked={nextStepBlocked} nextStepLabel={nextStepLabel} reviewMode={reviewMode} onEval={onEval} onClose={onClose} onNextStep={onNextStep} />
        </>
      )}
    </div>
  );
}

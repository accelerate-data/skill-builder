import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResearchSummaryCard } from "@/components/research-summary-card";
import { parseClarifications } from "@/lib/clarifications-types";
import { AgentStatsBar } from "@/components/agent-stats-bar";
import { StepActionBar } from "./step-action-bar";
import type { StepCompleteBaseProps, ClarificationsEditableProps, StepFileProps } from "./step-complete-types";

type Props = StepCompleteBaseProps & ClarificationsEditableProps & Pick<StepFileProps, "fileContents">;

export function ResearchStepComplete(props: Props) {
  const {
    fileContents, agentRuns, reviewMode, duration,
    isLastStep, nextStepBlocked, nextStepLabel, onNextStep, onClose, onEval, onResetStep,
    clarificationsEditable, clarificationsData: controlledClarData,
    onClarificationsChange, onClarificationsContinue, onReset, saveStatus, evaluating,
  } = props;

  const clarificationsContent = fileContents.get("context/clarifications.json");
  const researchPlanContent = fileContents.get("context/research-plan.md");

  // Missing files = error
  if (!clarificationsContent || clarificationsContent === "__NOT_FOUND__") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
        <AlertTriangle className="size-8 text-destructive/50" />
        <div className="text-center">
          <p className="font-medium text-destructive">Research step completed but output files are missing</p>
          <div className="mt-2 text-sm">
            <p>Expected <code className="text-xs">context/clarifications.json</code> but it was not found.</p>
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

  const clarData = parseClarifications(clarificationsContent);
  if (!clarData) {
    return (
      <div className="flex h-full flex-col gap-4 overflow-hidden">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
          <AlertTriangle className="size-8 text-destructive/50" />
          <div className="text-center">
            <p className="font-medium text-destructive">Invalid clarifications.json</p>
            <p className="mt-1 text-sm">The agent wrote a file that is not valid JSON. Reset and re-run the step.</p>
          </div>
        </div>
        <StepActionBar isLastStep={isLastStep} nextStepBlocked={nextStepBlocked} nextStepLabel={nextStepLabel} reviewMode={reviewMode} onEval={onEval} onClose={onClose} onNextStep={onNextStep} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      {reviewMode && agentRuns.length > 0 && (
        <div className="shrink-0"><AgentStatsBar runs={agentRuns} /></div>
      )}
      {clarificationsEditable ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ResearchSummaryCard
            researchPlan={researchPlanContent}
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
                researchPlan={researchPlanContent}
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

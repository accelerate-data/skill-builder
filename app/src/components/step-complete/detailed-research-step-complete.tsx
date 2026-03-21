import { ClarificationsEditor } from "@/components/clarifications-editor";
import { AgentStatsBar } from "@/components/agent-stats-bar";
import { parseClarifications } from "@/lib/clarifications-types";
import { StepActionBar } from "./step-action-bar";
import type { StepCompleteBaseProps, ClarificationsEditableProps, StepFileProps } from "./step-complete-types";

type Props = StepCompleteBaseProps & ClarificationsEditableProps & Pick<StepFileProps, "fileContents">;

export function DetailedResearchStepComplete(props: Props) {
  const {
    fileContents, agentRuns, reviewMode,
    isLastStep, nextStepBlocked, nextStepLabel, onNextStep, onClose, onEval,
    clarificationsEditable, clarificationsData: controlledClarData,
    onClarificationsChange, onClarificationsContinue, onReset, saveStatus, evaluating,
  } = props;

  const clarificationsContent = fileContents.get("context/clarifications.json");
  if (!clarificationsContent || clarificationsContent === "__NOT_FOUND__") return null;

  const clarData = parseClarifications(clarificationsContent);
  if (!clarData) return null;

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

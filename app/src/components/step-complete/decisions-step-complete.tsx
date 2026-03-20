import { useState, useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveDecisionsContent, getDisabledSteps } from "@/lib/tauri";
import { useWorkflowStore } from "@/stores/workflow-store";
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
    skillName, workspacePath,
  } = props;

  const decisionsContent = fileContents.get("context/decisions.json");

  // Autosave state for decisions editing
  const [decisionsEditContent, setDecisionsEditContent] = useState<string | null>(null);
  const [decisionsEditVersion, setDecisionsEditVersion] = useState(0);
  const [decisionsSaveStatus, setDecisionsSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    if (!decisionsEditContent || !workspacePath || !skillName || reviewMode || decisionsEditVersion === 0) return;
    const savedVersion = decisionsEditVersion;
    setDecisionsSaveStatus("saving");
    const timer = setTimeout(async () => {
      try {
        await saveDecisionsContent(skillName, workspacePath, decisionsEditContent);
        setDecisionsEditVersion((current) => {
          if (current === savedVersion) setDecisionsSaveStatus("saved");
          return current;
        });
        const disabled = await getDisabledSteps(skillName);
        useWorkflowStore.getState().setDisabledSteps(disabled);
      } catch (err) {
        console.error("Failed to save decisions.json:", err);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [decisionsEditContent, decisionsEditVersion, workspacePath, skillName, reviewMode]);

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
          allowEdit={!reviewMode}
          onDecisionsChange={(serialized) => {
            setDecisionsEditContent(serialized);
            setDecisionsEditVersion((v) => v + 1);
            setDecisionsSaveStatus("saving");
          }}
        />
      </div>
      {!reviewMode && decisionsSaveStatus !== "idle" && (
        <div className="flex justify-start">
          <span className="text-xs text-muted-foreground">
            {decisionsSaveStatus === "saving" ? (
              "Saving…"
            ) : (
              <span style={{ color: "var(--color-seafoam)" }}>Saved</span>
            )}
          </span>
        </div>
      )}
      <StepActionBar isLastStep={isLastStep} nextStepBlocked={nextStepBlocked} nextStepLabel={nextStepLabel} reviewMode={reviewMode} onEval={onEval} onClose={onClose} onNextStep={onNextStep} />
    </div>
  );
}

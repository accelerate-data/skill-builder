import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, FileText, Clock } from "lucide-react";
import { getStepAgentRuns } from "@/lib/tauri";
import type { AgentRunRecord } from "@/lib/types";
import type { ClarificationsFile } from "@/lib/clarifications-types";
import { formatElapsed } from "@/lib/utils";
import { useStepFiles } from "./use-step-files";
import { StepActionBar } from "./step-action-bar";
import { ResearchStepComplete } from "./research-step-complete";
import { DetailedResearchStepComplete } from "./detailed-research-step-complete";
import { DecisionsStepComplete } from "./decisions-step-complete";
import { FileViewerStepComplete } from "./file-viewer-step-complete";

interface WorkflowStepCompleteProps {
  stepName: string;
  stepId?: number;
  outputFiles: string[];
  duration?: number;
  onNextStep?: () => void;
  onClose?: () => void;
  onEval?: () => void;
  isLastStep?: boolean;
  reviewMode?: boolean;
  skillName?: string;
  workspacePath?: string;
  skillsPath?: string | null;
  clarificationsEditable?: boolean;
  clarificationsData?: ClarificationsFile | null;
  onClarificationsChange?: (data: ClarificationsFile) => void;
  onClarificationsContinue?: () => void;
  onReset?: () => void;
  onResetStep?: () => void;
  saveStatus?: "idle" | "dirty" | "saving" | "saved";
  evaluating?: boolean;
  nextStepBlocked?: boolean;
  nextStepLabel?: string;
}

export function WorkflowStepComplete({
  stepName,
  stepId,
  outputFiles,
  duration,
  onNextStep,
  onClose,
  onEval,
  isLastStep = false,
  reviewMode,
  skillName,
  workspacePath,
  skillsPath,
  clarificationsEditable,
  clarificationsData,
  onClarificationsChange,
  onClarificationsContinue,
  onReset,
  onResetStep,
  saveStatus,
  evaluating,
  nextStepBlocked = false,
  nextStepLabel,
}: WorkflowStepCompleteProps) {
  // --- Shared data loading ---
  const [agentRuns, setAgentRuns] = useState<AgentRunRecord[]>([]);

  useEffect(() => {
    if (!skillName || stepId == null) {
      setAgentRuns([]);
      return;
    }
    getStepAgentRuns(skillName, stepId)
      .then((runs) => setAgentRuns(runs))
      .catch((err) => console.error("Failed to load agent stats:", err));
  }, [skillName, stepId]);

  const { fileContents, resolvedFiles, selectedFile, setSelectedFile, loadingFiles } =
    useStepFiles(skillName, skillsPath, outputFiles);

  // --- Loading ---
  if (loadingFiles) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Shared base props for step components
  const baseProps = {
    stepName, isLastStep, reviewMode, nextStepBlocked, nextStepLabel,
    onNextStep, onClose, onEval, onResetStep, agentRuns, duration,
  };

  const clarProps = {
    clarificationsEditable, clarificationsData, onClarificationsChange,
    onClarificationsContinue, onReset, saveStatus, evaluating,
  };

  // --- Step 0: Research ---
  if (stepId === 0) {
    return <ResearchStepComplete {...baseProps} {...clarProps} skillName={skillName} />;
  }

  // --- Step 1: Detailed Research ---
  if (stepId === 1) {
    return <DetailedResearchStepComplete {...baseProps} {...clarProps} skillName={skillName} />;
  }

  // --- Step 2: Decisions ---
  if (stepId === 2) {
    return <DecisionsStepComplete {...baseProps} skillName={skillName} workspacePath={workspacePath} />;
  }

  // --- Default: File viewer ---
  const visibleFiles = resolvedFiles.filter((f) => !f.endsWith("/"));
  if (fileContents.size > 0 && visibleFiles.length > 0) {
    return (
      <FileViewerStepComplete
        {...baseProps}
        fileContents={fileContents}
        resolvedFiles={resolvedFiles}
        selectedFile={selectedFile}
        setSelectedFile={setSelectedFile}
      />
    );
  }

  // --- Fallback: Simple complete ---
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle2 className="size-12" style={{ color: "var(--color-seafoam)" }} />
          <h3 className="text-lg font-semibold">{stepName} Complete</h3>
          {outputFiles.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Created Files</p>
              {outputFiles.map((file) => (
                <div key={file} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="size-3.5" />
                  <span>{file}</span>
                </div>
              ))}
            </div>
          )}
          {duration !== undefined && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {formatElapsed(duration)}
              </span>
            </div>
          )}
        </div>
      </div>
      <StepActionBar isLastStep={isLastStep} nextStepBlocked={nextStepBlocked} nextStepLabel={nextStepLabel} reviewMode={reviewMode} onEval={onEval} onClose={onClose} onNextStep={onNextStep} />
    </div>
  );
}

import { CheckCircle2, FileText, Clock, DollarSign, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgentStatsBar } from "@/components/agent-stats-bar";
import { formatElapsed } from "@/lib/utils";
import { StepActionBar } from "./step-action-bar";
import { FileContentRenderer } from "./file-content-renderer";
import type { StepCompleteBaseProps, StepFileProps } from "./step-complete-types";

type Props = StepCompleteBaseProps & StepFileProps;

/** Display label for a file path: SKILL.md or references/foo.md */
function fileLabel(f: string): string {
  return f.startsWith("skill/") ? f.slice("skill/".length) : f;
}

export function FileViewerStepComplete(props: Props) {
  const {
    stepName, fileContents, resolvedFiles, selectedFile, setSelectedFile,
    agentRuns, reviewMode, duration, displayCost,
    isLastStep, nextStepBlocked, nextStepLabel, onNextStep, onClose, onRefine, onResetStep,
  } = props;

  const visibleFiles = resolvedFiles.filter((f) => !f.endsWith("/"));
  const activeFile = selectedFile && visibleFiles.includes(selectedFile) ? selectedFile : visibleFiles[0];
  const activeContent = fileContents.get(activeFile);
  const activeNotFound = activeContent === "__NOT_FOUND__";

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      {reviewMode && agentRuns.length > 0 && (
        <div className="shrink-0"><AgentStatsBar runs={agentRuns} /></div>
      )}
      {!reviewMode && (
        <div className="flex items-center gap-3 shrink-0">
          <CheckCircle2 className="size-4 shrink-0" style={{ color: "var(--color-seafoam)" }} />
          <span className="text-sm font-semibold tracking-tight">{stepName} Complete</span>
          <div className="flex-1" />
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {duration !== undefined && (
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {formatElapsed(duration)}
              </span>
            )}
            {displayCost !== undefined && (
              <span className="flex items-center gap-1">
                <DollarSign className="size-3" />
                ${displayCost.toFixed(4)}
              </span>
            )}
          </div>
        </div>
      )}
      <div className="shrink-0">
        {visibleFiles.length > 1 && (
          <Select value={activeFile} onValueChange={setSelectedFile}>
            <SelectTrigger size="sm" className="font-mono text-xs">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {visibleFiles.map((f) => (
                <SelectItem key={f} value={f} className="font-mono text-xs">
                  {fileLabel(f)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {visibleFiles.length === 1 && (
          <span className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
            <FileText className="size-3.5 shrink-0" />
            {fileLabel(activeFile)}
          </span>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="pr-4">
          {activeNotFound && (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-sm text-muted-foreground italic">File not found</p>
              {onResetStep && (
                <Button size="sm" variant="outline" onClick={onResetStep}>
                  <RotateCcw className="size-3.5" />
                  Re-run Step
                </Button>
              )}
            </div>
          )}
          {!activeNotFound && activeContent && (
            <FileContentRenderer file={activeFile} content={activeContent} />
          )}
        </div>
      </ScrollArea>
      <StepActionBar isLastStep={isLastStep} nextStepBlocked={nextStepBlocked} nextStepLabel={nextStepLabel} reviewMode={reviewMode} onRefine={onRefine} onClose={onClose} onNextStep={onNextStep} />
    </div>
  );
}

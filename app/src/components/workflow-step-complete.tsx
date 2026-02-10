import { CheckCircle2, FileText, Clock, DollarSign, RotateCcw, ArrowRight, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WorkflowStepCompleteProps {
  stepName: string;
  outputFiles: string[];
  duration?: number;
  cost?: number;
  onRerun?: () => void;
  onNextStep?: () => void;
  isLastStep?: boolean;
  onRefineChat?: () => void;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function WorkflowStepComplete({
  stepName,
  outputFiles,
  duration,
  cost,
  onRerun,
  onNextStep,
  isLastStep = false,
  onRefineChat,
}: WorkflowStepCompleteProps) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <CheckCircle2 className="size-12 text-green-500" />
        <h3 className="text-lg font-semibold">{stepName} Complete</h3>

        {outputFiles.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Created Files
            </p>
            {outputFiles.map((file) => (
              <div
                key={file}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <FileText className="size-3.5" />
                <span>{file}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {duration !== undefined && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {formatDuration(duration)}
            </span>
          )}
          {cost !== undefined && (
            <span className="flex items-center gap-1">
              <DollarSign className="size-3" />
              ${cost.toFixed(4)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-2">
          {onRerun && (
            <Button variant="outline" size="sm" onClick={onRerun}>
              <RotateCcw className="size-3.5" />
              Rerun Step
            </Button>
          )}
          {onNextStep && !isLastStep && (
            <Button size="sm" onClick={onNextStep}>
              <ArrowRight className="size-3.5" />
              Next Step
            </Button>
          )}
          {isLastStep && onRefineChat && (
            <Button variant="outline" size="sm" onClick={onRefineChat}>
              <MessageSquare className="size-3.5" />
              Refine with Chat
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

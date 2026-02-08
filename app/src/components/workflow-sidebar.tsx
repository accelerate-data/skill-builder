import {
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowStep } from "@/stores/workflow-store";

function StepStatusIcon({ status }: { status: WorkflowStep["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="size-4 text-green-500" />;
    case "in_progress":
      return <Loader2 className="size-4 animate-spin text-primary" />;
    case "waiting_for_user":
      return <Clock className="size-4 text-yellow-500" />;
    case "error":
      return <AlertCircle className="size-4 text-destructive" />;
    default:
      return <Circle className="size-4 text-muted-foreground" />;
  }
}

interface WorkflowSidebarProps {
  steps: WorkflowStep[];
  currentStep: number;
  onStepClick?: (stepId: number) => void;
}

export function WorkflowSidebar({
  steps,
  currentStep,
  onStepClick,
}: WorkflowSidebarProps) {
  return (
    <nav className="flex w-64 shrink-0 flex-col border-r bg-muted/30 p-4">
      <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Workflow Steps
      </h2>
      <ol className="flex flex-col gap-1">
        {steps.map((step) => {
          const isCurrent = step.id === currentStep;
          const isClickable =
            step.status === "completed" && onStepClick !== undefined;

          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick?.(step.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  isCurrent && "bg-accent text-accent-foreground",
                  !isCurrent && "text-muted-foreground hover:text-foreground",
                  isClickable && "cursor-pointer",
                  !isClickable && "cursor-default"
                )}
              >
                <span className="mt-0.5 shrink-0">
                  <StepStatusIcon status={step.status} />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span
                    className={cn(
                      "font-medium leading-tight",
                      isCurrent && "text-foreground"
                    )}
                  >
                    {step.id + 1}. {step.name}
                  </span>
                  {step.agentModel && (
                    <span className="text-xs text-muted-foreground">
                      {step.agentModel}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

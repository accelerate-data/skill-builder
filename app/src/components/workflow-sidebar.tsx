import {
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  AlertCircle,
  SkipForward,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowStep } from "@/stores/workflow-store";
import { WORKFLOW_STEP_DEFINITIONS } from "@/lib/workflow-steps";

function StepStatusIcon({ status, isDisabled }: { status: WorkflowStep["status"]; isDisabled?: boolean }) {
  if (isDisabled) {
    return <SkipForward className="size-4 text-muted-foreground/50" />;
  }
  switch (status) {
    case "completed":
      return <CheckCircle2 className="size-4" style={{ color: "var(--color-seafoam)" }} />;
    case "in_progress":
      return <Loader2 className="size-4 animate-spin text-primary" />;
    case "waiting_for_user":
      return <Clock className="size-4" style={{ color: "var(--color-pacific)" }} />;
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
  disabledSteps?: number[];
}

export function WorkflowSidebar({
  steps,
  currentStep,
  onStepClick,
  disabledSteps,
}: WorkflowSidebarProps) {
  return (
    <nav className="flex w-64 shrink-0 flex-col border-r bg-muted/30 p-4">
      <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Steps
      </h2>
      <ol className="flex flex-col gap-1">
        {steps.map((step) => {
          const isCurrent = step.id === currentStep;
          const isDisabled = disabledSteps?.includes(step.id) ?? false;
          const isFutureLocked = step.id > currentStep && step.status !== "completed" && !isDisabled;
          const isClickable =
            !isDisabled && step.status === "completed" && onStepClick !== undefined;

          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick?.(step.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  isDisabled && "opacity-40 cursor-not-allowed",
                  isFutureLocked && "opacity-50 cursor-not-allowed",
                  !isDisabled && isCurrent && "bg-accent text-accent-foreground",
                  !isDisabled && !isCurrent && !isFutureLocked && "text-muted-foreground hover:text-foreground",
                  !isDisabled && !isCurrent && isFutureLocked && "text-muted-foreground",
                  !isDisabled && isClickable && "cursor-pointer",
                  !isDisabled && !isFutureLocked && !isClickable && "cursor-default"
                )}
              >
                <span className="mt-0.5 shrink-0">
                  <StepStatusIcon status={step.status} isDisabled={isDisabled} />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span
                    className={cn(
                      "font-medium leading-tight",
                      !isDisabled && isCurrent && "text-foreground"
                    )}
                  >
                    {step.id + 1}. {WORKFLOW_STEP_DEFINITIONS.find((d) => d.id === step.id)?.name ?? step.name}
                  </span>
                  {isDisabled && (
                    <span className="text-xs text-muted-foreground/60">Skipped</span>
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

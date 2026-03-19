import { CheckCircle2, ArrowRight, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StepActionBarProps {
  isLastStep: boolean;
  nextStepBlocked?: boolean;
  nextStepLabel?: string;
  reviewMode?: boolean;
  onRefine?: () => void;
  onClose?: () => void;
  onNextStep?: () => void;
}

/** Shared action bar: Refine/Done on last step, Next Step otherwise. Hidden in review mode. */
export function StepActionBar({
  isLastStep,
  nextStepBlocked,
  nextStepLabel,
  reviewMode,
  onRefine,
  onClose,
  onNextStep,
}: StepActionBarProps) {
  if (reviewMode) return null;

  if (nextStepBlocked) {
    return (
      <div className="flex items-center justify-end border-t pt-4">
        <Button size="sm" disabled>
          <ArrowRight className="size-3.5" />
          {nextStepLabel ?? "Next Step"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2 border-t pt-4">
      {isLastStep ? (
        <>
          {onRefine && (
            <Button size="sm" variant="outline" onClick={onRefine}>
              <MessageSquare className="size-3.5" />
              Refine
            </Button>
          )}
          {onClose && (
            <Button size="sm" onClick={onClose}>
              <CheckCircle2 className="size-3.5" />
              Done
            </Button>
          )}
        </>
      ) : (
        onNextStep && (
          <Button size="sm" onClick={onNextStep}>
            <ArrowRight className="size-3.5" />
            Next Step
          </Button>
        )
      )}
    </div>
  );
}

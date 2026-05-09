import { useEffect, useRef } from "react";
import { useLeaveGuard } from "./use-leave-guard";

interface UseWorkflowSessionOptions {
  skillName: string;
  shouldBlock: () => boolean;
  hasUnsavedChanges: boolean;
  currentStep: number;
  steps: Array<{ status: string }>;
}

export function useWorkflowSession({
  skillName,
  shouldBlock,
  hasUnsavedChanges,
}: UseWorkflowSessionOptions) {
  const hasUnsavedChangesRef = useRef(false);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  const { blockerStatus, handleNavStay, handleNavLeave } = useLeaveGuard({
    shouldBlock: () => shouldBlock(),
    onLeave: (proceed) => {
      void proceed();
    },
  });

  return {
    blockerStatus,
    handleNavStay,
    handleNavLeave,
    hasUnsavedChangesRef,
  };
}

import { useEffect, useRef } from "react";
import { toast } from "@/lib/toast";
import { useLeaveGuard } from "./use-leave-guard";

interface UseWorkflowSessionOptions {
  skillName: string;
  shouldBlock: () => boolean;
  hasUnsavedChanges: boolean;
}

export function useWorkflowSession({
  skillName: _skillName,
  shouldBlock,
  hasUnsavedChanges,
}: UseWorkflowSessionOptions) {
  const hasUnsavedChangesRef = useRef(false);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  const { blockerStatus, handleNavStay, handleNavLeave } = useLeaveGuard({
    shouldBlock: () => shouldBlock(),
    onLeave: async (proceed) => {
      try {
        await proceed();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to leave workflow session.",
          { duration: Infinity },
        );
      }
    },
  });

  return {
    blockerStatus,
    handleNavStay,
    handleNavLeave,
    hasUnsavedChangesRef,
  };
}

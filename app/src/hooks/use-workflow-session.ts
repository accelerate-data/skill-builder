import { useEffect, useRef } from "react";
import { toast } from "@/lib/toast";
import { useLeaveGuard } from "./use-leave-guard";
import { teardownWorkflowSession } from "@/lib/workflow-teardown";

interface UseWorkflowSessionOptions {
  /** Skill name from route params */
  skillName: string;
  /** Whether the page is currently blocked (agent running, gate loading, or unsaved changes) */
  shouldBlock: () => boolean;
  /** Whether unsaved changes exist (for navigation blocking) */
  hasUnsavedChanges: boolean;
  /** Current step being worked on */
  currentStep: number;
  /** All steps in workflow */
  steps: Array<{ status: string }>;
}

/**
 * Manages workflow-session cleanup for the workflow page.
 * Integrates with useLeaveGuard to handle navigation blocking and cleanup.
 *
 * Responsibilities:
 * - Provide onLeave callback for navigation/window close cleanup
 * - Track unsaved changes for blocking
 * - End workflow session and clean up sidecar on leave
 */
export function useWorkflowSession({
  skillName,
  shouldBlock,
  hasUnsavedChanges,
}: UseWorkflowSessionOptions) {
  const hasUnsavedChangesRef = useRef(false);
  const sessionCleanedUpRef = useRef(false);

  // Track unsaved changes for the shouldBlock check (runs outside React render cycle)
  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  // Cleanup on unmount (e.g., test unmount, browser close, etc.)
  // Skipped if onLeave already ran cleanup to avoid double IPC calls.
  useEffect(() => {
    sessionCleanedUpRef.current = false;
    return () => {
      if (sessionCleanedUpRef.current) return;
      sessionCleanedUpRef.current = true;
      teardownWorkflowSession({
        logPrefix: "use-workflow-session",
        onEndSessionError: (err) => {
          toast.error(`Session cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
        },
      });
    };
  }, [skillName]);

  // useLeaveGuard: handle navigation blocking and cleanup
  const { blockerStatus, handleNavStay, handleNavLeave } = useLeaveGuard({
    shouldBlock: () => shouldBlock(),
    onLeave: (proceed) => {
      sessionCleanedUpRef.current = true;
      teardownWorkflowSession({
        logPrefix: "use-workflow-session",
        clearSessionId: true,
        onEndSessionError: (err) => {
          toast.error(`Session cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
        },
      });
      proceed();
    },
  });

  return {
    blockerStatus,
    handleNavStay,
    handleNavLeave,
    hasUnsavedChangesRef,
  };
}

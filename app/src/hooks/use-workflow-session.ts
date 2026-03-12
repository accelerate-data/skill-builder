import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useLeaveGuard } from "./use-leave-guard";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAgentStore } from "@/stores/agent-store";
import {
  acquireLock,
  releaseLock,
  endWorkflowSession,
  cleanupSkillSidecar,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";

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
 * Manages the skill lock lifecycle and session cleanup for the workflow page.
 * Integrates with useLeaveGuard to handle navigation blocking and cleanup.
 *
 * Responsibilities:
 * - Acquire skill lock on mount, release on unmount
 * - Provide onLeave callback for navigation/window close cleanup
 * - Track unsaved changes for blocking
 * - End workflow session and clean up sidecar on leave
 */
export function useWorkflowSession({
  skillName,
  shouldBlock,
  hasUnsavedChanges,
}: UseWorkflowSessionOptions) {
  const navigate = useNavigate();
  const hasUnsavedChangesRef = useRef(false);

  // Track unsaved changes for the shouldBlock check (runs outside React render cycle)
  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  // Acquire lock when entering workflow, release when leaving
  useEffect(() => {
    let mounted = true;

    acquireLock(skillName).catch((err) => {
      if (mounted) {
        toast.error(`Could not lock skill: ${err instanceof Error ? err.message : String(err)}`, {
          duration: Infinity,
          cause: err,
          context: { operation: "workflow_acquire_lock", skillName },
        });
        navigate({ to: "/" });
      }
    });

    return () => {
      mounted = false;
      // Fire-and-forget: release lock on unmount (unless navigating away via blocker)
      releaseLock(skillName).catch(() => {});
    };
  }, [skillName, navigate]);

  // Cleanup on unmount (e.g., test unmount, browser close, etc.)
  // When component unmounts without navigation, ensure session state is cleaned up
  useEffect(() => {
    return () => {
      // Revert any in-progress step to pending
      const store = useWorkflowStore.getState();
      const { currentStep: step, steps: curSteps } = store;
      if (curSteps[step]?.status === "in_progress") {
        store.updateStepStatus(step, "pending");
      }

      // Clear running/gate state
      store.setRunning(false);
      store.setGateLoading(false);
      useAgentStore.getState().clearRuns();

      // Fire-and-forget: end workflow session
      const sessionId = useWorkflowStore.getState().workflowSessionId;
      if (sessionId) endWorkflowSession(sessionId).catch(() => {});

      // Fire-and-forget: clean up persistent sidecar
      cleanupSkillSidecar(skillName).catch(() => {});
    };
  }, [skillName]);

  // useLeaveGuard: handle navigation blocking and cleanup
  const { blockerStatus, handleNavStay, handleNavLeave } = useLeaveGuard({
    shouldBlock: () => shouldBlock(),
    onLeave: (proceed) => {
      const store = useWorkflowStore.getState();
      const { currentStep: step, steps: curSteps } = store;
      const sessionId = store.workflowSessionId;

      // Revert any in-progress step to pending
      if (curSteps[step]?.status === "in_progress") {
        store.updateStepStatus(step, "pending");
      }

      // Clear running/gate state
      store.setRunning(false);
      store.setGateLoading(false);

      // Clear session ID so the next "Continue" starts a fresh session
      useWorkflowStore.setState({ workflowSessionId: null });
      useAgentStore.getState().clearRuns();

      // Fire-and-forget: end workflow session
      if (sessionId) endWorkflowSession(sessionId).catch(() => {});

      // Fire-and-forget: shut down persistent sidecar for this skill
      cleanupSkillSidecar(skillName).catch(() => {});

      // Fire-and-forget: release skill lock before leaving
      releaseLock(skillName).catch(() => {});

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

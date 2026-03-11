import { useCallback, useEffect } from "react";
import { useBlocker } from "@tanstack/react-router";
import { flushMessageBuffer } from "@/stores/agent-store";

/**
 * Shared lifecycle hook for pages that need to block navigation during long-running operations.
 *
 * Provides navigation blocking, confirmation handling, and automatic cleanup on unmount.
 * The page owns the leave cleanup logic (lock release, store reset, etc.) via the onLeave callback.
 *
 * @param shouldBlock - Function that returns true if navigation should be blocked
 * @param onLeave - Callback invoked when the user confirms leaving. Receives a proceed() function
 *                  that must be called to complete the navigation (may be async, e.g. for cleanup)
 */
export function useLeaveGuard(options: {
  shouldBlock: () => boolean;
  onLeave: (proceed: () => void) => void | Promise<void>;
}) {
  // Navigation guard: block when shouldBlockFn returns true.
  // Key: shouldBlockFn reads directly from Zustand (not React state) so the
  // value is current when the router re-evaluates after proceed().
  const { proceed, reset: resetBlocker, status: blockerStatus } = useBlocker({
    shouldBlockFn: options.shouldBlock,
    enableBeforeUnload: false,
    withResolver: true,
  });

  const handleNavStay = useCallback(() => {
    resetBlocker?.();
  }, [resetBlocker]);

  const handleNavLeave = useCallback(() => {
    void options.onLeave(() => {
      proceed?.();
    });
  }, [options, proceed]);

  // Safety-net cleanup: flush buffered messages and mark unmount occurred.
  // This ensures that if the component is removed without going through the blocker dialog,
  // any pending agent messages are flushed before store state is lost.
  useEffect(() => {
    return () => {
      flushMessageBuffer();
    };
  }, []);

  return {
    blockerStatus,
    handleNavStay,
    handleNavLeave,
  };
}

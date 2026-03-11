import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import * as agentStore from "@/stores/agent-store";

// Mock the router's useBlocker hook
vi.mock("@tanstack/react-router", () => ({
  useBlocker: vi.fn(),
}));

// Mock the agent store's flushMessageBuffer
vi.mock("@/stores/agent-store", () => ({
  flushMessageBuffer: vi.fn(),
}));

import { useBlocker } from "@tanstack/react-router";

describe("useLeaveGuard", () => {
  let mockBlockerResult: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementation for useBlocker
    mockBlockerResult = {
      proceed: vi.fn(),
      reset: vi.fn(),
      status: "idle",
    };
    (useBlocker as any).mockReturnValue(mockBlockerResult);
  });

  it("should pass shouldBlock function to useBlocker", () => {
    const shouldBlock = vi.fn(() => true);
    const onLeave = vi.fn();

    renderHook(() => useLeaveGuard({ shouldBlock, onLeave }));

    expect(useBlocker).toHaveBeenCalled();
    const blockerConfig = (useBlocker as any).mock.calls[0][0];
    expect(blockerConfig.shouldBlockFn).toBe(shouldBlock);
  });

  it("should set useBlocker enableBeforeUnload to false", () => {
    const shouldBlock = vi.fn(() => false);
    const onLeave = vi.fn();

    renderHook(() => useLeaveGuard({ shouldBlock, onLeave }));

    const blockerConfig = (useBlocker as any).mock.calls[0][0];
    expect(blockerConfig.enableBeforeUnload).toBe(false);
  });

  it("should set useBlocker withResolver to true", () => {
    const shouldBlock = vi.fn(() => false);
    const onLeave = vi.fn();

    renderHook(() => useLeaveGuard({ shouldBlock, onLeave }));

    const blockerConfig = (useBlocker as any).mock.calls[0][0];
    expect(blockerConfig.withResolver).toBe(true);
  });

  it("should return blockerStatus from useBlocker", () => {
    const shouldBlock = vi.fn(() => false);
    const onLeave = vi.fn();

    mockBlockerResult.status = "blocked";
    const { result } = renderHook(() => useLeaveGuard({ shouldBlock, onLeave }));

    expect(result.current.blockerStatus).toBe("blocked");
  });

  it("handleNavStay should call resetBlocker", () => {
    const shouldBlock = vi.fn(() => false);
    const onLeave = vi.fn();

    const { result } = renderHook(() => useLeaveGuard({ shouldBlock, onLeave }));

    result.current.handleNavStay();

    expect(mockBlockerResult.reset).toHaveBeenCalled();
  });

  it("handleNavLeave should call onLeave with proceed callback", () => {
    const shouldBlock = vi.fn(() => false);
    const onLeave = vi.fn();

    const { result } = renderHook(() => useLeaveGuard({ shouldBlock, onLeave }));

    result.current.handleNavLeave();

    expect(onLeave).toHaveBeenCalled();
    const proceedCallback = (onLeave as any).mock.calls[0][0];
    expect(typeof proceedCallback).toBe("function");
  });

  it("handleNavLeave should call proceed after onLeave completes", async () => {
    const shouldBlock = vi.fn(() => false);
    const onLeave = vi.fn(async (proceed: () => void) => {
      // Simulate async cleanup
      await Promise.resolve();
      proceed();
    });

    const { result } = renderHook(() => useLeaveGuard({ shouldBlock, onLeave }));

    result.current.handleNavLeave();

    // Wait for the promise to settle
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockBlockerResult.proceed).toHaveBeenCalled();
  });

  it("should flush message buffer on unmount", () => {
    const shouldBlock = vi.fn(() => false);
    const onLeave = vi.fn();

    const { unmount } = renderHook(() => useLeaveGuard({ shouldBlock, onLeave }));

    expect(agentStore.flushMessageBuffer).not.toHaveBeenCalled();

    unmount();

    expect(agentStore.flushMessageBuffer).toHaveBeenCalled();
  });

  it("should work with synchronous onLeave", () => {
    const shouldBlock = vi.fn(() => false);
    const onLeave = vi.fn((proceed: () => void) => {
      // Synchronous cleanup
      proceed();
    });

    const { result } = renderHook(() => useLeaveGuard({ shouldBlock, onLeave }));

    result.current.handleNavLeave();

    expect(onLeave).toHaveBeenCalled();
    expect(mockBlockerResult.proceed).toHaveBeenCalled();
  });

  it("should allow shouldBlock to change dynamically", () => {
    const shouldBlock = vi.fn(() => true);
    const onLeave = vi.fn();

    const { rerender } = renderHook(() => useLeaveGuard({ shouldBlock, onLeave }));

    const firstBlockerConfig = (useBlocker as any).mock.calls[0][0];
    expect(firstBlockerConfig.shouldBlockFn()).toBe(true);

    shouldBlock.mockReturnValue(false);
    rerender();

    // The hook should update the shouldBlockFn reference
    const secondBlockerConfig = (useBlocker as any).mock.calls[1][0];
    expect(secondBlockerConfig.shouldBlockFn()).toBe(false);
  });
});

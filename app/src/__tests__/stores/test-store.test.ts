import { describe, it, expect, beforeEach } from "vitest";
import { useTestStore } from "@/stores/test-store";

describe("useTestStore", () => {
  beforeEach(() => {
    useTestStore.setState({ isRunning: false });
  });

  it("has correct initial state", () => {
    expect(useTestStore.getState().isRunning).toBe(false);
  });

  it("setRunning(true) sets isRunning to true", () => {
    useTestStore.getState().setRunning(true);
    expect(useTestStore.getState().isRunning).toBe(true);
  });

  it("setRunning(false) sets isRunning to false", () => {
    useTestStore.getState().setRunning(true);
    useTestStore.getState().setRunning(false);
    expect(useTestStore.getState().isRunning).toBe(false);
  });

  it("multiple setRunning calls produce correct final state", () => {
    useTestStore.getState().setRunning(true);
    useTestStore.getState().setRunning(true);
    expect(useTestStore.getState().isRunning).toBe(true);

    useTestStore.getState().setRunning(false);
    expect(useTestStore.getState().isRunning).toBe(false);
  });

  it("isRunning becomes true when a test run starts", () => {
    // Simulates the transition that occurs when the test page calls setRunning(true) on run start.
    expect(useTestStore.getState().isRunning).toBe(false);
    useTestStore.getState().setRunning(true);
    expect(useTestStore.getState().isRunning).toBe(true);
  });

  it("isRunning resets to false after the full test lifecycle completes", () => {
    // Simulates the transition back to idle after all sequential agents (with-skill,
    // baseline, evaluator) have finished and the page calls setRunning(false).
    useTestStore.getState().setRunning(true);
    expect(useTestStore.getState().isRunning).toBe(true);

    useTestStore.getState().setRunning(false);
    expect(useTestStore.getState().isRunning).toBe(false);
  });

  it("shouldBlock condition — true when running, false when idle", () => {
    // The test page passes `() => useTestStore.getState().isRunning` as the
    // shouldBlock predicate to useLeaveGuard. Verify the store state drives it correctly.
    const shouldBlock = () => useTestStore.getState().isRunning;

    expect(shouldBlock()).toBe(false);

    useTestStore.getState().setRunning(true);
    expect(shouldBlock()).toBe(true);

    useTestStore.getState().setRunning(false);
    expect(shouldBlock()).toBe(false);
  });
});

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
});

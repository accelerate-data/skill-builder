import { describe, it, expect, vi } from "vitest";
import { createAbortState, handleShutdown, linkExternalSignal } from "../shutdown.js";

describe("createAbortState", () => {
  it("returns a fresh AbortController with signal.aborted=false", () => {
    const state = createAbortState();
    expect(state.abortController).toBeInstanceOf(AbortController);
    expect(state.abortController.signal.aborted).toBe(false);
  });
});

describe("handleShutdown", () => {
  it("sets signal.aborted to true via abort()", () => {
    const state = createAbortState();
    const exitFn = vi.fn();
    const timerFn = vi.fn(() => ({ unref: vi.fn() }));

    handleShutdown(state, exitFn, timerFn);

    expect(state.abortController.signal.aborted).toBe(true);
  });

  it("calls abort() on the controller", () => {
    const state = createAbortState();
    const exitFn = vi.fn();
    const timerFn = vi.fn(() => ({ unref: vi.fn() }));

    handleShutdown(state, exitFn, timerFn);

    expect(state.abortController.signal.aborted).toBe(true);
  });

  it("schedules a force-exit timeout of 3 seconds", () => {
    const state = createAbortState();
    const exitFn = vi.fn();
    const unrefMock = vi.fn();
    const timerFn = vi.fn(() => ({ unref: unrefMock }));

    handleShutdown(state, exitFn, timerFn);

    expect(timerFn).toHaveBeenCalledOnce();
    expect(timerFn).toHaveBeenCalledWith(expect.any(Function), 3000);
    expect(unrefMock).toHaveBeenCalledOnce();
  });

  it("force-exit callback calls exitFn with code 0", () => {
    const state = createAbortState();
    const exitFn = vi.fn();
    const timerFn = vi.fn((cb: () => void, _ms: number) => {
      cb(); // immediately invoke the callback
      return { unref: vi.fn() };
    });

    handleShutdown(state, exitFn, timerFn);

    expect(exitFn).toHaveBeenCalledWith(0);
  });
});

// TS-01: linkExternalSignal
describe("linkExternalSignal", () => {
  it("aborts state immediately when external signal is already aborted", () => {
    const state = createAbortState();
    const externalController = new AbortController();
    externalController.abort();

    linkExternalSignal(state, externalController.signal);

    expect(state.abortController.signal.aborted).toBe(true);
  });

  it("aborts state when external signal fires after linking", () => {
    const state = createAbortState();
    const externalController = new AbortController();

    linkExternalSignal(state, externalController.signal);
    expect(state.abortController.signal.aborted).toBe(false);

    externalController.abort();

    expect(state.abortController.signal.aborted).toBe(true);
  });

  it("does not crash and leaves state unaffected when called with undefined-like unused", () => {
    // The function signature requires an AbortSignal, but we can test with a
    // non-aborted signal that never fires — verifies the happy path doesn't mutate state.
    const state = createAbortState();
    const externalController = new AbortController();

    // Link but never abort — no crash expected
    linkExternalSignal(state, externalController.signal);

    expect(state.abortController.signal.aborted).toBe(false);
  });
});
